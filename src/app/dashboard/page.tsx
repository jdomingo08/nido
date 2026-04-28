import Link from 'next/link'
import { requireFamily } from '@/domains/family/server/auth'

// generateCurrentWeek + regenerateCurrentWeek can take 30–60s on the LLM call.
// Vercel hobby allows up to 60s when configured; default is 10s which would
// kill the request. Set the ceiling for any server action invoked from this
// page.
export const maxDuration = 60
import { signOut } from '@/domains/family/server/onboarding'
import { generateCurrentWeek, regenerateCurrentWeek } from '@/domains/planning/server/orchestrator'
import {
  getActivitiesForWeek,
  getCurrentWeekPlan,
  mostRecentMonday,
  type Activity,
  type DayId
} from '@/domains/planning/server/queries'
import {
  getPersonalActivitiesForWeek,
  type ScheduledPersonalActivity
} from '@/domains/personal/server/queries'
import { fetchForecastForCity, type DayForecast } from '@/lib/weather/openmeteo'
import { GenerateWeekButton } from './generate-week-button'
import { RegenerateWeekButton } from './regenerate-week-button'
import { AddPersonalActivityButton } from './add-personal-activity-button'
import { WeekSummary } from './week-summary'

export default async function DashboardPage() {
  const { user, family } = await requireFamily()

  const weekPlan = await getCurrentWeekPlan(family.id)
  const [activities, personalActivities] = await Promise.all([
    weekPlan ? getActivitiesForWeek(weekPlan.id) : Promise.resolve([]),
    getPersonalActivitiesForWeek(family.id, mostRecentMonday(new Date()))
  ])

  const byDay = groupByDay(activities)
  const personalByDay = groupPersonalByDay(personalActivities)

  // Forecast resolution order:
  //   1. Saved JSON on the week_plan (cheapest)
  //   2. Live Open-Meteo lookup if saved JSON is missing or pre-dates the
  //      hourly field (so weeks generated before this feature was wired
  //      still show weather without forcing a regen).
  let forecast = parseForecast(weekPlan?.weather_forecast)
  const needsLive = forecast.length === 0 || !forecast[0]?.hourly
  if (needsLive && family.city) {
    const live = await fetchForecastForCity({
      city: family.city,
      startDate: mostRecentMonday(new Date())
    })
    if (live.length > 0) forecast = live
  }
  const forecastByDay = new Map<DayId, DayForecast>(forecast.map((d) => [d.day, d]))

  return (
    <main className="min-h-screen bg-[#F5ECDC] p-6 md:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs tracking-widest uppercase opacity-60">
              {family.household_name} · {family.city ?? '—'}
            </p>
            <p className="font-mono text-[11px] tracking-widest uppercase opacity-50">
              signed in · {user.email}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/settings"
              className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
            >
              settings
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
              >
                sign out
              </button>
            </form>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-start gap-3">
          <AddPersonalActivityButton />
          <p className="max-w-md font-mono text-[11px] tracking-widest uppercase opacity-50">
            your work, exercise, meals — used as constraints by the orchestrator.
          </p>
        </div>

        {!weekPlan && (
          <section className="mt-10 rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-8 text-center shadow-[4px_4px_0_#16121A]">
            <p className="font-mono text-xs tracking-widest uppercase opacity-60">no week yet</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
              ready to plan this week?
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm opacity-75">
              we&apos;ll generate{' '}
              {family.density === 'calm' ? '~21' : family.density === 'packed' ? '~49' : '~35'}{' '}
              activities tuned to your kids&apos; ages,{' '}
              {family.methodologies.length > 0
                ? `your ${family.methodologies.join(' + ')}`
                : 'a blend of'}{' '}
              preferences, and your constraints. first run takes 30–60 seconds.
            </p>
            <div className="mt-6 flex justify-center">
              <GenerateWeekButton action={generateCurrentWeek} />
            </div>
          </section>
        )}

        {weekPlan && (
          <section className="mt-8">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-xs tracking-widest uppercase opacity-60">
                  week of {formatDate(weekPlan.week_start_date)}
                </p>
                <h1 className="text-3xl font-bold tracking-tight md:text-4xl">the week.</h1>
                {family.methodologies.length > 0 && (
                  <p className="mt-1 font-mono text-[11px] tracking-widest uppercase opacity-60">
                    {family.methodologies.join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="font-mono text-xs tracking-widest uppercase opacity-60">
                  {countByStatus(activities, 'approved')} approved ·{' '}
                  {countByStatus(activities, 'proposed')} to sort
                </div>
                <RegenerateWeekButton action={regenerateCurrentWeek} />
              </div>
            </div>

            <div className="mt-6">
              <WeekSummary
                activitiesByDay={byDay}
                personalByDay={personalByDay}
                forecastByDay={forecastByDay}
                weekStartDate={weekPlan.week_start_date}
              />
              <p className="mt-4 font-mono text-[11px] tracking-widest uppercase opacity-50">
                tap any day to drill into the timeline.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  )
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
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function parseForecast(raw: unknown): DayForecast[] {
  if (!Array.isArray(raw)) return []
  return raw as DayForecast[]
}
