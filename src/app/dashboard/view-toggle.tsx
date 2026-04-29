'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export type DashboardView = 'grid' | 'summary'

// Small toggle pill that flips the ?view= query param. Grid is the default
// (no param renders as grid); choosing 'summary' falls back to the per-day
// summary cards + 3-part forecast preview.
export function ViewToggle({ current }: { current: DashboardView }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setView(next: DashboardView) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'grid') params.delete('view')
    else params.set('view', next)
    const qs = params.toString()
    router.push(`/dashboard${qs ? `?${qs}` : ''}`)
  }

  const baseClass =
    'rounded-md px-3 py-1 font-mono text-[10px] tracking-widest uppercase transition'
  const onClass = 'bg-[#16121A] text-[#FBF5E8]'
  const offClass = 'text-[#16121A]/60 hover:text-[#16121A]'

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] p-1">
      <button
        type="button"
        onClick={() => setView('grid')}
        className={`${baseClass} ${current === 'grid' ? onClass : offClass}`}
      >
        grid
      </button>
      <button
        type="button"
        onClick={() => setView('summary')}
        className={`${baseClass} ${current === 'summary' ? onClass : offClass}`}
      >
        summary cards
      </button>
    </div>
  )
}
