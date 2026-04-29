import Link from 'next/link'
import { DAYS, type Activity, type DayId } from '@/domains/planning/server/queries'
import type { ScheduledPersonalActivity } from '@/domains/personal/server/queries'
import type { Tables } from '@/lib/supabase/database.types'

type Kid = Tables<'kids'>

const START_HOUR = 6
const END_HOUR = 22 // exclusive
const HOUR_HEIGHT = 64
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

const DAY_LABEL_SHORT: Record<DayId, string> = {
  mon: 'MON',
  tue: 'TUE',
  wed: 'WED',
  thu: 'THU',
  fri: 'FRI',
  sat: 'SAT',
  sun: 'SUN'
}

const BUCKET_TINTS: Record<string, string> = {
  quiet: '#B38BFF',
  focus: '#2D4DF3',
  deep: '#17C3C1',
  active: '#FF3D7F',
  creative: '#FF7A1A',
  social: '#F4D22B',
  outdoor: '#17C3C1',
  screen: '#FFB4A5'
}

const CATEGORY_COLOR: Record<string, string> = {
  work: '#2D4DF3',
  exercise: '#17C3C1',
  meal: '#FF7A1A',
  errand: '#F4D22B',
  family: '#FF3D7F',
  personal: '#B38BFF',
  other: '#16121A'
}

const KID_HEX: Record<string, string> = {
  flamingo: '#FF3D7F',
  aqua: '#17C3C1',
  sunset: '#FF7A1A',
  electric: '#2D4DF3',
  citrus: '#F4D22B',
  lavender: '#B38BFF'
}

function hourToY(h: number): number {
  return (h - START_HOUR) * HOUR_HEIGHT
}

function durationToHeight(min: number): number {
  return Math.max(48, (min / 60) * HOUR_HEIGHT)
}

type DayDate = { day: DayId; dateStr: string; isToday: boolean }

export function WeekGrid({
  activities,
  personal,
  kids,
  weekStartDate
}: {
  activities: Activity[]
  personal: ScheduledPersonalActivity[]
  kids: Kid[]
  weekStartDate: string
}) {
  const today = isoDate(new Date())
  const dayDates: DayDate[] = DAYS.map((d, i) => {
    const dateStr = addDaysIso(weekStartDate, i)
    return {
      day: d,
      dateStr,
      isToday: dateStr === today
    }
  })

  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT
  const byDay = groupByDay(activities)
  const personalByDay = groupPersonalByDay(personal)

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] shadow-[3px_3px_0_#16121A]">
      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b-2 border-[#16121A]">
        <div className="border-r border-[#16121A]/30 bg-[#F5ECDC]" />
        {dayDates.map((d) => (
          <Link
            key={d.day}
            href={`/dashboard/${d.day}?week=${weekStartDate}`}
            className={`flex flex-col items-start gap-0.5 border-r border-[#16121A]/30 px-3 py-3 transition hover:bg-[#F5ECDC] ${
              d.isToday ? 'bg-[#17C3C1]' : 'bg-[#FBF5E8]'
            }`}
          >
            <span
              className={`font-mono text-[10px] tracking-widest uppercase ${
                d.isToday ? 'text-[#16121A]/70' : 'opacity-60'
              }`}
            >
              {DAY_LABEL_SHORT[d.day]}
            </span>
            <span className="text-xl font-bold tracking-tight">{dayOfMonth(d.dateStr)}</span>
          </Link>
        ))}
      </div>

      {/* Body grid */}
      <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))]">
        {/* Hour gutter */}
        <div className="relative border-r border-[#16121A]/30" style={{ height: totalHeight }}>
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute font-mono text-[10px] tracking-widest uppercase opacity-50"
              style={{ top: hourToY(h) - 6, left: 8 }}
            >
              {formatHourLabel(h)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {dayDates.map((d) => (
          <DayColumn
            key={d.day}
            day={d}
            activities={byDay[d.day] ?? []}
            personal={personalByDay[d.day] ?? []}
            kids={kids}
            totalHeight={totalHeight}
            weekStartDate={weekStartDate}
          />
        ))}
      </div>
    </div>
  )
}

function DayColumn({
  day,
  activities,
  personal,
  kids,
  totalHeight,
  weekStartDate
}: {
  day: DayDate
  activities: Activity[]
  personal: ScheduledPersonalActivity[]
  kids: Kid[]
  totalHeight: number
  weekStartDate: string
}) {
  return (
    <div
      className={`relative border-r border-[#16121A]/30 ${day.isToday ? 'bg-[#17C3C1]/5' : ''}`}
      style={{ height: totalHeight }}
    >
      <HourLines />
      {personal.map((p) => (
        <PersonalCell
          key={`${p.id}-${p.resolved_day}`}
          activity={p}
          top={hourToY(Number(p.start_hour))}
          height={durationToHeight(p.duration_min)}
        />
      ))}
      {activities.map((a) => (
        <ActivityCell
          key={a.id}
          activity={a}
          kids={kids}
          top={hourToY(a.start_hour)}
          height={durationToHeight(a.duration_min)}
          weekStartDate={weekStartDate}
          day={day.day}
        />
      ))}
    </div>
  )
}

function HourLines() {
  const lines = []
  for (let h = START_HOUR; h <= END_HOUR; h++) {
    lines.push(
      <div
        key={h}
        className="pointer-events-none absolute right-0 left-0 border-t border-[#16121A]/10"
        style={{ top: hourToY(h) }}
      />
    )
  }
  return <>{lines}</>
}

function ActivityCell({
  activity,
  kids,
  top,
  height,
  weekStartDate,
  day
}: {
  activity: Activity
  kids: Kid[]
  top: number
  height: number
  weekStartDate: string
  day: DayId
}) {
  const tint = BUCKET_TINTS[activity.bucket] ?? '#16121A'
  const kidObjs = activity.kid_ids
    .map((id) => kids.find((k) => k.id === id))
    .filter((k): k is Kid => Boolean(k))

  return (
    <Link
      href={`/dashboard/${day}?week=${weekStartDate}`}
      className="absolute overflow-hidden rounded-md border border-[#16121A] bg-[#FBF5E8] px-1.5 py-1 text-left transition hover:-translate-y-px hover:shadow-[1px_1px_0_#16121A]"
      style={{
        top,
        height,
        left: 4,
        right: 4,
        borderLeft: `3px solid ${tint}`
      }}
    >
      <p className="font-mono text-[8px] tracking-widest uppercase opacity-60">
        {activity.duration_min}m · {activity.bucket}
      </p>
      <p className="line-clamp-2 text-[11px] leading-tight font-bold tracking-tight">
        {activity.title}
      </p>
      {kidObjs.length > 0 && (
        <div className="mt-0.5 flex gap-0.5">
          {kidObjs.map((k) => (
            <span
              key={k.id}
              className="inline-block h-2 w-2 rounded-full border border-[#16121A]"
              style={{ background: KID_HEX[k.color] ?? '#16121A' }}
              title={k.name}
            />
          ))}
        </div>
      )}
    </Link>
  )
}

function PersonalCell({
  activity,
  top,
  height
}: {
  activity: ScheduledPersonalActivity
  top: number
  height: number
}) {
  const tint = CATEGORY_COLOR[activity.category] ?? '#16121A'
  return (
    <div
      className="absolute overflow-hidden rounded-md border-2 border-dashed border-[#16121A] bg-[#FBF5E8]/80 px-1.5 py-1"
      style={{ top, height, left: 4, right: 4, borderLeft: `3px solid ${tint}` }}
    >
      <p className="font-mono text-[8px] tracking-widest uppercase opacity-60">
        {activity.duration_min}m · {activity.category}
      </p>
      <p className="line-clamp-2 text-[11px] leading-tight font-bold tracking-tight">
        {activity.title}
      </p>
    </div>
  )
}

// ─── helpers ────────────────────────────────────────────────

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
  personal: ScheduledPersonalActivity[]
): Partial<Record<DayId, ScheduledPersonalActivity[]>> {
  const out: Partial<Record<DayId, ScheduledPersonalActivity[]>> = {}
  for (const p of personal) {
    if (!out[p.resolved_day]) out[p.resolved_day] = []
    out[p.resolved_day]!.push(p)
  }
  return out
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDaysIso(weekStartIso: string, days: number): string {
  const d = new Date(weekStartIso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

function dayOfMonth(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return String(d.getDate())
}

function formatHourLabel(h: number): string {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  if (h < 12) return `${h} AM`
  return `${h - 12} PM`
}
