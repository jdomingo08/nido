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
    '- For schedule questions, call `query_schedule` first; do not guess.',
    '- For "when can I fit X?" questions, call `suggest_time_slot` and propose the result conversationally.',
    '- This session is read-only — you cannot modify the schedule. If the user asks to change anything, apologize and tell them to use the dashboard for now.',
    '- Reference kids by their first names when natural.'
  ]
    .filter(Boolean)
    .join('\n')
}
