'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { hydrateDay, planWeek } from '@/domains/planning/server/orchestrator'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

type Stage =
  | { kind: 'idle' }
  | { kind: 'skeleton' }
  | { kind: 'hydrate'; done: number; failed: number; total: number }
  | { kind: 'error'; message: string }

export function WeekNav({
  weekStartDate,
  hasPlan,
  prevWeekStart,
  nextWeekStart
}: {
  weekStartDate: string
  hasPlan: boolean
  prevWeekStart: string
  nextWeekStart: string
}) {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [, startTransition] = useTransition()

  function navigate(weekStart: string) {
    router.push(`/dashboard?week=${weekStart}`)
  }

  function planThisWeek() {
    setStage({ kind: 'skeleton' })
    startTransition(async () => {
      try {
        await planWeek(weekStartDate)
        setStage({ kind: 'hydrate', done: 0, failed: 0, total: DAYS.length })
        await Promise.all(
          DAYS.map(async (day) => {
            try {
              await hydrateDay(day, weekStartDate)
              setStage((prev) => {
                if (prev.kind !== 'hydrate') return prev
                return { ...prev, done: prev.done + 1 }
              })
            } catch {
              setStage((prev) => {
                if (prev.kind !== 'hydrate') return prev
                return { ...prev, failed: prev.failed + 1 }
              })
            }
          })
        )
        // Refresh server-rendered grid so the new week shows up.
        router.refresh()
        setStage({ kind: 'idle' })
      } catch (e) {
        setStage({
          kind: 'error',
          message: e instanceof Error ? e.message : 'planning failed'
        })
      }
    })
  }

  if (stage.kind === 'skeleton') {
    return (
      <div className="rounded-xl border-2 border-[#16121A] bg-[#16121A] px-4 py-2 font-mono text-xs tracking-widest text-[#FBF5E8] uppercase">
        composing skeleton…
      </div>
    )
  }

  if (stage.kind === 'hydrate') {
    return (
      <div className="rounded-xl border-2 border-[#16121A] bg-[#16121A] px-4 py-2 font-mono text-xs tracking-widest text-[#FBF5E8] uppercase">
        hydrating · {stage.done}/{stage.total}
        {stage.failed > 0 && ` · ${stage.failed} failed`}
      </div>
    )
  }

  if (stage.kind === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-[#FF3D7F] bg-[#FFB4A5]/40 px-2 py-1 text-xs">
          {stage.message}
        </span>
        <button
          type="button"
          onClick={() => setStage({ kind: 'idle' })}
          className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
        >
          dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => navigate(prevWeekStart)}
        className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-sm font-bold tracking-tight"
      >
        ← prev
      </button>

      {!hasPlan ? (
        <button
          type="button"
          onClick={planThisWeek}
          className="rounded-lg border-2 border-[#16121A] bg-[#FF3D7F] px-4 py-1.5 text-sm font-bold tracking-tight text-[#FBF5E8] shadow-[2px_2px_0_#16121A]"
        >
          + plan this week
        </button>
      ) : (
        <button
          type="button"
          onClick={() => navigate(nextWeekStart)}
          className="rounded-lg border-2 border-[#16121A] bg-[#FF3D7F] px-4 py-1.5 text-sm font-bold tracking-tight text-[#FBF5E8] shadow-[2px_2px_0_#16121A]"
        >
          + plan next week →
        </button>
      )}

      <button
        type="button"
        onClick={() => navigate(nextWeekStart)}
        className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-sm font-bold tracking-tight"
      >
        next →
      </button>
    </div>
  )
}
