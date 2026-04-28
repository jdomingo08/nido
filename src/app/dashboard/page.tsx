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
  type Activity
} from '@/domains/planning/server/queries'
import { getPersonalActivitiesForWeek } from '@/domains/personal/server/queries'
import { fetchForecastForCity, type DayForecast } from '@/lib/weather/openmeteo'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AddPersonalActivityButton } from './add-personal-activity-button'
import { WeekGrid } from './week-grid'
import { WeekNav } from './week-nav'

const WEEK_QUERY_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function DashboardPage({
  searchParams
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()
  const { week: weekQuery } = await searchParams

  // Resolve target week. Bad query → snap to current Monday.
  const targetWeekIso = resolveWeekStart(weekQuery)

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
  // Forecast isn't displayed in the grid yet (it lives on day pages); we
  // hold onto it here for future inline-grid rendering.
  void forecast

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
          <AddPersonalActivityButton />
          {weekPlan && (
            <p className="font-mono text-[11px] tracking-widest uppercase opacity-60">
              {countByStatus(activities, 'approved')} approved ·{' '}
              {countByStatus(activities, 'proposed')} to sort
            </p>
          )}
        </div>

        <div className="mt-6">
          {weekPlan ? (
            <WeekGrid
              activities={activities}
              personal={personalActivities}
              kids={kids ?? []}
              weekStartDate={targetWeekIso}
            />
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
    // Snap any date in the query to its Monday so prev/next math is consistent.
    return isoDate(mostRecentMonday(new Date(query + 'T12:00:00')))
  }
  return isoDate(mostRecentMonday(new Date()))
}

function addDaysIso(weekStartIso: string, days: number): string {
  const d = new Date(weekStartIso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return isoDate(d)
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
