import { requireFamily } from '@/domains/family/server/auth'

// generateCurrentWeek + regenerateCurrentWeek can take 30–60s on the LLM call.
// Vercel hobby allows up to 60s when configured; default is 10s which would
// kill the request. Set the ceiling for any server action invoked from this
// page.
export const maxDuration = 60
import {
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
import { fetchForecastForCity, type DayForecast } from '@/lib/weather/openmeteo'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AddPersonalActivityButton } from './add-personal-activity-button'
import { ViewToggle, type DashboardView } from './view-toggle'
import { WeekGrid } from './week-grid'
import { WeekNav } from './week-nav'
import { WeekSummary } from './week-summary'

const WEEK_QUERY_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ week?: string; view?: string }>
}) {
  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()
  const { week: weekQuery, view: viewQuery } = await searchParams

  // Resolve target week. Bad query → snap to current Monday.
  const targetWeekIso = resolveWeekStart(weekQuery)
  const view: DashboardView = viewQuery === 'summary' ? 'summary' : 'grid'

  const { data: kids } = await supabase
    .from('kids')
    .select('*')
    .eq('family_id', family.id)
    .order('created_at', { ascending: true })

  const weekPlan = await getWeekPlan(family.id, targetWeekIso)
  const [activities, personalActivities] = await Promise.all([
    weekPlan ? getActivitiesForWeek(weekPlan.id) : Promise.resolve([]),
    getPersonalActivitiesForWeek(family.id, new Date(targetWeekIso + 'T12:00:00'))
  ])

  // Forecast: saved JSON first, fall back to live fetch when missing or
  // pre-dates the hourly field.
  let forecast = parseForecast(weekPlan?.weather_forecast)
  const needsLive = forecast.length === 0 || !forecast[0]?.hourly
  if (needsLive && family.city) {
    const live = await fetchForecastForCity({
      city: family.city,
      startDate: new Date(targetWeekIso + 'T12:00:00')
    })
    if (live.length > 0) forecast = live
  }

  // Both views share the source data; the summary view also wants per-day
  // groupings + a forecast lookup. Compute lazily — these are cheap.
  const byDay = groupByDay(activities)
  const personalByDay = groupPersonalByDay(personalActivities)
  const forecastByDay = new Map<DayId, DayForecast>(forecast.map((d) => [d.day, d]))

  const prevWeekIso = addDaysIso(targetWeekIso, -7)
  const nextWeekIso = addDaysIso(targetWeekIso, 7)

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-widest uppercase opacity-60">
              week of {formatDate(targetWeekIso)} · {family.city ?? '—'}
            </p>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">the week.</h1>
            {family.methodologies.length > 0 && (
              <p className="mt-1 font-mono text-[11px] tracking-widest uppercase opacity-60">
                {family.methodologies.join(' · ')}
              </p>
            )}
          </div>
          <WeekNav
            weekStartDate={targetWeekIso}
            hasPlan={Boolean(weekPlan)}
            prevWeekStart={prevWeekIso}
            nextWeekStart={nextWeekIso}
          />
        </header>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <AddPersonalActivityButton />
            <ViewToggle current={view} />
          </div>
          {weekPlan && (
            <p className="font-mono text-[11px] tracking-widest uppercase opacity-60">
              {countByStatus(activities, 'approved')} approved ·{' '}
              {countByStatus(activities, 'proposed')} to sort
            </p>
          )}
        </div>

        <div className="mt-6">
          {weekPlan ? (
            view === 'grid' ? (
              <WeekGrid
                activities={activities}
                personal={personalActivities}
                kids={kids ?? []}
                weekStartDate={targetWeekIso}
              />
            ) : (
              <>
                <WeekSummary
                  activitiesByDay={byDay}
                  personalByDay={personalByDay}
                  forecastByDay={forecastByDay}
                  weekStartDate={targetWeekIso}
                />
                <p className="mt-4 font-mono text-[11px] tracking-widest uppercase opacity-50">
                  tap any day to drill into the timeline.
                </p>
              </>
            )
          ) : (
            <EmptyWeekShell weekStartIso={targetWeekIso} />
          )}
        </div>
      </div>
    </main>
  )
}

function EmptyWeekShell({ weekStartIso }: { weekStartIso: string }) {
  return (
    <section className="rounded-2xl border-2 border-dashed border-[#16121A] bg-[#FBF5E8]/60 p-10 text-center">
      <p className="font-mono text-xs tracking-widest uppercase opacity-60">no plan yet</p>
      <h2 className="mt-2 text-2xl font-bold tracking-tight">
        nothing planned for {formatDate(weekStartIso)}.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm opacity-75">
        use the buttons up top to plan this week or browse another one.
      </p>
    </section>
  )
}

// ─── helpers ──────────────────────────────────────────────────

function resolveWeekStart(query: string | undefined): string {
  if (query && WEEK_QUERY_RE.test(query)) {
    return isoDate(mostRecentMonday(new Date(query + 'T12:00:00')))
  }
  return isoDate(mostRecentMonday(new Date()))
}

function addDaysIso(weekStartIso: string, days: number): string {
  const d = new Date(weekStartIso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

function groupByDay(activities: Activity[]): Partial<Record<DayId, Activity[]>> {
  const out: Partial<Record<DayId, Activity[]>> = {}
  for (const a of activities) {
    const day = a.day as DayId
    if (!out[day]) out[day] = []
    out[day]!.push(a)
  }
  return out
}

function groupPersonalByDay(
  activities: ScheduledPersonalActivity[]
): Partial<Record<DayId, ScheduledPersonalActivity[]>> {
  const out: Partial<Record<DayId, ScheduledPersonalActivity[]>> = {}
  for (const a of activities) {
    if (!out[a.resolved_day]) out[a.resolved_day] = []
    out[a.resolved_day]!.push(a)
  }
  return out
}

function countByStatus(activities: Activity[], status: string): number {
  return activities.filter((a) => a.status === status).length
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function parseForecast(raw: unknown): DayForecast[] {
  if (!Array.isArray(raw)) return []
  return raw as DayForecast[]
}
