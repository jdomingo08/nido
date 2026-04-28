import Link from 'next/link'
import { DAY_LABELS, DAYS, type Activity, type DayId } from '@/domains/planning/server/queries'
import type { ScheduledPersonalActivity } from '@/domains/personal/server/queries'
import type { DayForecast, PartForecast } from '@/lib/weather/openmeteo'
import { WeatherIconSvg } from './weather-icon'

export function WeekSummary({
  activitiesByDay,
  personalByDay,
  forecastByDay,
  weekStartDate
}: {
  activitiesByDay: Partial<Record<DayId, Activity[]>>
  personalByDay: Partial<Record<DayId, ScheduledPersonalActivity[]>>
  forecastByDay: Map<DayId, DayForecast>
  weekStartDate: string
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
      {DAYS.map((day, idx) => {
        const acts = activitiesByDay[day] ?? []
        const personal = personalByDay[day] ?? []
        const forecast = forecastByDay.get(day)
        const dateStr = computeDateLabel(weekStartDate, idx)

        return (
          <Link
            key={day}
            href={`/dashboard/${day}`}
            className="block rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-4 shadow-[3px_3px_0_#16121A] transition hover:translate-y-[-2px] hover:shadow-[5px_5px_0_#16121A]"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] tracking-widest uppercase opacity-60">
                {DAY_LABELS[day].slice(0, 3)}
              </span>
              <span className="font-mono text-[10px] tracking-widest uppercase opacity-50">
                {dateStr}
              </span>
            </div>

            {forecast && (
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-[#16121A]/30 bg-[#F5ECDC] p-1.5">
                <PartCell label="morning" part={forecast.parts.morning} />
                <PartCell label="midday" part={forecast.parts.afternoon} />
                <PartCell label="evening" part={forecast.parts.evening} />
              </div>
            )}

            <div className="mt-2 flex items-center gap-2 font-mono text-[11px] tracking-widest uppercase">
              <Pill bg="#F4D22B">{acts.length} kid</Pill>
              <Pill bg="#2D4DF3" fg="#FBF5E8">
                {personal.length} you
              </Pill>
            </div>

            {acts.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1">
                {acts.slice(0, 3).map((a) => (
                  <li key={a.id} className="truncate text-[12px] leading-snug">
                    <span className="font-mono text-[9px] tracking-widest uppercase opacity-60">
                      {a.start_hour}:00
                    </span>
                    <span className="ml-1 font-bold tracking-tight">{a.title}</span>
                  </li>
                ))}
                {acts.length > 3 && (
                  <li className="font-mono text-[10px] tracking-widest uppercase opacity-50">
                    +{acts.length - 3} more
                  </li>
                )}
              </ul>
            )}

            {acts.length === 0 && personal.length === 0 && (
              <p className="mt-3 font-mono text-[11px] tracking-widest uppercase opacity-30">
                empty
              </p>
            )}
          </Link>
        )
      })}
    </div>
  )
}

function PartCell({ label, part }: { label: string; part: PartForecast }) {
  return (
    <div className="flex flex-col items-center gap-0.5 leading-none">
      <span className="font-mono text-[8px] tracking-widest uppercase opacity-50">{label}</span>
      <WeatherIconSvg icon={part.icon} size={20} />
      <span className="font-mono text-[9px] font-bold tracking-tight">{part.temp_f}°</span>
    </div>
  )
}

function Pill({
  children,
  bg,
  fg = '#16121A'
}: {
  children: React.ReactNode
  bg: string
  fg?: string
}) {
  return (
    <span
      className="rounded-full border border-[#16121A] px-2 py-0.5 text-[10px] font-bold"
      style={{ background: bg, color: fg }}
    >
      {children}
    </span>
  )
}

function computeDateLabel(weekStartIso: string, dayIndex: number): string {
  const start = new Date(weekStartIso + 'T12:00:00')
  const d = new Date(start)
  d.setDate(start.getDate() + dayIndex)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
