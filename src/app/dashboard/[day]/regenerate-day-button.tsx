'use client'

import { useState, useTransition } from 'react'
import { regenerateDay } from '@/domains/planning/server/orchestrator'
import type { DayId } from '@/domains/planning/server/queries'

export function RegenerateDayButton({ day }: { day: DayId }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function go() {
    setError(null)
    startTransition(async () => {
      try {
        await regenerateDay(day)
        setConfirming(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'something went wrong')
      }
    })
  }

  if (pending) {
    return (
      <div className="flex items-center gap-2 rounded-lg border-2 border-[#16121A] bg-[#16121A] px-3 py-1.5 text-[#FBF5E8]">
        <Spinner />
        <span className="font-mono text-[11px] tracking-widest uppercase">regenerating {day}…</span>
      </div>
    )
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

function Spinner() {
  return (
    <span className="relative flex h-4 w-4">
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-[#FBF5E8]/20 border-t-[#FF3D7F]" />
    </span>
  )
}
