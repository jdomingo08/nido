'use client'

import { useEffect, useState, useTransition } from 'react'
import { hydrateDay } from '@/domains/planning/server/orchestrator'

type Stage =
  | { kind: 'idle' }
  | { kind: 'skeleton' }
  | { kind: 'hydrate'; done: Set<DayKey>; failed: Set<DayKey> }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
const DAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABEL: Record<DayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun'
}

export function GenerateWeekButton({ action }: { action: () => Promise<unknown> }) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [, startTransition] = useTransition()

  function go() {
    setStage({ kind: 'skeleton' })
    startTransition(async () => {
      try {
        // Phase A: skeleton (one big LLM call, ~10–15s)
        await action()

        // Phase B: hydrate every day in parallel. Each call independent —
        // failure on one day doesn't block others.
        setStage({ kind: 'hydrate', done: new Set(), failed: new Set() })
        await Promise.all(
          DAYS.map(async (day) => {
            try {
              await hydrateDay(day)
              setStage((prev) => {
                if (prev.kind !== 'hydrate') return prev
                const next = new Set(prev.done)
                next.add(day)
                return { ...prev, done: next }
              })
            } catch {
              setStage((prev) => {
                if (prev.kind !== 'hydrate') return prev
                const failed = new Set(prev.failed)
                failed.add(day)
                return { ...prev, failed }
              })
            }
          })
        )

        setStage({ kind: 'done' })
      } catch (e) {
        setStage({
          kind: 'error',
          message: e instanceof Error ? e.message : 'something went wrong'
        })
      }
    })
  }

  if (stage.kind === 'skeleton') return <SkeletonProgress />
  if (stage.kind === 'hydrate') return <HydrateProgress done={stage.done} failed={stage.failed} />
  if (stage.kind === 'error') {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="max-w-md rounded-md border border-[#FF3D7F] bg-[#FFB4A5]/40 p-2 text-sm">
          {stage.message}
        </p>
        <button
          type="button"
          onClick={() => setStage({ kind: 'idle' })}
          className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
        >
          try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={go}
        className="rounded-xl border-2 border-[#16121A] bg-[#FF3D7F] px-6 py-3 font-bold tracking-tight text-[#FBF5E8] shadow-[4px_4px_0_#16121A] transition hover:translate-y-[1px] hover:shadow-[3px_3px_0_#16121A]"
      >
        generate this week
      </button>
    </div>
  )
}

// Phase A — single LLM call producing the week skeleton.
function SkeletonProgress() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250)
    return () => clearInterval(interval)
  }, [])

  const stages = [
    { agent: 'weather', task: 'reading the forecast for the week', after: 0 },
    { agent: 'ages', task: "tuning to each kid's age + attention", after: 3 },
    { agent: 'methodology', task: 'pulling activities aligned to your framework', after: 6 },
    { agent: 'balance', task: 'spreading buckets across the week', after: 10 },
    { agent: 'history', task: 'avoiding recent repeats', after: 14 },
    { agent: 'composing', task: 'writing the week skeleton', after: 17 }
  ]

  return (
    <div className="w-full max-w-md text-left">
      <div className="rounded-2xl border-2 border-[#16121A] bg-[#16121A] p-5 text-[#FBF5E8] shadow-[4px_4px_0_#FF3D7F]">
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs tracking-widest uppercase opacity-60">
            phase 1 · skeleton · {elapsed}s
          </p>
          <Spinner />
        </div>
        <ul className="mt-4 space-y-2.5">
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
                    className={`font-mono text-[13px] font-bold tracking-tight ${
                      isActive ? 'text-[#FF3D7F]' : isDone ? 'text-[#B7E9D5]' : ''
                    }`}
                  >
                    {s.agent}_agent
                  </span>
                  <p className="text-xs opacity-75">→ {s.task}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// Phase B — 7 parallel hydration calls. Each day pill flips to ✓ as its
// hydration call returns. Failures are highlighted but don't abort the rest.
function HydrateProgress({ done, failed }: { done: Set<DayKey>; failed: Set<DayKey> }) {
  return (
    <div className="w-full max-w-md text-left">
      <div className="rounded-2xl border-2 border-[#16121A] bg-[#16121A] p-5 text-[#FBF5E8] shadow-[4px_4px_0_#FF3D7F]">
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs tracking-widest uppercase opacity-60">
            phase 2 · filling in details
          </p>
          <Spinner />
        </div>
        <p className="mt-1 text-xs opacity-70">each day gets its own pass — running in parallel.</p>
        <ul className="mt-4 grid grid-cols-7 gap-1.5">
          {DAYS.map((day) => {
            const isDone = done.has(day)
            const isFailed = failed.has(day)
            return (
              <li
                key={day}
                className={`flex flex-col items-center gap-1 rounded-md border-2 py-2 font-mono text-[10px] tracking-widest uppercase ${
                  isFailed
                    ? 'border-[#FF3D7F] bg-[#FFB4A5]/40 text-[#16121A]'
                    : isDone
                      ? 'border-[#B7E9D5] bg-[#B7E9D5] text-[#16121A]'
                      : 'border-[#FBF5E8]/30 text-[#FBF5E8]/60'
                }`}
              >
                <span>{DAY_LABEL[day]}</span>
                <span>{isFailed ? '✕' : isDone ? '✓' : '…'}</span>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 font-mono text-[10px] tracking-widest uppercase opacity-40">
          your week is already visible — details fill in as each day finishes.
        </p>
      </div>
    </div>
  )
}

function Dot({ active, done }: { active: boolean; done: boolean }) {
  if (done) {
    return (
      <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#B7E9D5] bg-[#B7E9D5] text-[10px] font-bold text-[#16121A]">
        ✓
      </span>
    )
  }
  if (active) {
    return (
      <span className="relative mt-1 flex h-5 w-5 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#FF3D7F] opacity-50" />
        <span className="relative h-3 w-3 rounded-full border border-[#FF3D7F] bg-[#FF3D7F]" />
      </span>
    )
  }
  return (
    <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center">
      <span className="h-2 w-2 rounded-full border border-[#FBF5E8]/40" />
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
