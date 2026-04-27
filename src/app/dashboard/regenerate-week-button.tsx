'use client'

import { useState, useTransition } from 'react'
import { GenerateWeekButton } from './generate-week-button'

export function RegenerateWeekButton({ action }: { action: () => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false)
  const [, startTransition] = useTransition()

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-2">
        <p className="font-mono text-[11px] tracking-widest uppercase opacity-70">
          this nukes the current week + costs ~$0.20.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
          >
            cancel
          </button>
          <RegenerateConfirm action={action} onStart={() => startTransition(() => undefined)} />
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
    >
      regenerate week
    </button>
  )
}

function RegenerateConfirm({
  action,
  onStart
}: {
  action: () => Promise<unknown>
  onStart: () => void
}) {
  // Reuse the GenerateWeekButton's progress UX by mounting it with the
  // regenerate action — it shows the dark agents-at-work panel while running.
  return (
    <span onClick={onStart}>
      <GenerateWeekButton action={action} />
    </span>
  )
}
