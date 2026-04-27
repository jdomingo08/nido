import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/supabase/database.types'

export type WeekPlan = Tables<'week_plans'>
export type Activity = Tables<'activities'>

export function mostRecentMonday(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - diff)
  return d
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function getCurrentWeekPlan(familyId: string): Promise<WeekPlan | null> {
  const supabase = await createSupabaseServerClient()
  const weekStart = isoDate(mostRecentMonday(new Date()))
  const { data } = await supabase
    .from('week_plans')
    .select('*')
    .eq('family_id', familyId)
    .eq('week_start_date', weekStart)
    .maybeSingle()
  return data
}

export async function getActivitiesForWeek(weekPlanId: string): Promise<Activity[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('activities')
    .select('*')
    .eq('week_plan_id', weekPlanId)
    .order('day', { ascending: true })
    .order('start_hour', { ascending: true })
  return data ?? []
}

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayId = (typeof DAYS)[number]

export const DAY_LABELS: Record<DayId, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday'
}
