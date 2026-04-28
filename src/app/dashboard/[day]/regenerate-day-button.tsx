'use client'

import { useEffect, useState, useTransition } from 'react'
import { regenerateDay } from '@/domains/planning/server/orchestrator'
import type { DayId } from '@/domains/planning/server/queries'

const DAY_FULL: Record<DayId, string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday'
}

export function RegenerateDayButton({ day, weekStartIso }: { day: DayId; weekStartIso?: string }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function go() {
    setError(null)
    startTransition(async () => {
      try {
        await regenerateDay(day, weekStartIso)
        setConfirming(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'something went wrong')
      }
    })
  }

  if (pending) {
    return <DayProgressPanel day={day} />
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
      >
        regen day
      </button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <p className="font-mono text-[11px] tracking-widest uppercase opacity-70">
        replaces {day}&apos;s kid activities · ~$0.05
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={go}
          className="rounded-lg border-2 border-[#16121A] bg-[#FF3D7F] px-3 py-1.5 text-xs font-bold tracking-widest text-[#FBF5E8] uppercase shadow-[2px_2px_0_#16121A]"
        >
          regenerate
        </button>
      </div>
      {error && <p className="font-mono text-[11px] text-[#FF3D7F]">{error}</p>}
    </div>
  )
}

// Mirrors the agents-narrative panel from generate-week-button but scaled for
// a single day: ~15s budget, fewer/faster stages, day-specific copy.
function DayProgressPanel({ day }: { day: DayId }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(interval)
  }, [])

  const stages = [
    { agent: 'weather', task: `reading ${day}'s forecast`, after: 0 },
    { agent: 'ages', task: "tuning to each kid's age + attention", after: 2 },
    { agent: 'methodology', task: 'pulling activities aligned to your framework', after: 4 },
    { agent: 'balance', task: `picking buckets that round out ${day}`, after: 6 },
    { agent: 'history', task: 'avoiding repeats from earlier this week', after: 8 },
    { agent: 'materials', task: "filtering for what's already at home", after: 10 },
    { agent: 'composing', task: `writing the full day with steps + scripts`, after: 12 },
    { agent: 'finalizing', task: 'checking constraints + saving', after: 16 }
  ]

  return (
    <div className="w-full max-w-md text-left">
      <div className="rounded-2xl border-2 border-[#16121A] bg-[#16121A] p-4 text-[#FBF5E8] shadow-[3px_3px_0_#FF3D7F]">
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs tracking-widest uppercase opacity-60">
            regenerating {DAY_FULL[day]} · {elapsed}s
          </p>
          <Spinner />
        </div>
        <ul className="mt-3 space-y-2">
          {stages.map((s, i) => {
            const next = stages[i + 1]
            const isActive = elapsed >= s.after && (!next || elapsed < next.after)
            const isDone = next ? elapsed >= next.after : false
            const isPending = elapsed < s.after
            return (
              <li
                key={s.agent}
                className={`flex items-start gap-3 transition-opacity duration-300 ${
                  isPending ? 'opacity-25' : 'opacity-100'
                }`}
              >
                <Dot active={isActive} done={isDone} />
                <div className="min-w-0 flex-1">
                  <span
                    className={`font-mono text-[12px] font-bold tracking-tight ${
                      isActive ? 'text-[#FF3D7F]' : isDone ? 'text-[#B7E9D5]' : ''
                    }`}
                  >
                    {s.agent}_agent
                  </span>
                  <p className="text-[11px] opacity-75">→ {s.task}</p>
                </div>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 font-mono text-[10px] tracking-widest uppercase opacity-40">
          single-day regen runs the full pass — usually 10–15s.
        </p>
      </div>
    </div>
  )
}

function Dot({ active, done }: { active: boolean; done: boolean }) {
  if (done) {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#B7E9D5] bg-[#B7E9D5] text-[9px] font-bold text-[#16121A]">
        ✓
      </span>
    )
  }
  if (active) {
    return (
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#FF3D7F] opacity-50" />
        <span className="relative h-2.5 w-2.5 rounded-full border border-[#FF3D7F] bg-[#FF3D7F]" />
      </span>
    )
  }
  return (
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
      <span className="h-1.5 w-1.5 rounded-full border border-[#FBF5E8]/40" />
    </span>
  )
}

function Spinner() {
  return (
    <span className="relative flex h-4 w-4">
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-[#FBF5E8]/20 border-t-[#FF3D7F]" />
    </span>
  )
}
