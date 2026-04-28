'use client'

import { useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { moveActivity } from '@/domains/activities/server/actions'
import { movePersonalActivity } from '@/domains/personal/server/actions'
import type { Activity } from '@/domains/planning/server/queries'
import type { ScheduledPersonalActivity } from '@/domains/personal/server/queries'
import type { Tables } from '@/lib/supabase/database.types'
import type { HourlyForecast } from '@/lib/weather/openmeteo'
import { WeatherIconSvg } from '../weather-icon'
import { TimelineKidCard, TimelinePersonalCard, ActivityDetailDrawer } from './timeline-card'

type Kid = Tables<'kids'>

const START_HOUR = 6
const END_HOUR = 22 // exclusive
const HOUR_HEIGHT = 88
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

function hourToY(h: number): number {
  return (h - START_HOUR) * HOUR_HEIGHT
}

// Floor at 72px so even 15–20m activities have room for time + title + kid dots
// (the visible content needs ~70px). Cards may visually extend past their real
// time slot when activities are short, but that's an acceptable trade-off for
// readability — the time label inside the card is the source of truth.
function durationToHeight(min: number): number {
  return Math.max(72, (min / 60) * HOUR_HEIGHT)
}

// Greedy lane assignment for overlapping cards. Each item gets a `lane`
// (0-indexed column position) and `totalLanes` (how wide the local stack is).
// Non-overlapping cards get totalLanes=1 and take full width.
type Layout<T> = T & { lane: number; totalLanes: number }

function layoutColumn<T extends { start_hour: number; duration_min: number }>(
  items: T[]
): Array<Layout<T>> {
  if (items.length === 0) return []

  const sorted = [...items].sort((a, b) => Number(a.start_hour) - Number(b.start_hour))
  const laneEnds: number[] = [] // running end_hour per lane
  const placed: Array<T & { lane: number }> = []

  for (const item of sorted) {
    const start = Number(item.start_hour)
    const end = start + item.duration_min / 60
    // First lane that's already free at or before this start
    let chosen = laneEnds.findIndex((le) => le <= start)
    if (chosen === -1) {
      chosen = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[chosen] = end
    }
    placed.push({ ...item, lane: chosen })
  }

  // For each item, totalLanes = max(lane)+1 among items that overlap it.
  return placed.map((item) => {
    const itemStart = Number(item.start_hour)
    const itemEnd = itemStart + item.duration_min / 60
    let maxLane = item.lane
    for (const other of placed) {
      if (other === item) continue
      const oStart = Number(other.start_hour)
      const oEnd = oStart + other.duration_min / 60
      if (oStart < itemEnd && oEnd > itemStart) {
        if (other.lane > maxLane) maxLane = other.lane
      }
    }
    return { ...item, totalLanes: maxLane + 1 }
  })
}

export function DayTimeline({
  activities,
  personal,
  kids,
  agentLevel,
  hourly
}: {
  activities: Activity[]
  personal: ScheduledPersonalActivity[]
  kids: Kid[]
  agentLevel: string
  hourly?: HourlyForecast[]
}) {
  // Local optimistic copies — drag updates these instantly; server-revalidated
  // props are synced in via the derive-state-during-render pattern (React 19
  // forbids setState in useEffect for prop sync).
  const [optActivities, setOptActivities] = useState(activities)
  const [optPersonal, setOptPersonal] = useState(personal)
  const [activitiesSnapshot, setActivitiesSnapshot] = useState(activities)
  const [personalSnapshot, setPersonalSnapshot] = useState(personal)
  const [openId, setOpenId] = useState<string | null>(null)

  if (activities !== activitiesSnapshot) {
    setActivitiesSnapshot(activities)
    setOptActivities(activities)
  }
  if (personal !== personalSnapshot) {
    setPersonalSnapshot(personal)
    setOptPersonal(personal)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT
  const open = openId ? optActivities.find((a) => a.id === openId) : null
  const personalLayout = layoutColumn(optPersonal)
  const activitiesLayout = layoutColumn(optActivities)

  function handleDragEnd(event: DragEndEvent) {
    const { active, delta } = event
    const id = String(active.id)
    const data = active.data.current as { type: 'kid' | 'personal' } | undefined
    if (!data) return

    if (data.type === 'kid') {
      const a = optActivities.find((x) => x.id === id)
      if (!a) return
      // Snap to whole-hour slots — kid activities are stored as int hours.
      const hourDelta = Math.round(delta.y / HOUR_HEIGHT)
      const next = clamp(a.start_hour + hourDelta, START_HOUR, END_HOUR - 1)
      if (next === a.start_hour) return
      setOptActivities((prev) => prev.map((x) => (x.id === id ? { ...x, start_hour: next } : x)))
      void moveActivity({ id, start_hour: next }).catch(() => {
        // Revert on failure
        setOptActivities((prev) =>
          prev.map((x) => (x.id === id ? { ...x, start_hour: a.start_hour } : x))
        )
      })
      return
    }

    // Personal — half-hour granularity. Recurring rules aren't draggable
    // (we filter them out at the card layer); only one-offs reach here.
    const p = optPersonal.find((x) => x.id === id)
    if (!p) return
    const halfHourDelta = Math.round((delta.y / HOUR_HEIGHT) * 2) / 2
    const startNum = Number(p.start_hour)
    const next = clamp(startNum + halfHourDelta, START_HOUR, END_HOUR - 0.5)
    if (next === startNum) return
    setOptPersonal((prev) => prev.map((x) => (x.id === id ? { ...x, start_hour: next } : x)))
    void movePersonalActivity({ id, start_hour: next }).catch(() => {
      setOptPersonal((prev) => prev.map((x) => (x.id === id ? { ...x, start_hour: startNum } : x)))
    })
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="mt-6 grid grid-cols-[36px_60px_1fr_1fr] rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-3 shadow-[3px_3px_0_#16121A]">
          <div className="col-span-4 mb-3 grid grid-cols-[36px_60px_1fr_1fr] gap-2 border-b border-[#16121A]/30 pb-2">
            <div />
            <div />
            <div className="font-mono text-[11px] tracking-widest uppercase opacity-60">you</div>
            <div className="font-mono text-[11px] tracking-widest uppercase opacity-60">kids</div>
          </div>

          {/* hourly weather column */}
          <HourlyWeatherColumn hourly={hourly} totalHeight={totalHeight} />

          {/* time gutter */}
          <div className="relative" style={{ height: totalHeight }}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute font-mono text-[10px] tracking-widest uppercase opacity-50"
                style={{ top: hourToY(h) - 6, left: 0 }}
              >
                {formatHourLabel(h)}
              </div>
            ))}
          </div>

          {/* you column */}
          <div className="relative border-l border-[#16121A]/15" style={{ height: totalHeight }}>
            <HourLines />
            {personalLayout.map((p) => (
              <DraggablePersonal
                key={`${p.id}-${p.resolved_day}`}
                activity={p}
                top={hourToY(Number(p.start_hour))}
                height={durationToHeight(p.duration_min)}
                lane={p.lane}
                totalLanes={p.totalLanes}
              />
            ))}
            {optPersonal.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] tracking-widest uppercase opacity-30">
                free all day
              </div>
            )}
          </div>

          {/* kids column */}
          <div className="relative border-l border-[#16121A]/15" style={{ height: totalHeight }}>
            <HourLines />
            {activitiesLayout.map((a) => (
              <DraggableKid
                key={a.id}
                activity={a}
                kids={kids}
                onOpen={() => setOpenId(a.id)}
                top={hourToY(a.start_hour)}
                height={durationToHeight(a.duration_min)}
                lane={a.lane}
                totalLanes={a.totalLanes}
              />
            ))}
            {optActivities.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] tracking-widest uppercase opacity-30">
                no kid activities yet
              </div>
            )}
          </div>
        </div>
      </DndContext>

      <p className="mt-3 font-mono text-[11px] tracking-widest uppercase opacity-50">
        drag a card up or down to reschedule it. recurring activities are pinned.
      </p>

      {open && (
        <ActivityDetailDrawer
          activity={open}
          kids={kids}
          agentLevel={agentLevel}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  )
}

function DraggableKid({
  activity,
  kids,
  onOpen,
  top,
  height,
  lane,
  totalLanes
}: {
  activity: Activity
  kids: Kid[]
  onOpen: () => void
  top: number
  height: number
  lane: number
  totalLanes: number
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: activity.id,
    data: { type: 'kid' }
  })

  const { left, width } = laneToBox(lane, totalLanes)
  const style: React.CSSProperties = {
    top,
    height,
    left,
    width,
    transform: transform ? `translate3d(0px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : 1
  }

  return (
    <div
      ref={setNodeRef}
      className="absolute cursor-grab touch-none active:cursor-grabbing"
      style={style}
      {...attributes}
      {...listeners}
    >
      <TimelineKidCard activity={activity} kids={kids} onOpen={onOpen} />
    </div>
  )
}

function DraggablePersonal({
  activity,
  top,
  height,
  lane,
  totalLanes
}: {
  activity: ScheduledPersonalActivity
  top: number
  height: number
  lane: number
  totalLanes: number
}) {
  // Recurring activities aren't draggable — moving "one occurrence" of a
  // weekly rule needs an "edit single occurrence" model we don't have yet.
  const draggableEnabled = !activity.is_recurring

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: activity.id,
    data: { type: 'personal' },
    disabled: !draggableEnabled
  })

  const { left, width } = laneToBox(lane, totalLanes)
  const style: React.CSSProperties = {
    top,
    height,
    left,
    width,
    transform: transform ? `translate3d(0px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : 1
  }

  return (
    <div
      ref={setNodeRef}
      className={`absolute touch-none ${
        draggableEnabled ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
      style={style}
      {...(draggableEnabled ? attributes : {})}
      {...(draggableEnabled ? listeners : {})}
    >
      <TimelinePersonalCard activity={activity} />
    </div>
  )
}

// Compute left/width for a card given its lane and the total lane count
// in its overlap stack. Includes a small horizontal gutter between cards.
function laneToBox(lane: number, totalLanes: number): { left: string; width: string } {
  const gutterPx = 4
  const gutterTotal = (totalLanes - 1) * gutterPx
  // Each card width = (100% - gutterTotal) / totalLanes
  // Each card left = lane * (cardWidth + gutter) + 4px (column inset)
  const inset = 4
  return {
    left: `calc(${(lane * 100) / totalLanes}% + ${inset}px + ${(gutterPx * lane) / totalLanes}px)`,
    width: `calc(${100 / totalLanes}% - ${inset * 2 + gutterTotal / totalLanes}px)`
  }
}

// Vertical column of weather icons aligned to each hour line (6am-10pm).
// Renders nothing if hourly data is missing — old weeks generated before the
// hourly field was added simply won't show this column's icons, but the
// rest of the grid still works.
function HourlyWeatherColumn({
  hourly,
  totalHeight
}: {
  hourly?: HourlyForecast[]
  totalHeight: number
}) {
  const byHour = new Map<number, HourlyForecast>()
  for (const h of hourly ?? []) byHour.set(h.hour, h)

  return (
    <div className="relative" style={{ height: totalHeight }}>
      {HOURS.map((h) => {
        const entry = byHour.get(h)
        if (!entry) return null
        return (
          <div
            key={h}
            className="absolute flex items-center justify-center"
            style={{ top: hourToY(h) - 10, left: 0, right: 4, height: 20 }}
          >
            <WeatherIconSvg icon={entry.icon} size={20} />
          </div>
        )
      })}
    </div>
  )
}

function HourLines() {
  const lines = []
  const totalSlots = (END_HOUR - START_HOUR) * 2
  for (let i = 0; i <= totalSlots; i++) {
    const top = (i / 2) * HOUR_HEIGHT
    const isHour = i % 2 === 0
    lines.push(
      <div
        key={i}
        className="pointer-events-none absolute right-0 left-0 border-t"
        style={{
          top,
          borderColor: isHour ? 'rgba(22,18,26,0.15)' : 'rgba(22,18,26,0.06)',
          borderTopStyle: isHour ? 'solid' : 'dashed'
        }}
      />
    )
  }
  return <>{lines}</>
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.max(min, Math.min(max, n))
}

function formatHourLabel(h: number): string {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  if (h < 12) return `${h} AM`
  return `${h - 12} PM`
}
