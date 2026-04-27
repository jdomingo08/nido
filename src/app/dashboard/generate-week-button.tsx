'use client'

import { useEffect, useState, useTransition } from 'react'

type Stage = {
  agent: string
  task: string
  after: number // seconds elapsed when this stage starts
}

const STAGES: Stage[] = [
  { agent: 'weather', task: 'checking the forecast for the week', after: 0 },
  { agent: 'ages', task: "tuning difficulty to each kid's age + attention", after: 4 },
  { agent: 'methodology', task: 'pulling activities aligned to your framework', after: 9 },
  { agent: 'balance', task: 'topping up the light buckets across the week', after: 15 },
  { agent: 'history', task: 'skipping recent repeats and remembered flops', after: 20 },
  { agent: 'materials', task: "filtering for what's already at home", after: 25 },
  { agent: 'composing', task: 'writing the week, one day at a time', after: 30 },
  { agent: 'finalizing', task: 'almost there — checking constraints + saving', after: 55 }
]

export function GenerateWeekButton({ action }: { action: () => Promise<unknown> }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    setError(null)
    startTransition(async () => {
      try {
        await action()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'something went wrong')
      }
    })
  }

  if (pending) {
    return <ProgressPanel />
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        className="rounded-xl border-2 border-[#16121A] bg-[#FF3D7F] px-6 py-3 font-bold tracking-tight text-[#FBF5E8] shadow-[4px_4px_0_#16121A] transition hover:translate-y-[1px] hover:shadow-[3px_3px_0_#16121A]"
      >
        generate this week
      </button>
      {error && (
        <p className="mt-2 max-w-md rounded-md border border-[#FF3D7F] bg-[#FFB4A5]/40 p-2 text-sm">
          {error}
        </p>
      )}
    </div>
  )
}

function ProgressPanel() {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 250)
    return () => clearInterval(interval)
  }, [])

  const stages = STAGES.map((s, i) => {
    const next = STAGES[i + 1]
    const isActive = elapsed >= s.after && (!next || elapsed < next.after)
    const isDone = next ? elapsed >= next.after : false
    const isPending = elapsed < s.after
    return { ...s, isActive, isDone, isPending }
  })

  return (
    <div className="w-full max-w-md text-left">
      <div className="rounded-2xl border-2 border-[#16121A] bg-[#16121A] p-5 text-[#FBF5E8] shadow-[4px_4px_0_#FF3D7F]">
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs tracking-widest uppercase opacity-60">
            agents at work · {elapsed}s
          </p>
          <Spinner />
        </div>

        <ul className="mt-4 space-y-2.5">
          {stages.map((s) => (
            <li
              key={s.agent}
              className={`flex items-start gap-3 transition-opacity duration-300 ${
                s.isPending ? 'opacity-25' : 'opacity-100'
              }`}
            >
              <StageDot active={s.isActive} done={s.isDone} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-mono text-[13px] font-bold tracking-tight ${
                      s.isActive ? 'text-[#FF3D7F]' : s.isDone ? 'text-[#B7E9D5]' : ''
                    }`}
                  >
                    {s.agent}_agent
                  </span>
                  {s.isActive && (
                    <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">
                      working…
                    </span>
                  )}
                  {s.isDone && (
                    <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">
                      done
                    </span>
                  )}
                </div>
                <p className="text-xs opacity-75">→ {s.task}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-5 font-mono text-[10px] tracking-widest uppercase opacity-40">
          this usually takes 30–60s. you can keep this tab open.
        </p>
      </div>
    </div>
  )
}

function StageDot({ active, done }: { active: boolean; done: boolean }) {
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
