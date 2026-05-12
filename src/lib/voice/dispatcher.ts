import 'server-only'

import { revalidatePath } from 'next/cache'
import { regenerateDayInternal } from '@/domains/planning/server/orchestrator'
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
  AddActivityInput,
  AddPersonalActivityInput,
  GetWeatherInput,
  QueryScheduleInput,
  RegenerateDayInput,
  RemovePersonalActivityInput,
  SetActivityStatusInput,
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

  // Confirm gate for write tools. Cheap belt-and-suspenders check on top of
  // the Zod `confirmed: z.literal(true)` requirement — same outcome whichever
  // hits first; this lets us return a clearer error string to the model.
  if (tool.kind === 'write') {
    const confirmed = (rawArgs as { confirmed?: unknown } | null)?.confirmed
    if (confirmed !== true) {
      return {
        ok: false,
        error:
          'confirmation_required: repeat back the parsed intent to the user, wait for explicit yes, then call again with confirmed: true'
      }
    }
  }

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
    case 'add_activity':
      return ok(await handleAddActivity(parsed.data as AddActivityArgs, familyId))
    case 'add_personal_activity':
      return ok(await handleAddPersonalActivity(parsed.data as AddPersonalActivityArgs, familyId))
    case 'set_activity_status':
      return ok(await handleSetActivityStatus(parsed.data as SetActivityStatusArgs, familyId))
    case 'remove_personal_activity':
      return ok(
        await handleRemovePersonalActivity(parsed.data as RemovePersonalActivityArgs, familyId)
      )
    case 'regenerate_day':
      return ok(await handleRegenerateDay(parsed.data as RegenerateDayArgs, familyId))
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
type AddActivityArgs = ReturnType<typeof AddActivityInput.parse>
type AddPersonalActivityArgs = ReturnType<typeof AddPersonalActivityInput.parse>
type SetActivityStatusArgs = ReturnType<typeof SetActivityStatusInput.parse>
type RemovePersonalActivityArgs = ReturnType<typeof RemovePersonalActivityInput.parse>
type RegenerateDayArgs = ReturnType<typeof RegenerateDayInput.parse>

async function handleQuerySchedule(args: QueryScheduleArgs, familyId: string) {
  const weekIso = args.week_start_date ?? isoDate(mostRecentMonday(new Date()))
  const weekPlan = await getWeekPlan(familyId, weekIso)

  const [activities, personal] = await Promise.all([
    weekPlan ? getActivitiesForWeek(weekPlan.id) : Promise.resolve([] as Activity[]),
    getPersonalActivitiesForWeek(familyId, new Date(weekIso + 'T12:00:00'))
  ])

  // Compact, model-friendly digest. IDs are included so the model can pass
  // them back to write tools (set_activity_status, remove_personal_activity).
  const byDay: Record<
    string,
    Array<{
      id: string
      time: string
      duration_min: number
      title: string
      kind: 'kid' | 'you'
      status?: string
    }>
  > = {}
  for (const day of DAYS) byDay[day] = []

  for (const a of activities) {
    byDay[a.day]!.push({
      id: a.id,
      time: formatHour(a.start_hour),
      duration_min: a.duration_min,
      title: a.title,
      kind: 'kid',
      status: a.status
    })
  }
  for (const p of personal as ScheduledPersonalActivity[]) {
    byDay[p.resolved_day]!.push({
      id: p.id,
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

// ─── Write handlers ────────────────────────────────────────────

const COLOR_BY_CATEGORY: Record<AddPersonalActivityArgs['category'], string> = {
  work: 'electric',
  exercise: 'aqua',
  meal: 'sunset',
  errand: 'citrus',
  family: 'flamingo',
  personal: 'lavender',
  other: 'ink'
}

async function handleAddActivity(args: AddActivityArgs, familyId: string) {
  const supabase = await createSupabaseServerClient()
  const weekIso = isoDate(mostRecentMonday(new Date()))
  const weekPlan = await getWeekPlan(familyId, weekIso)
  if (!weekPlan) {
    return {
      ok: false,
      error: 'no_week_plan',
      message:
        "There's no plan for this week yet. Generate the week from the dashboard first, then try again."
    }
  }

  // Resolve kid_names → kid_ids (case-insensitive). Drop unmatched names.
  const { data: kids } = await supabase.from('kids').select('id, name').eq('family_id', familyId)
  const lowerNames = args.kid_names.map((n) => n.trim().toLowerCase())
  const matched = (kids ?? []).filter((k) => lowerNames.includes(k.name.toLowerCase()))
  if (matched.length === 0) {
    return {
      ok: false,
      error: 'no_matching_kids',
      message: `Couldn't find any of: ${args.kid_names.join(', ')}. Roster is: ${(kids ?? []).map((k) => k.name).join(', ')}.`
    }
  }
  const kid_ids = matched.map((k) => k.id)

  const { data: row, error } = await supabase
    .from('activities')
    .insert({
      week_plan_id: weekPlan.id,
      family_id: familyId,
      day: args.day,
      start_hour: args.start_hour,
      duration_min: args.duration_min,
      kid_ids,
      title: args.title,
      summary: args.title,
      bucket: 'creative', // sensible default; user can change in dashboard
      status: 'approved'
    })
    .select('id')
    .single()
  if (error || !row) throw new Error(error?.message ?? 'insert_failed')

  revalidatePath('/dashboard', 'layout')
  return {
    activity_id: row.id,
    day: args.day,
    start_time: formatHour(args.start_hour),
    duration_min: args.duration_min,
    kid_names: matched.map((k) => k.name),
    title: args.title
  }
}

async function handleAddPersonalActivity(args: AddPersonalActivityArgs, familyId: string) {
  const isRecurring = !!args.recurring_days && args.recurring_days.length > 0
  const isOneOff = !!args.day
  if (isRecurring && isOneOff) {
    return {
      ok: false,
      error: 'invalid_args',
      message: 'Provide either recurring_days OR day, not both.'
    }
  }
  if (!isRecurring && !isOneOff) {
    return {
      ok: false,
      error: 'invalid_args',
      message: 'Provide either recurring_days (for weekly rule) or day (for one-off).'
    }
  }

  const color = COLOR_BY_CATEGORY[args.category]
  const supabase = await createSupabaseServerClient()
  const weekIso = isoDate(mostRecentMonday(new Date()))

  const insertData = {
    family_id: familyId,
    family_member_id: null,
    title: args.title,
    category: args.category,
    color,
    notes: args.notes ?? null,
    start_hour: args.start_hour,
    duration_min: args.duration_min,
    is_recurring: isRecurring,
    recurring_days: isRecurring ? (args.recurring_days as string[]) : [],
    day: isRecurring ? null : (args.day as string),
    week_start_date: isRecurring ? null : weekIso
  }

  const { data: row, error } = await supabase
    .from('personal_activities')
    .insert(insertData)
    .select('id')
    .single()
  if (error || !row) throw new Error(error?.message ?? 'insert_failed')

  revalidatePath('/dashboard', 'layout')
  return {
    personal_activity_id: row.id,
    title: args.title,
    category: args.category,
    is_recurring: isRecurring,
    days: isRecurring ? args.recurring_days : [args.day]
  }
}

async function handleSetActivityStatus(args: SetActivityStatusArgs, familyId: string) {
  const supabase = await createSupabaseServerClient()
  const { data: row, error } = await supabase
    .from('activities')
    .update({ status: args.status })
    .eq('id', args.activity_id)
    .eq('family_id', familyId)
    .select('id, title, day, status')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) {
    return { ok: false, error: 'not_found', message: 'No matching activity in your family.' }
  }
  revalidatePath('/dashboard', 'layout')
  return { activity_id: row.id, title: row.title, day: row.day, status: row.status }
}

async function handleRemovePersonalActivity(args: RemovePersonalActivityArgs, familyId: string) {
  const supabase = await createSupabaseServerClient()
  const { data: row, error } = await supabase
    .from('personal_activities')
    .delete()
    .eq('id', args.activity_id)
    .eq('family_id', familyId)
    .select('id, title')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!row) {
    return {
      ok: false,
      error: 'not_found',
      message: 'No matching personal activity in your family.'
    }
  }
  revalidatePath('/dashboard', 'layout')
  return { personal_activity_id: row.id, title: row.title, removed: true }
}

async function handleRegenerateDay(args: RegenerateDayArgs, familyId: string) {
  const supabase = await createSupabaseServerClient()
  const { data: family } = await supabase.from('families').select('*').eq('id', familyId).single()
  if (!family) {
    return { ok: false, error: 'family_not_found' }
  }
  const weekIso = args.week_start_date ?? isoDate(mostRecentMonday(new Date()))

  // regenerate_day takes 10–15s on the LLM. The voice agent will sit silent
  // during that time which feels broken — the system prompt instructs the
  // model to say "regenerating now, takes about 10 seconds" before calling.
  const result = await regenerateDayInternal(family, args.day, weekIso)
  revalidatePath('/dashboard', 'layout')
  return {
    day: args.day,
    week_start_date: weekIso,
    activity_count: result.activityCount
  }
}
