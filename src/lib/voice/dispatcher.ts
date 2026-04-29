import 'server-only'

import {
  DAYS,
  getActivitiesForWeek,
  getWeekPlan,
  isoDate,
  mostRecentMonday,
  type Activity,
  type DayId
} from '@/domains/planning/server/queries'
import {
  getPersonalActivitiesForWeek,
  type ScheduledPersonalActivity
} from '@/domains/personal/server/queries'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchCurrentWeatherForCity, fetchForecastForCity } from '@/lib/weather/openmeteo'
import {
  GetWeatherInput,
  QueryScheduleInput,
  SuggestTimeSlotInput,
  VOICE_TOOLS,
  type VoiceTool
} from './tools'

// ─── Public dispatcher ──────────────────────────────────────────

export type DispatchResult = { ok: true; result: unknown } | { ok: false; error: string }

export async function dispatchTool(
  name: string,
  rawArgs: unknown,
  familyId: string
): Promise<DispatchResult> {
  const tool: VoiceTool | undefined = VOICE_TOOLS[name]
  if (!tool) return { ok: false, error: `unknown_tool:${name}` }

  // Slice 1 has only read tools — no confirm gate required. The gate lives
  // in this dispatcher in slice 2 when write tools land.

  const parsed = tool.schema.safeParse(rawArgs)
  if (!parsed.success) {
    return { ok: false, error: `invalid_args:${parsed.error.message}` }
  }

  switch (name) {
    case 'query_schedule':
      return ok(await handleQuerySchedule(parsed.data as QueryScheduleArgs, familyId))
    case 'suggest_time_slot':
      return ok(await handleSuggestTimeSlot(parsed.data as SuggestTimeSlotArgs, familyId))
    case 'get_weather':
      return ok(await handleGetWeather(parsed.data as GetWeatherArgs, familyId))
    default:
      return { ok: false, error: `no_handler:${name}` }
  }
}

function ok(result: unknown): DispatchResult {
  return { ok: true, result }
}

// ─── Handlers ───────────────────────────────────────────────────

type QueryScheduleArgs = ReturnType<typeof QueryScheduleInput.parse>
type SuggestTimeSlotArgs = ReturnType<typeof SuggestTimeSlotInput.parse>
type GetWeatherArgs = ReturnType<typeof GetWeatherInput.parse>

async function handleQuerySchedule(args: QueryScheduleArgs, familyId: string) {
  const weekIso = args.week_start_date ?? isoDate(mostRecentMonday(new Date()))
  const weekPlan = await getWeekPlan(familyId, weekIso)

  const [activities, personal] = await Promise.all([
    weekPlan ? getActivitiesForWeek(weekPlan.id) : Promise.resolve([] as Activity[]),
    getPersonalActivitiesForWeek(familyId, new Date(weekIso + 'T12:00:00'))
  ])

  // Compact, model-friendly digest. Skip raw UUIDs in the values returned
  // to the model (it doesn't need them yet); shape the day-by-day summary
  // as terse strings so the model can read it back conversationally.
  const byDay: Record<
    string,
    Array<{ time: string; duration_min: number; title: string; kind: 'kid' | 'you' }>
  > = {}
  for (const day of DAYS) byDay[day] = []

  for (const a of activities) {
    byDay[a.day]!.push({
      time: formatHour(a.start_hour),
      duration_min: a.duration_min,
      title: a.title,
      kind: 'kid'
    })
  }
  for (const p of personal as ScheduledPersonalActivity[]) {
    byDay[p.resolved_day]!.push({
      time: formatHour(Number(p.start_hour)),
      duration_min: p.duration_min,
      title: p.title,
      kind: 'you'
    })
  }
  for (const day of DAYS) byDay[day]!.sort((a, b) => a.time.localeCompare(b.time))

  return {
    week_start_date: weekIso,
    has_plan: Boolean(weekPlan),
    by_day: byDay
  }
}

async function handleSuggestTimeSlot(args: SuggestTimeSlotArgs, familyId: string) {
  const weekIso = args.week_start_date ?? isoDate(mostRecentMonday(new Date()))
  const weekPlan = await getWeekPlan(familyId, weekIso)

  const [activities, personal] = await Promise.all([
    weekPlan ? getActivitiesForWeek(weekPlan.id) : Promise.resolve([] as Activity[]),
    getPersonalActivitiesForWeek(familyId, new Date(weekIso + 'T12:00:00'))
  ])

  const dayCandidates: DayId[] = args.preferred_day
    ? [args.preferred_day]
    : (DAYS as readonly DayId[]).slice()
  const durationHr = args.duration_min / 60

  // Build per-day busy intervals (in fractional hours).
  type Interval = { start: number; end: number }
  const byDay = new Map<DayId, Interval[]>()
  for (const day of dayCandidates) byDay.set(day, [])
  for (const a of activities) {
    if (!byDay.has(a.day as DayId)) continue
    byDay.get(a.day as DayId)!.push({
      start: a.start_hour,
      end: a.start_hour + a.duration_min / 60
    })
  }
  for (const p of personal) {
    if (!byDay.has(p.resolved_day)) continue
    const start = Number(p.start_hour)
    byDay.get(p.resolved_day)!.push({
      start,
      end: start + p.duration_min / 60
    })
  }

  // Search the 6am–10pm window in 30-minute increments. Return up to 5 fits.
  const SEARCH_START = 6
  const SEARCH_END = 22
  const STEP = 0.5
  const suggestions: Array<{
    day: DayId
    start_hour: number
    end_hour: number
    label: string
  }> = []

  for (const day of dayCandidates) {
    const busy = (byDay.get(day) ?? []).slice().sort((a, b) => a.start - b.start)
    for (let t = SEARCH_START; t + durationHr <= SEARCH_END; t += STEP) {
      const end = t + durationHr
      const conflicts = busy.some((b) => t < b.end && end > b.start)
      if (!conflicts) {
        suggestions.push({
          day,
          start_hour: t,
          end_hour: end,
          label: `${day} ${formatHour(t)}–${formatHour(end)}`
        })
        if (suggestions.length >= 5) break
      }
    }
    if (suggestions.length >= 5) break
  }

  return {
    week_start_date: weekIso,
    duration_min: args.duration_min,
    preferred_day: args.preferred_day ?? null,
    suggestions
  }
}

function formatHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
}

async function handleGetWeather(args: GetWeatherArgs, familyId: string) {
  const supabase = await createSupabaseServerClient()
  const { data: family } = await supabase
    .from('families')
    .select('city')
    .eq('id', familyId)
    .maybeSingle()
  const city = family?.city ?? null
  if (!city) {
    return { ok: false, error: 'no_city_on_family' }
  }

  const weekIso = args.week_start_date ?? isoDate(mostRecentMonday(new Date()))
  const startDate = new Date(weekIso + 'T12:00:00')

  const [current, forecast] = await Promise.all([
    fetchCurrentWeatherForCity(city),
    fetchForecastForCity({ city, startDate })
  ])

  // Daily summary the model can read back conversationally.
  const days = forecast.map((d) => ({
    day: d.day,
    date: d.date,
    morning: { label: d.parts.morning.label, temp_f: d.parts.morning.temp_f },
    afternoon: { label: d.parts.afternoon.label, temp_f: d.parts.afternoon.temp_f },
    evening: { label: d.parts.evening.label, temp_f: d.parts.evening.temp_f }
  }))

  // Resolve the focused day if one was requested.
  let focusDay: DayId | null = null
  if (args.day === 'today') {
    focusDay = isoDateToDayId(isoDate(new Date()))
  } else if (args.day === 'tomorrow') {
    const t = new Date()
    t.setDate(t.getDate() + 1)
    focusDay = isoDateToDayId(isoDate(t))
  } else if (args.day) {
    focusDay = args.day
  }

  const focusEntry = focusDay ? forecast.find((f) => f.day === focusDay) : null
  const focus = focusEntry
    ? {
        day: focusEntry.day,
        date: focusEntry.date,
        hourly: (focusEntry.hourly ?? []).map((h) => ({
          hour: h.hour,
          label: codeLabel(h.code),
          temp_f: h.temp_f
        }))
      }
    : null

  return {
    city,
    week_start_date: weekIso,
    current: current
      ? {
          label: current.label,
          temp_f: current.temp_f,
          temp_c: current.temp_c
        }
      : null,
    days,
    focus
  }
}

// Tiny WMO-code → label so the per-hour data is human-readable for the model.
// Mirrors codeToLabel in openmeteo.ts but kept inline to avoid exporting more
// surface area from that module.
function codeLabel(code: number): string {
  if (code === 0) return 'clear'
  if (code <= 2) return 'partly cloudy'
  if (code === 3) return 'overcast'
  if (code <= 48) return 'foggy'
  if (code <= 57) return 'drizzle'
  if (code <= 67) return 'rainy'
  if (code <= 77) return 'snowy'
  if (code <= 82) return 'showers'
  if (code <= 86) return 'snowy'
  if (code <= 99) return 'storm'
  return 'cloudy'
}

function isoDateToDayId(iso: string): DayId {
  const d = new Date(iso + 'T12:00:00')
  const idx = d.getDay() // 0=Sun, 1=Mon ... 6=Sat
  const ids: DayId[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  return ids[idx] ?? 'mon'
}
