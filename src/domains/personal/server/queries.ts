import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/supabase/database.types'
import { isoDate, type DayId, DAYS } from '@/domains/planning/server/queries'

export type PersonalActivity = Tables<'personal_activities'>

// A personal activity materialized into a specific day. Recurring rules
// expand into one of these per active day; one-off rows pass through as-is.
export type ScheduledPersonalActivity = PersonalActivity & {
  resolved_day: DayId
}

export async function getPersonalActivitiesForWeek(
  familyId: string,
  weekStartDate: Date
): Promise<ScheduledPersonalActivity[]> {
  const supabase = await createSupabaseServerClient()
  const weekIso = isoDate(weekStartDate)

  // One-off events scoped to this exact week.
  const { data: oneOffs } = await supabase
    .from('personal_activities')
    .select('*')
    .eq('family_id', familyId)
    .eq('is_recurring', false)
    .eq('week_start_date', weekIso)

  // Recurring rules — pull all, filter active window in code.
  const { data: recurring } = await supabase
    .from('personal_activities')
    .select('*')
    .eq('family_id', familyId)
    .eq('is_recurring', true)

  const result: ScheduledPersonalActivity[] = []

  for (const o of oneOffs ?? []) {
    if (o.day && (DAYS as readonly string[]).includes(o.day)) {
      result.push({ ...o, resolved_day: o.day as DayId })
    }
  }

  for (const r of recurring ?? []) {
    if (!isActiveOnWeek(r, weekIso)) continue
    for (const d of r.recurring_days) {
      if ((DAYS as readonly string[]).includes(d)) {
        result.push({ ...r, resolved_day: d as DayId })
      }
    }
  }

  // Sort within day by start time
  result.sort(
    (a, b) =>
      DAYS.indexOf(a.resolved_day) - DAYS.indexOf(b.resolved_day) || a.start_hour - b.start_hour
  )

  return result
}

function isActiveOnWeek(r: PersonalActivity, weekIso: string): boolean {
  if (r.active_from && r.active_from > weekIso) return false
  if (r.active_until && r.active_until < weekIso) return false
  return true
}
