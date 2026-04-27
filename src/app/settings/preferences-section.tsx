'use client'

import { useState, useTransition } from 'react'
import {
  addPreference,
  removePreference,
  type PrefKindValue
} from '@/domains/family/server/actions'
import type { Tables } from '@/lib/supabase/database.types'

type Preference = Tables<'family_preferences'>

const GROUPS: Array<{
  kind: PrefKindValue
  label: string
  desc: string
  bg: string
  placeholder: string
}> = [
  {
    kind: 'value',
    label: 'we love',
    desc: 'soft signals — what matters to your family.',
    bg: '#F4D22B',
    placeholder: 'e.g. less screens, more outside, bilingual'
  },
  {
    kind: 'constraint',
    label: 'hard constraints',
    desc: 'never violated — allergies, nap times, meal times.',
    bg: '#FFB4A5',
    placeholder: 'e.g. peanut allergy, nap at 1pm, dinner at 6'
  },
  {
    kind: 'dislike',
    label: 'we don’t want',
    desc: 'soft negatives — avoided when possible.',
    bg: '#B38BFF',
    placeholder: 'e.g. crafts with glitter'
  }
]

export function PreferencesSection({ preferences }: { preferences: Preference[] }) {
  return (
    <section className="rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-6 shadow-[3px_3px_0_#16121A]">
      <header className="mb-4">
        <p className="font-mono text-xs tracking-widest uppercase opacity-60">preferences</p>
        <h2 className="text-xl font-bold tracking-tight">what we love, what we won&apos;t.</h2>
      </header>

      <div className="flex flex-col gap-5">
        {GROUPS.map((g) => (
          <PrefGroup key={g.kind} group={g} items={preferences.filter((p) => p.kind === g.kind)} />
        ))}
      </div>
    </section>
  )
}

function PrefGroup({ group, items }: { group: (typeof GROUPS)[number]; items: Preference[] }) {
  const [draft, setDraft] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleAdd() {
    setError(null)
    const text = draft.trim()
    if (!text) return
    startTransition(async () => {
      try {
        await addPreference({ kind: group.kind, text })
        setDraft('')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'add failed')
      }
    })
  }

  return (
    <div>
      <p className="font-mono text-[11px] tracking-widest uppercase opacity-60">{group.label}</p>
      <p className="mt-0.5 text-xs opacity-75">{group.desc}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((p) => (
          <PrefChip key={p.id} pref={p} bg={group.bg} />
        ))}
        {items.length === 0 && (
          <span className="font-mono text-[11px] tracking-widest uppercase opacity-40">none</span>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
          placeholder={group.placeholder}
          className="flex-1 rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={pending || !draft.trim()}
          className="rounded-lg border-2 border-[#16121A] bg-[#16121A] px-3 py-2 text-sm font-bold text-[#FBF5E8] disabled:opacity-50"
        >
          {pending ? '…' : '+ add'}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-[#FF3D7F]">{error}</p>}
    </div>
  )
}

function PrefChip({ pref, bg }: { pref: Preference; bg: string }) {
  const [pending, startTransition] = useTransition()

  function handleRemove() {
    startTransition(async () => {
      try {
        await removePreference(pref.id)
      } catch {
        // surfaced via Next dev overlay
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleRemove}
      disabled={pending}
      className="group flex items-center gap-1 rounded-full border border-[#16121A] px-2.5 py-0.5 text-[12px] font-bold disabled:opacity-50"
      style={{ background: bg }}
    >
      {pref.text}
      <span className="ml-0.5 text-[10px] opacity-60 group-hover:opacity-100">×</span>
    </button>
  )
}
