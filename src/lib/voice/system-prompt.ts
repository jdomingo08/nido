import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/supabase/database.types'
import { getCurrentWeekPlan, isoDate, mostRecentMonday } from '@/domains/planning/server/queries'

type Family = Tables<'families'>

// Build the system prompt that's baked into the OpenAI Realtime session.
// Capped at ~600 tokens for latency: include essentials only, never dump
// activities (the model calls query_schedule for that).
export async function buildVoiceSystemPrompt(family: Family): Promise<string> {
  const supabase = await createSupabaseServerClient()

  const [{ data: kids }, { data: prefs }, weekPlan] = await Promise.all([
    supabase
      .from('kids')
      .select('name, age, color, tags')
      .eq('family_id', family.id)
      .order('created_at', { ascending: true }),
    supabase.from('family_preferences').select('kind, text').eq('family_id', family.id),
    getCurrentWeekPlan(family.id)
  ])

  const values = (prefs ?? []).filter((p) => p.kind === 'value').map((p) => p.text)
  const constraints = (prefs ?? []).filter((p) => p.kind === 'constraint').map((p) => p.text)
  const dislikes = (prefs ?? []).filter((p) => p.kind === 'dislike').map((p) => p.text)

  const kidLines =
    kids && kids.length > 0
      ? kids
          .map(
            (k) => `- ${k.name} (age ${k.age}${k.tags.length > 0 ? `, ${k.tags.join(', ')}` : ''})`
          )
          .join('\n')
      : '- (no kids on file)'

  const todayIso = isoDate(new Date())
  const monIso = isoDate(mostRecentMonday(new Date()))
  const weekStatus = weekPlan
    ? `Current week (${weekPlan.week_start_date}) is planned. Status: ${weekPlan.status}.`
    : `No week plan exists for the week of ${monIso}.`

  return [
    `You are Nido's voice assistant for the ${family.household_name} household.`,
    `Today is ${todayIso}. ${family.city ? `City: ${family.city}.` : ''} Locale: ${family.locale}.`,
    family.methodologies.length > 0
      ? `Parenting methodologies: ${family.methodologies.join(', ')}.`
      : '',
    '',
    'Kids:',
    kidLines,
    '',
    values.length > 0 ? `Family values: ${values.join('; ')}.` : '',
    constraints.length > 0 ? `Hard constraints (never violate): ${constraints.join('; ')}.` : '',
    dislikes.length > 0 ? `Dislikes (avoid): ${dislikes.join('; ')}.` : '',
    '',
    weekStatus,
    '',
    'Instructions:',
    '- Speak in the same language the user speaks (English or Spanish). Mirror their language.',
    '- Be concise. Caregivers are usually mid-task with kids.',
    '- For schedule questions, call `query_schedule` first; do not guess. Each activity in the response carries an `id` — keep track of it for any follow-up write.',
    '- For "when can I fit X?" questions, call `suggest_time_slot` and propose the result conversationally.',
    '- For weather questions, call `get_weather`. Do not invent the forecast.',
    '- Reference kids by their first names when natural.',
    '',
    'CONFIRM-BEFORE-WRITE (mandatory for add_activity, add_personal_activity, set_activity_status, remove_personal_activity, regenerate_day):',
    '  1. Repeat back the parsed intent in plain language. Example: "Got it — add gym Monday at 8am for an hour. Confirm?"',
    '  2. Wait for explicit yes from the user (yes / yep / sí / correcto / confirm / do it).',
    '  3. ONLY THEN call the tool with `confirmed: true`.',
    '  4. If the user says no / cancel / wait / never mind, do NOT call the tool. Acknowledge and ask what they want instead.',
    '  5. Calling a write tool without `confirmed: true` will fail with `confirmation_required` — treat that as a reminder to confirm verbally first.',
    '',
    'When calling regenerate_day, tell the user "regenerating now — takes about 10 to 15 seconds" before invoking, since the tool blocks for that long.'
  ]
    .filter(Boolean)
    .join('\n')
}
