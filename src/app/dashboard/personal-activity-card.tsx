'use client'

import { useTransition } from 'react'
import { removePersonalActivity } from '@/domains/personal/server/actions'
import type { ScheduledPersonalActivity } from '@/domains/personal/server/queries'

const CATEGORY_COLOR: Record<string, string> = {
  work: '#2D4DF3',
  exercise: '#17C3C1',
  meal: '#FF7A1A',
  errand: '#F4D22B',
  family: '#FF3D7F',
  personal: '#B38BFF',
  other: '#16121A'
}

const CATEGORY_ICON: Record<string, string> = {
  work: '◧',
  exercise: '↗',
  meal: '◐',
  errand: '◇',
  family: '✦',
  personal: '◯',
  other: '·'
}

function formatHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
}

export function PersonalActivityCard({ activity }: { activity: ScheduledPersonalActivity }) {
  const [pending, startTransition] = useTransition()
  const tint = CATEGORY_COLOR[activity.category] ?? '#16121A'
  const start = Number(activity.start_hour)
  const end = start + activity.duration_min / 60

  function handleRemove() {
    if (activity.is_recurring) {
      if (
        !confirm(
          `remove "${activity.title}" from your weekly schedule? this affects every day it recurs on.`
        )
      )
        return
    } else {
      if (!confirm(`remove "${activity.title}"?`)) return
    }
    startTransition(async () => {
      try {
        await removePersonalActivity(activity.id)
      } catch {
        // surfaced via Next dev overlay
      }
    })
  }

  return (
    <li
      className="flex items-center gap-3 rounded-lg border border-[#16121A]/50 bg-[#FBF5E8] px-3 py-2"
      style={{ borderLeft: `4px solid ${tint}` }}
    >
      <span className="text-sm" style={{ color: tint }} aria-hidden>
        {CATEGORY_ICON[activity.category] ?? '·'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-bold tracking-tight">{activity.title}</span>
          <span className="font-mono text-[11px] tracking-widest uppercase opacity-60">
            {formatHour(start)} – {formatHour(end)}
          </span>
        </div>
        <div className="font-mono text-[10px] tracking-widest uppercase opacity-50">
          {activity.category}
          {activity.is_recurring ? ' · recurring' : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={handleRemove}
        disabled={pending}
        className="font-mono text-[10px] tracking-widest uppercase opacity-50 hover:opacity-100 disabled:opacity-30"
        aria-label="remove"
      >
        ×
      </button>
    </li>
  )
}
