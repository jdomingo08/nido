import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFamily } from '@/domains/family/server/auth'

// regenerateDay calls the LLM and can take 10–20s. Give it headroom on Vercel.
export const maxDuration = 60
import {
  DAY_LABELS,
  DAYS,
  getActivitiesForWeek,
  getWeekPlan,
  isoDate,
  mostRecentMonday,
  type DayId
} from '@/domains/planning/server/queries'
import { getPersonalActivitiesForWeek } from '@/domains/personal/server/queries'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchForecastForCity, type DayForecast } from '@/lib/weather/openmeteo'
import { WeatherStrip } from '../weather-strip'
import { DayTimeline } from './day-timeline'
import { RegenerateDayButton } from './regenerate-day-button'

const VALID_DAYS = DAYS as readonly string[]
const WEEK_QUERY_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function DayPage({
  params,
  searchParams
}: {
  params: Promise<{ day: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const { day: dayParam } = await params
  const { week: weekQuery } = await searchParams
  if (!VALID_DAYS.includes(dayParam)) notFound()
  const day = dayParam as DayId

  // Same week-resolution rule as the dashboard root.
  const targetWeekIso = resolveWeekStart(weekQuery)

  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  const [{ data: kids }, weekPlan] = await Promise.all([
    supabase.from('kids').select('*').eq('family_id', family.id).order('created_at'),
    getWeekPlan(family.id, targetWeekIso)
  ])

  const [activities, personalActivities] = await Promise.all([
    weekPlan ? getActivitiesForWeek(weekPlan.id) : Promise.resolve([]),
    getPersonalActivitiesForWeek(family.id, new Date(targetWeekIso + 'T12:00:00'))
  ])

  const todays = activities.filter((a) => a.day === day)
  const todaysPersonal = personalActivities.filter((p) => p.resolved_day === day)

  // See dashboard/page.tsx for the resolution order. Same fallback here so
  // the hourly column populates even on weeks generated before the field
  // was added.
  let weekForecast = parseForecast(weekPlan?.weather_forecast)
  const needsLive = weekForecast.length === 0 || !weekForecast[0]?.hourly
  if (needsLive && family.city) {
    const live = await fetchForecastForCity({
      city: family.city,
      startDate: new Date(targetWeekIso + 'T12:00:00')
    })
    if (live.length > 0) weekForecast = live
  }
  const forecast = weekForecast.find((f) => f.day === day)

  const weekQS = `?week=${targetWeekIso}`

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <Link
            href={`/dashboard${weekQS}`}
            className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
          >
            ← week
          </Link>
          <div className="flex gap-2">
            {DAYS.map((d) => (
              <Link
                key={d}
                href={`/dashboard/${d}${weekQS}`}
                className={`rounded-md border-2 border-[#16121A] px-2 py-1 text-[11px] font-bold tracking-widest uppercase ${
                  d === day ? 'bg-[#16121A] text-[#FBF5E8]' : 'bg-[#FBF5E8]'
                }`}
              >
                {d}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-widest uppercase opacity-60">
              {formatDayDate(targetWeekIso, day)}
            </p>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{DAY_LABELS[day]}.</h1>
            <p className="mt-1 font-mono text-[11px] tracking-widest uppercase opacity-60">
              {todays.length} kid · {todaysPersonal.length} you
            </p>
          </div>
          {weekPlan && <RegenerateDayButton day={day} weekStartIso={targetWeekIso} />}
        </div>

        {forecast && (
          <div className="mt-4">
            <WeatherStrip dayForecast={forecast} />
          </div>
        )}

        <DayTimeline
          activities={todays}
          personal={todaysPersonal}
          kids={kids ?? []}
          agentLevel={family.agent_level}
          hourly={forecast?.hourly}
        />
      </div>
    </main>
  )
}

function resolveWeekStart(query: string | undefined): string {
  if (query && WEEK_QUERY_RE.test(query)) {
    return isoDate(mostRecentMonday(new Date(query + 'T12:00:00')))
  }
  return isoDate(mostRecentMonday(new Date()))
}

function parseForecast(raw: unknown): DayForecast[] {
  if (!Array.isArray(raw)) return []
  return raw as DayForecast[]
}

function formatDayDate(weekStartIso: string, day: DayId): string {
  const start = new Date(weekStartIso + 'T12:00:00')
  const offset = DAYS.indexOf(day)
  const d = new Date(start)
  d.setDate(start.getDate() + offset)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
