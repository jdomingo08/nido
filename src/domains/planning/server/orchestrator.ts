'use server'

import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { getOpenAIClient, OPENAI_MODELS } from '@/lib/openai/client'
import { calculateCost } from '@/lib/openai/cost'
import { requireFamily } from '@/domains/family/server/auth'
import {
  fetchWeekForecast,
  geocodeCity,
  summarizeForLlm,
  type DayForecast
} from '@/lib/weather/openmeteo'
import {
  getPersonalActivitiesForWeek,
  type ScheduledPersonalActivity
} from '@/domains/personal/server/queries'
import type { Json, TablesInsert } from '@/lib/supabase/database.types'
import { isoDate, mostRecentMonday } from './queries'

// ─── LLM output schema ─────────────────────────────────────────

const Material = z.object({
  item: z.string(),
  quantity: z.string(),
  note: z.string()
})

const ExecutionStep = z.object({
  order: z.number().int(),
  instruction: z.string(),
  parent_script: z.string(),
  duration_est_min: z.number().int()
})

const Variations = z.object({
  easier: z.string(),
  harder: z.string()
})

const Activity = z.object({
  title: z.string(),
  summary: z.string(),
  bucket: z.enum(['quiet', 'focus', 'deep', 'active', 'creative', 'social', 'outdoor', 'screen']),
  methodology: z.enum([
    'montessori',
    'reggio',
    'waldorf',
    'play-based',
    'outdoor',
    'stem',
    'mixed'
  ]),
  age_min: z.number().int(),
  age_max: z.number().int(),
  duration_min: z.number().int(),
  prep_time_min: z.number().int(),
  start_hour: z.number().int(),
  kid_indices: z.array(z.number().int()),
  skills_developed: z.array(z.string()),
  materials: z.array(Material),
  setup: z.string(),
  execution_steps: z.array(ExecutionStep),
  variations: Variations,
  troubleshooting: z.string(),
  cleanup: z.string(),
  safety_notes: z.string(),
  signs_it_worked: z.string(),
  weather_suitable: z.array(z.enum(['sunny', 'rainy', 'cold'])),
  badges: z.array(z.string()),
  reasoning: z.string(),
  inspiration_source: z.string(),
  inspiration_detail: z.string()
})

// Named-keys-per-day forces the model to produce ALL seven days (each key is
// required by the schema). With a plain `days: array`, gpt-4o would happily
// return one day and call it done — the schema can't enforce 7 entries
// reliably across structured-output validators.
const DayActivities = z.array(Activity).min(2).max(8)
// (DayActivities is still used by the single-day regenerate path which
// stays as a one-shot full-content call — that fits the timeout for 1 day.)

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

// ─── Two-phase schemas ─────────────────────────────────────────
// Skeleton: just the structural fields (title, bucket, age, time, kids).
// One LLM call generates the whole week so cross-day decisions (bucket
// balance, methodology blend, theme variety) stay coherent. Output is
// small per activity so the call fits well under the 60s function ceiling.

const SkeletonActivity = z.object({
  title: z.string(),
  bucket: z.enum(['quiet', 'focus', 'deep', 'active', 'creative', 'social', 'outdoor', 'screen']),
  methodology: z.enum([
    'montessori',
    'reggio',
    'waldorf',
    'play-based',
    'outdoor',
    'stem',
    'mixed'
  ]),
  age_min: z.number().int(),
  age_max: z.number().int(),
  duration_min: z.number().int(),
  start_hour: z.number().int(),
  kid_indices: z.array(z.number().int()),
  weather_suitable: z.array(z.enum(['sunny', 'rainy', 'cold']))
})

const SkeletonDayActivities = z.array(SkeletonActivity).min(2).max(6)

const SkeletonWeek = z.object({
  mon: SkeletonDayActivities,
  tue: SkeletonDayActivities,
  wed: SkeletonDayActivities,
  thu: SkeletonDayActivities,
  fri: SkeletonDayActivities,
  sat: SkeletonDayActivities,
  sun: SkeletonDayActivities
})

// Hydration: rich prose fields per activity, keyed by id so we can update
// the right database row. One call per day, fired in parallel from the
// client so the wall-clock total stays around 15s.

const HydratedActivity = z.object({
  id: z.string(),
  summary: z.string(),
  prep_time_min: z.number().int(),
  skills_developed: z.array(z.string()),
  materials: z.array(Material),
  setup: z.string(),
  execution_steps: z.array(ExecutionStep),
  variations: Variations,
  troubleshooting: z.string(),
  cleanup: z.string(),
  safety_notes: z.string(),
  signs_it_worked: z.string(),
  badges: z.array(z.string()),
  reasoning: z.string(),
  inspiration_source: z.string(),
  inspiration_detail: z.string()
})

const DayHydration = z.object({
  activities: z.array(HydratedActivity)
})

// ─── Prompt construction ───────────────────────────────────────

function densityPerDay(density: string): number {
  if (density === 'calm') return 3
  if (density === 'packed') return 7
  return 5
}

function buildSystemPrompt(locale: string): string {
  return `You are the planning brain behind Needle, a multi-agent activity planner for families with young children.
You coordinate six specialized perspectives — weather, ages, methodology, balance, history, materials —
and your output is a full week of age-appropriate, well-balanced activities for each kid in the family.

Voice & style:
- Output strictly in ${locale === 'es' ? 'Spanish' : 'English'}.
- Lowercase titles and copy. Warm, specific, and concrete.
- Good titles: "pouring station · water to tiny cups", "backyard dinosaur dig · flour + bones".
- Bad titles: "Water Pouring Activity", "Sensory Bin Time".
- Parent-at-the-playground tone, not teacher-y or corporate.
- Specific over abstract: "a bowl of dry beans + 3 tiny cups + a tray" beats "sensory materials".

Hard rules:
- HARD CONSTRAINTS (allergies, nap times, meal times) must NEVER be violated.
- Do not propose anything in the family's dislikes list.
- Two activities for the same kid must NOT overlap in time (start_hour + duration must not collide).
- Times must fall between 6 and 20 (clock hours), and respect the family's nap/meal schedule from constraints.
- Materials must be realistic for a typical home. If something is obscure, suggest a substitute in materials[].note.
- Each execution_step must be specific enough that a parent can run the activity cold without a YouTube lookup.
- Each parent_script must be a literal short sentence the parent can say out loud to the kid.

Methodology blending:
- Lean on the family's primary methodology, but DO mix in occasional secondary methodologies (a Montessori family
  should still see the occasional Waldorf, Reggio, or play-based proposal).

Bucket balancing:
- Across the week, balance these eight buckets per kid: quiet, focus, deep, active, creative, social, outdoor, screen.
- 'screen' is INVERSE — minimize. Aim for at most one or two screen-bucket activities per kid per week.

Per activity:
- Provide 2 to 4 short badges that hint at the agent reasoning (e.g. "post-nap", "sunny", "bilingual",
  "fine-motor", "age 3", "stem", "outdoor").
- Provide a one-sentence reasoning string that names the loudest agent perspective for this proposal.

Inspiration & source (mothers want to know "why this works" — write thoughtfully):
- inspiration_source: a short tag naming the tradition or pedagogy this draws from. Lowercase, specific.
  Good examples: "montessori practical life", "reggio emilia atelier work", "waldorf rhythmic play",
  "play-based outdoor exploration", "stem ramp + rolling experiments", "sensory-integration foundations".
  Bad examples: "fun activity", "child development".
- inspiration_detail: 3 to 5 warm sentences for the parent who wants to know more. Cover, in order:
  (1) where this approach comes from — a methodology, a tradition, or a body of developmental thinking,
  (2) what the child is specifically building developmentally (motor skill, executive function, language,
      bilateral coordination, theory of mind, etc.) — name it concretely,
  (3) why this lands well at the kid's age (sensitive periods, attention spans, motor milestones).
  Voice: a knowledgeable friend at the kitchen table, not a textbook. Plain, warm, confident.
  HARD RULES: do NOT invent study names, citations, paper titles, or URLs. Do NOT cite specific
  research papers. Do NOT name-drop researchers unless directly relevant (a brief reference to
  Maria Montessori or Loris Malaguzzi for the appropriate methodology is fine; avoid invented
  attributions).

Output strictly the JSON schema provided. Every field must be filled (use empty string or empty array
where genuinely not applicable, but prefer to fill them in).`
}

type PromptKid = {
  index: number
  name: string
  age: number
  color: string
  tags: string[]
}

function methodologyLine(methodologies: string[]): string {
  if (methodologies.length === 0) return 'no preference — blend freely across traditions'
  if (methodologies.length === 1) return `${methodologies[0]} (primary)`
  return `${methodologies.join(' + ')} (blend these; each should show up across the week)`
}

function formatHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
}

function summarizePersonalActivities(items: ScheduledPersonalActivity[]): string {
  if (items.length === 0) return '(none — parent is fully available all week)'
  return items
    .map((p) => {
      const end = formatHour(Number(p.start_hour) + p.duration_min / 60)
      return `- ${p.resolved_day} ${formatHour(Number(p.start_hour))}–${end}: ${p.title} (${p.category})`
    })
    .join('\n')
}

function buildUserPrompt(args: {
  weekStartDate: string
  household: string
  city: string | null
  locale: string
  methodologies: string[]
  density: string
  agentLevel: string
  nPerDay: number
  kids: PromptKid[]
  values: string[]
  constraints: string[]
  dislikes: string[]
  forecast: DayForecast[]
  personalActivities: ScheduledPersonalActivity[]
}): string {
  const kidLines = args.kids
    .map(
      (k) =>
        `${k.index}. ${k.name}, age ${k.age}, color ${k.color}, tags: [${k.tags.join(', ') || 'none'}]`
    )
    .join('\n')

  const valueLines =
    args.values.length > 0 ? args.values.map((v) => `- ${v}`).join('\n') : '- (none)'
  const constraintLines =
    args.constraints.length > 0 ? args.constraints.map((c) => `- ${c}`).join('\n') : '- (none)'
  const dislikeLines =
    args.dislikes.length > 0 ? args.dislikes.map((d) => `- ${d}`).join('\n') : '- (none)'

  const forecastBlock = summarizeForLlm(args.forecast)
  const personalBlock = summarizePersonalActivities(args.personalActivities)

  return `Generate a week plan starting Monday ${args.weekStartDate}.

Family: ${args.household}${args.city ? `, ${args.city}` : ''}
Locale: ${args.locale}
Methodology preference: ${methodologyLine(args.methodologies)}
Density: ${args.density} (~${args.nPerDay} activities per day, distributed across kids)
Agent transparency: ${args.agentLevel}

Kids (use these indices in kid_indices):
${kidLines}

Family values:
${valueLines}

Hard constraints (RESPECT STRICTLY):
${constraintLines}

Dislikes (avoid these):
${dislikeLines}

Forecast for the week (use this — outdoor activities only on dry days, prefer
sunny mornings for active outdoor play, rainy slots → indoor focus/creative,
hot afternoons → quiet/water play). Add a relevant weather badge ("☀ sunny",
"☔ rainy", "🌥 cloudy", etc.) when the forecast drove the choice.
${forecastBlock}

Household calendar — the parent is busy during these times. Kids still need
activities during these slots; just bias toward solo/parallel play (quiet,
solo focus, calm creative, screen) — avoid scheduling things that need the
parent's active engagement (active outdoor outings, social play with adults,
focus work that needs coaching) during these windows. For "work" or "errand"
windows, assume the parent is fully out and a caregiver covers; for in-home
busy windows the parent is around for safety but not engagement. NEVER skip
a slot entirely just because the parent is busy.
${personalBlock}

Output requirements:
- Return all SEVEN days as named keys: mon, tue, wed, thu, fri, sat, sun.
- Each day MUST contain at least 2 activities and aim for around ${args.nPerDay}.
- Distribute activities across kids fairly.
- Mix bucket types within and across days.
- Days should be chronologically full — no day should feel "empty".`
}

// ─── Public action ─────────────────────────────────────────────

export async function generateCurrentWeek(): Promise<{
  weekPlanId: string
  activityCount: number
}> {
  try {
    return await generateCurrentWeekInner()
  } catch (e) {
    console.error('[orchestrator] generateCurrentWeek failed:', e)
    throw e
  }
}

async function generateCurrentWeekInner(): Promise<{
  weekPlanId: string
  activityCount: number
}> {
  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  const { data: kids, error: kidsError } = await supabase
    .from('kids')
    .select('*')
    .eq('family_id', family.id)
    .order('created_at', { ascending: true })

  if (kidsError) throw new Error(kidsError.message)
  if (!kids || kids.length === 0) {
    throw new Error('No kids found for this family. Complete onboarding first.')
  }

  const { data: prefs } = await supabase
    .from('family_preferences')
    .select('*')
    .eq('family_id', family.id)

  const values = (prefs ?? []).filter((p) => p.kind === 'value').map((p) => p.text)
  const constraints = (prefs ?? []).filter((p) => p.kind === 'constraint').map((p) => p.text)
  const dislikes = (prefs ?? []).filter((p) => p.kind === 'dislike').map((p) => p.text)

  const weekStartIso = isoDate(mostRecentMonday(new Date()))

  const { data: existing } = await supabase
    .from('week_plans')
    .select('id')
    .eq('family_id', family.id)
    .eq('week_start_date', weekStartIso)
    .maybeSingle()

  if (existing) {
    throw new Error('A week plan already exists for this week. Refresh the page to view it.')
  }

  const promptKids: PromptKid[] = kids.map((k, i) => ({
    index: i,
    name: k.name,
    age: k.age,
    color: k.color,
    tags: k.tags
  }))

  const nPerDay = densityPerDay(family.density)

  // Fetch a real 7-day forecast (Open-Meteo, no API key required) when we have a city.
  // Failure is non-fatal — we still generate a week, just without weather context.
  let forecast: DayForecast[] = []
  if (family.city) {
    try {
      const coords = await geocodeCity(family.city)
      if (coords) {
        forecast = await fetchWeekForecast({
          lat: coords.lat,
          lon: coords.lon,
          startDate: mostRecentMonday(new Date())
        })
      }
    } catch {
      // Swallow weather errors — orchestrator should still run.
    }
  }

  // Pull personal activities so the orchestrator respects the household calendar.
  const personalActivities = await getPersonalActivitiesForWeek(
    family.id,
    mostRecentMonday(new Date())
  )

  const systemPrompt = buildSystemPrompt(family.locale)
  const userPrompt = buildUserPrompt({
    weekStartDate: weekStartIso,
    household: family.household_name,
    city: family.city,
    locale: family.locale,
    methodologies: family.methodologies,
    density: family.density,
    agentLevel: family.agent_level,
    nPerDay,
    kids: promptKids,
    values,
    constraints,
    dislikes,
    forecast,
    personalActivities
  })

  const openai = getOpenAIClient()

  // Phase A: skeleton only — small per-activity output keeps the call inside
  // the 60s function ceiling. Rich content is filled in by `hydrateDay()`,
  // called from the client in parallel after this returns.
  const completion = await openai.chat.completions.parse({
    model: OPENAI_MODELS.orchestrate,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: zodResponseFormat(SkeletonWeek, 'week_skeleton')
  })

  const parsed = completion.choices[0]?.message.parsed
  if (!parsed) {
    throw new Error('LLM returned no parsed output')
  }

  const cost = calculateCost(OPENAI_MODELS.orchestrate, completion.usage)
  const admin = getSupabaseAdminClient()
  await admin.from('llm_calls').insert({
    family_id: family.id,
    model: OPENAI_MODELS.orchestrate,
    tokens_in: completion.usage?.prompt_tokens ?? 0,
    tokens_out: completion.usage?.completion_tokens ?? 0,
    cost_usd: cost,
    purpose: 'orchestrate_week_skeleton'
  })

  const { data: weekPlan, error: wpErr } = await supabase
    .from('week_plans')
    .insert({
      family_id: family.id,
      week_start_date: weekStartIso,
      status: 'ready',
      weather_forecast: (forecast.length > 0 ? forecast : null) as Json
    })
    .select()
    .single()

  if (wpErr || !weekPlan) {
    throw new Error(wpErr?.message ?? 'Failed to create week plan')
  }

  const kidIdByIndex = (i: number): string | undefined => kids[i]?.id

  const rows: TablesInsert<'activities'>[] = []
  for (const dayKey of DAY_KEYS) {
    const dayActivities = parsed[dayKey] ?? []
    for (const a of dayActivities) {
      const kid_ids = a.kid_indices
        .map((i) => kidIdByIndex(i))
        .filter((id): id is string => Boolean(id))

      if (kid_ids.length === 0) continue

      // Skeleton row: only structural fields. Rich fields stay null/default
      // until hydrateDay() fills them.
      rows.push({
        week_plan_id: weekPlan.id,
        family_id: family.id,
        day: dayKey,
        start_hour: clampInt(a.start_hour, 6, 20),
        duration_min: clampInt(a.duration_min, 5, 180),
        kid_ids,
        title: a.title,
        bucket: a.bucket,
        methodology: a.methodology,
        age_min: a.age_min,
        age_max: a.age_max,
        weather_suitable: a.weather_suitable,
        status: 'proposed'
      })
    }
  }

  if (rows.length > 0) {
    const { error: actErr } = await supabase.from('activities').insert(rows)
    if (actErr) {
      // Roll back the week_plan to keep state consistent.
      await supabase.from('week_plans').delete().eq('id', weekPlan.id)
      throw new Error(actErr.message)
    }
  }

  revalidatePath('/dashboard')
  return { weekPlanId: weekPlan.id, activityCount: rows.length }
}

function clampInt(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.max(min, Math.min(max, Math.round(n)))
}

// Wipes the current week (cascade deletes activities) and runs the orchestrator
// again. Use sparingly — every call costs ~$0.10–0.30 and writes to the LLM ledger.
export async function regenerateCurrentWeek(): Promise<{
  weekPlanId: string
  activityCount: number
}> {
  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()
  const weekStart = isoDate(mostRecentMonday(new Date()))

  const { error: delError } = await supabase
    .from('week_plans')
    .delete()
    .eq('family_id', family.id)
    .eq('week_start_date', weekStart)

  if (delError) {
    throw new Error(`Failed to clear current week: ${delError.message}`)
  }

  return generateCurrentWeek()
}

// ─── Phase B: hydrate one day's skeleton activities ────────────

export async function hydrateDay(day: (typeof DAY_KEYS)[number]): Promise<{ hydrated: number }> {
  try {
    return await hydrateDayInner(day)
  } catch (e) {
    console.error(`[orchestrator] hydrateDay(${day}) failed:`, e)
    throw e
  }
}

async function hydrateDayInner(day: (typeof DAY_KEYS)[number]): Promise<{ hydrated: number }> {
  if (!(DAY_KEYS as readonly string[]).includes(day)) {
    throw new Error(`Invalid day: ${day}`)
  }

  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()
  const weekStartIso = isoDate(mostRecentMonday(new Date()))

  const { data: weekPlan } = await supabase
    .from('week_plans')
    .select('*')
    .eq('family_id', family.id)
    .eq('week_start_date', weekStartIso)
    .maybeSingle()

  if (!weekPlan) {
    throw new Error('No week plan to hydrate. Generate the week first.')
  }

  // Only hydrate rows that haven't been filled in yet.
  const { data: skeletons } = await supabase
    .from('activities')
    .select('id, title, bucket, methodology, age_min, age_max, duration_min, kid_ids, start_hour')
    .eq('week_plan_id', weekPlan.id)
    .eq('day', day)
    .is('summary', null)
    .order('start_hour')

  if (!skeletons || skeletons.length === 0) {
    return { hydrated: 0 }
  }

  const { data: kids } = await supabase
    .from('kids')
    .select('*')
    .eq('family_id', family.id)
    .order('created_at', { ascending: true })

  const { data: prefs } = await supabase
    .from('family_preferences')
    .select('*')
    .eq('family_id', family.id)

  const constraints = (prefs ?? []).filter((p) => p.kind === 'constraint').map((p) => p.text)
  const dislikes = (prefs ?? []).filter((p) => p.kind === 'dislike').map((p) => p.text)

  const personalActivities = await getPersonalActivitiesForWeek(
    family.id,
    mostRecentMonday(new Date())
  )
  const personalForDay = personalActivities.filter((p) => p.resolved_day === day)

  const forecastForWeek = parseForecastJson(weekPlan.weather_forecast)
  const forecastForDay = forecastForWeek.find((f) => f.day === day) ?? null

  const skeletonsWithKidNames = skeletons.map((a) => ({
    id: a.id,
    title: a.title,
    bucket: a.bucket,
    methodology: a.methodology ?? 'mixed',
    age_min: a.age_min ?? 0,
    age_max: a.age_max ?? 18,
    duration_min: a.duration_min,
    kid_names: a.kid_ids
      .map((id) => kids?.find((k) => k.id === id)?.name ?? null)
      .filter((n): n is string => Boolean(n))
  }))

  const systemPrompt = buildHydrationSystemPrompt(family.locale)
  const userPrompt = buildHydrationUserPrompt({
    day,
    activities: skeletonsWithKidNames,
    family_methodologies: family.methodologies,
    forecastForDay,
    personalForDay,
    constraints,
    dislikes
  })

  const openai = getOpenAIClient()

  const completion = await openai.chat.completions.parse({
    model: OPENAI_MODELS.orchestrate,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: zodResponseFormat(DayHydration, 'day_hydration')
  })

  const parsed = completion.choices[0]?.message.parsed
  if (!parsed) {
    throw new Error('LLM returned no hydration output')
  }

  const cost = calculateCost(OPENAI_MODELS.orchestrate, completion.usage)
  const admin = getSupabaseAdminClient()
  await admin.from('llm_calls').insert({
    family_id: family.id,
    model: OPENAI_MODELS.orchestrate,
    tokens_in: completion.usage?.prompt_tokens ?? 0,
    tokens_out: completion.usage?.completion_tokens ?? 0,
    cost_usd: cost,
    purpose: `hydrate_day_${day}`
  })

  // Update each skeleton row with hydrated content. Hallucinated ids are ignored.
  const validIds = new Set(skeletons.map((s) => s.id))
  let updated = 0
  for (const h of parsed.activities) {
    if (!validIds.has(h.id)) continue
    const { error } = await supabase
      .from('activities')
      .update({
        summary: h.summary || null,
        prep_time_min: h.prep_time_min ?? 0,
        skills_developed: h.skills_developed,
        materials: h.materials,
        setup: h.setup || null,
        execution_steps: h.execution_steps,
        variations: h.variations,
        troubleshooting: h.troubleshooting || null,
        cleanup: h.cleanup || null,
        safety_notes: h.safety_notes || null,
        signs_it_worked: h.signs_it_worked || null,
        badges: h.badges,
        reasoning: h.reasoning || null,
        inspiration_source: h.inspiration_source || null,
        inspiration_detail: h.inspiration_detail || null
      })
      .eq('id', h.id)
    if (!error) updated++
  }

  revalidatePath('/dashboard', 'layout')
  return { hydrated: updated }
}

function buildHydrationSystemPrompt(locale: string): string {
  return `You are hydrating skeleton activities into rich, parent-ready content for Needle.

Voice & style:
- Output strictly in ${locale === 'es' ? 'Spanish' : 'English'}.
- Lowercase, warm, specific. Parent-at-the-playground tone, not teacher-y.
- Concrete over abstract: "a bowl of dry beans + 3 tiny cups + a tray" beats "sensory materials".

For each input activity, return rich content with the SAME id.

Field guidance:
- summary: 1-2 sentences — what + why.
- prep_time_min: realistic prep time, 0 if no prep.
- skills_developed: 2-4 short tags ("fine motor", "color recognition", "executive function").
- materials: realistic items found at home; quantity + brief note; substitutions when obscure.
- setup: short paragraph on arranging the space.
- execution_steps: 3-5 steps. Each has \`instruction\` (what to do), \`parent_script\` (one literal sentence the parent says), \`duration_est_min\`.
- variations: { easier, harder } — short adaptations.
- troubleshooting: short paragraph for "what if kid loses interest".
- cleanup: brief.
- safety_notes: only if relevant.
- signs_it_worked: one sentence on engagement signals.
- badges: 2-3 short tags ("post-nap", "sunny", "fine-motor", etc.) — when forecast or context drove the choice.
- reasoning: one sentence naming which agent perspective was loudest.
- inspiration_source: short pedagogical lineage tag (e.g. "montessori practical life").
- inspiration_detail: 3-5 sentences on tradition, skill development, age fit. NO fake citations or invented studies.

HARD RULES:
- Don't invent study names, citations, paper titles, or URLs.
- Respect the family's hard constraints (allergies, nap times) — never propose materials/steps that violate them.
- Avoid items in the family's dislikes list.

Output strictly the JSON schema. Match each input id exactly.`
}

function buildHydrationUserPrompt(args: {
  day: (typeof DAY_KEYS)[number]
  activities: Array<{
    id: string
    title: string
    bucket: string
    methodology: string
    age_min: number
    age_max: number
    duration_min: number
    kid_names: string[]
  }>
  family_methodologies: string[]
  forecastForDay: DayForecast | null
  personalForDay: ScheduledPersonalActivity[]
  constraints: string[]
  dislikes: string[]
}): string {
  const list = args.activities
    .map(
      (a, i) =>
        `${i + 1}. id="${a.id}" — "${a.title}" · ${a.bucket} · ${a.methodology} · age ${a.age_min}-${a.age_max} · ${a.duration_min}m · for ${a.kid_names.join(' + ') || 'family'}`
    )
    .join('\n')

  const constraintLines =
    args.constraints.length > 0 ? args.constraints.map((c) => `- ${c}`).join('\n') : '- (none)'
  const dislikeLines =
    args.dislikes.length > 0 ? args.dislikes.map((d) => `- ${d}`).join('\n') : '- (none)'

  const forecastBlock = args.forecastForDay
    ? `${args.forecastForDay.parts.morning.label} ${args.forecastForDay.parts.morning.temp_f}° / ${args.forecastForDay.parts.afternoon.label} ${args.forecastForDay.parts.afternoon.temp_f}° / ${args.forecastForDay.parts.evening.label} ${args.forecastForDay.parts.evening.temp_f}°`
    : '(no forecast available)'

  const personalBlock =
    args.personalForDay.length === 0
      ? '(parent fully available all day)'
      : args.personalForDay
          .map((p) => {
            const start = Number(p.start_hour)
            return `- ${formatHour(start)}–${formatHour(start + p.duration_min / 60)}: ${p.title} (${p.category})`
          })
          .join('\n')

  return `Hydrate these activities for ${DAY_LABEL[args.day]}:

${list}

Family methodologies: ${methodologyLine(args.family_methodologies)}

Hard constraints (respect strictly):
${constraintLines}

Dislikes (avoid):
${dislikeLines}

Today's weather (morning / afternoon / evening): ${forecastBlock}

Today's parent calendar:
${personalBlock}

Return rich content for each activity. Use the same id for each.`
}

// ─── Single-day regenerate ─────────────────────────────────────

const SingleDayPlan = z.object({
  activities: DayActivities
})

const DAY_LABEL: Record<(typeof DAY_KEYS)[number], string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
}

export async function regenerateDay(
  day: (typeof DAY_KEYS)[number]
): Promise<{ activityCount: number }> {
  try {
    return await regenerateDayInner(day)
  } catch (e) {
    console.error(`[orchestrator] regenerateDay(${day}) failed:`, e)
    throw e
  }
}

async function regenerateDayInner(
  day: (typeof DAY_KEYS)[number]
): Promise<{ activityCount: number }> {
  if (!(DAY_KEYS as readonly string[]).includes(day)) {
    throw new Error(`Invalid day: ${day}`)
  }

  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()
  const weekStartIso = isoDate(mostRecentMonday(new Date()))

  const { data: weekPlan } = await supabase
    .from('week_plans')
    .select('*')
    .eq('family_id', family.id)
    .eq('week_start_date', weekStartIso)
    .maybeSingle()

  if (!weekPlan) {
    throw new Error('No week plan exists yet — generate the full week first.')
  }

  const { data: kids, error: kidsError } = await supabase
    .from('kids')
    .select('*')
    .eq('family_id', family.id)
    .order('created_at', { ascending: true })
  if (kidsError) throw new Error(kidsError.message)
  if (!kids?.length) throw new Error('No kids found.')

  const { data: prefs } = await supabase
    .from('family_preferences')
    .select('*')
    .eq('family_id', family.id)

  const values = (prefs ?? []).filter((p) => p.kind === 'value').map((p) => p.text)
  const constraints = (prefs ?? []).filter((p) => p.kind === 'constraint').map((p) => p.text)
  const dislikes = (prefs ?? []).filter((p) => p.kind === 'dislike').map((p) => p.text)

  const personalActivities = await getPersonalActivitiesForWeek(
    family.id,
    mostRecentMonday(new Date())
  )
  const personalForDay = personalActivities.filter((p) => p.resolved_day === day)

  const forecastForWeek = parseForecastJson(weekPlan.weather_forecast)
  const forecastForDay = forecastForWeek.find((f) => f.day === day) ?? null

  const promptKids: PromptKid[] = kids.map((k, i) => ({
    index: i,
    name: k.name,
    age: k.age,
    color: k.color,
    tags: k.tags
  }))

  const nPerDay = densityPerDay(family.density)

  const systemPrompt = buildSystemPrompt(family.locale)
  const userPrompt = buildDayUserPrompt({
    day,
    weekStartDate: weekStartIso,
    household: family.household_name,
    city: family.city,
    locale: family.locale,
    methodologies: family.methodologies,
    density: family.density,
    agentLevel: family.agent_level,
    nPerDay,
    kids: promptKids,
    values,
    constraints,
    dislikes,
    forecastForDay,
    personalForDay
  })

  const openai = getOpenAIClient()

  const completion = await openai.chat.completions.parse({
    model: OPENAI_MODELS.orchestrate,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: zodResponseFormat(SingleDayPlan, 'day_plan')
  })

  const parsed = completion.choices[0]?.message.parsed
  if (!parsed) {
    throw new Error('LLM returned no parsed output for day regeneration')
  }

  const cost = calculateCost(OPENAI_MODELS.orchestrate, completion.usage)
  const admin = getSupabaseAdminClient()
  await admin.from('llm_calls').insert({
    family_id: family.id,
    model: OPENAI_MODELS.orchestrate,
    tokens_in: completion.usage?.prompt_tokens ?? 0,
    tokens_out: completion.usage?.completion_tokens ?? 0,
    cost_usd: cost,
    purpose: `regenerate_day_${day}`
  })

  // Build new rows BEFORE deleting — if anything goes wrong above, we keep the existing day.
  const kidIdByIndex = (i: number): string | undefined => kids[i]?.id
  const rows: TablesInsert<'activities'>[] = []
  for (const a of parsed.activities) {
    const kid_ids = a.kid_indices
      .map((i) => kidIdByIndex(i))
      .filter((id): id is string => Boolean(id))
    if (kid_ids.length === 0) continue
    rows.push({
      week_plan_id: weekPlan.id,
      family_id: family.id,
      day,
      start_hour: clampInt(a.start_hour, 6, 20),
      duration_min: clampInt(a.duration_min, 5, 180),
      kid_ids,
      title: a.title,
      summary: a.summary || null,
      bucket: a.bucket,
      methodology: a.methodology,
      age_min: a.age_min,
      age_max: a.age_max,
      prep_time_min: a.prep_time_min,
      skills_developed: a.skills_developed,
      materials: a.materials,
      setup: a.setup || null,
      execution_steps: a.execution_steps,
      variations: a.variations,
      troubleshooting: a.troubleshooting || null,
      cleanup: a.cleanup || null,
      safety_notes: a.safety_notes || null,
      signs_it_worked: a.signs_it_worked || null,
      weather_suitable: a.weather_suitable,
      status: 'proposed',
      badges: a.badges,
      reasoning: a.reasoning || null,
      inspiration_source: a.inspiration_source || null,
      inspiration_detail: a.inspiration_detail || null
    })
  }

  // Now wipe and replace this day only.
  const { error: delErr } = await supabase
    .from('activities')
    .delete()
    .eq('week_plan_id', weekPlan.id)
    .eq('day', day)
  if (delErr) throw new Error(`Failed to clear ${day}: ${delErr.message}`)

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('activities').insert(rows)
    if (insErr) throw new Error(insErr.message)
  }

  revalidatePath('/dashboard', 'layout')
  return { activityCount: rows.length }
}

function buildDayUserPrompt(args: {
  day: (typeof DAY_KEYS)[number]
  weekStartDate: string
  household: string
  city: string | null
  locale: string
  methodologies: string[]
  density: string
  agentLevel: string
  nPerDay: number
  kids: PromptKid[]
  values: string[]
  constraints: string[]
  dislikes: string[]
  forecastForDay: DayForecast | null
  personalForDay: ScheduledPersonalActivity[]
}): string {
  const kidLines = args.kids
    .map(
      (k) =>
        `${k.index}. ${k.name}, age ${k.age}, color ${k.color}, tags: [${k.tags.join(', ') || 'none'}]`
    )
    .join('\n')

  const valueLines =
    args.values.length > 0 ? args.values.map((v) => `- ${v}`).join('\n') : '- (none)'
  const constraintLines =
    args.constraints.length > 0 ? args.constraints.map((c) => `- ${c}`).join('\n') : '- (none)'
  const dislikeLines =
    args.dislikes.length > 0 ? args.dislikes.map((d) => `- ${d}`).join('\n') : '- (none)'

  const forecastBlock = args.forecastForDay
    ? `morning ${args.forecastForDay.parts.morning.label} ${args.forecastForDay.parts.morning.temp_f}°, ` +
      `afternoon ${args.forecastForDay.parts.afternoon.label} ${args.forecastForDay.parts.afternoon.temp_f}°, ` +
      `evening ${args.forecastForDay.parts.evening.label} ${args.forecastForDay.parts.evening.temp_f}°`
    : '(no forecast available — assume mild)'

  const personalBlock =
    args.personalForDay.length === 0
      ? '(parent fully available all day)'
      : args.personalForDay
          .map((p) => {
            const start = Number(p.start_hour)
            const startStr = `${Math.floor(start).toString().padStart(2, '0')}:${Math.round(
              (start - Math.floor(start)) * 60
            )
              .toString()
              .padStart(2, '0')}`
            const endNum = start + p.duration_min / 60
            const endStr = `${Math.floor(endNum).toString().padStart(2, '0')}:${Math.round(
              (endNum - Math.floor(endNum)) * 60
            )
              .toString()
              .padStart(2, '0')}`
            return `- ${startStr}–${endStr}: ${p.title} (${p.category})`
          })
          .join('\n')

  return `Regenerate kid activities for ${DAY_LABEL[args.day]} only (week of ${args.weekStartDate}).

Family: ${args.household}${args.city ? `, ${args.city}` : ''}
Locale: ${args.locale}
Methodology preference: ${methodologyLine(args.methodologies)}
Density: ${args.density} (~${args.nPerDay} activities for this day)
Agent transparency: ${args.agentLevel}

Kids (use these indices in kid_indices):
${kidLines}

Family values:
${valueLines}

Hard constraints (RESPECT STRICTLY):
${constraintLines}

Dislikes (avoid these):
${dislikeLines}

Forecast for ${DAY_LABEL[args.day]}: ${forecastBlock}
Add a relevant weather badge ("☀ sunny", "☔ rainy", etc.) when the forecast drove the choice.

Household calendar for ${DAY_LABEL[args.day]} (parent busy windows):
${personalBlock}
Bias toward solo/parallel kid activities (quiet, solo focus, screen, calm creative)
during these slots; reserve active outdoor + adult-led social play for free windows.
NEVER skip a slot just because the parent is busy.

Output requirements:
- Return at least 2 and at most 8 activities for this single day.
- Aim for around ${args.nPerDay} total.
- Distribute fairly across the kids listed.
- Mix bucket types within the day. Don't repeat the same bucket back-to-back.`
}

function parseForecastJson(raw: unknown): DayForecast[] {
  if (!Array.isArray(raw)) return []
  return raw as DayForecast[]
}
