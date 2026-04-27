'use client'

import { useState, useTransition } from 'react'
import { addKid, removeKid, updateKid, type KidInput } from '@/domains/family/server/actions'
import type { Tables } from '@/lib/supabase/database.types'

type Kid = Tables<'kids'>

const COLOR_OPTIONS = ['flamingo', 'aqua', 'sunset', 'electric', 'citrus', 'lavender'] as const
const COLOR_HEX: Record<string, string> = {
  flamingo: '#FF3D7F',
  aqua: '#17C3C1',
  sunset: '#FF7A1A',
  electric: '#2D4DF3',
  citrus: '#F4D22B',
  lavender: '#B38BFF'
}

export function KidsSection({ kids }: { kids: Kid[] }) {
  const [adding, setAdding] = useState(false)

  return (
    <section className="rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-6 shadow-[3px_3px_0_#16121A]">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-xs tracking-widest uppercase opacity-60">kids</p>
          <h2 className="text-xl font-bold tracking-tight">who we&apos;re planning for.</h2>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg border-2 border-[#16121A] bg-[#FF3D7F] px-3 py-1.5 text-xs font-bold tracking-widest text-[#FBF5E8] uppercase shadow-[2px_2px_0_#16121A]"
          >
            + add kid
          </button>
        )}
      </header>

      {kids.length === 0 && !adding && (
        <p className="text-sm opacity-70">no kids yet. add at least one to generate a week.</p>
      )}

      <ul className="flex flex-col gap-3">
        {kids.map((k) => (
          <KidRow key={k.id} kid={k} />
        ))}
        {adding && (
          <li>
            <KidEditor
              initial={{ name: '', age: 3, color: 'sunset', tags: [] }}
              onSubmit={async (input) => {
                await addKid(input)
                setAdding(false)
              }}
              onCancel={() => setAdding(false)}
              submitLabel="add kid"
            />
          </li>
        )}
      </ul>
    </section>
  )
}

function KidRow({ kid }: { kid: Kid }) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleRemove() {
    if (!confirm(`remove ${kid.name}?`)) return
    setError(null)
    startTransition(async () => {
      try {
        await removeKid(kid.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'remove failed')
      }
    })
  }

  if (editing) {
    return (
      <KidEditor
        initial={{ name: kid.name, age: kid.age, color: kid.color, tags: kid.tags }}
        onSubmit={async (input) => {
          await updateKid(kid.id, input)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
        submitLabel="save"
      />
    )
  }

  const tint = COLOR_HEX[kid.color] ?? '#16121A'

  return (
    <li
      className="flex items-center gap-3 rounded-xl border-2 border-[#16121A] p-3"
      style={{ background: tint }}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#16121A] bg-[#FBF5E8] text-lg font-bold">
        {kid.name.charAt(0).toUpperCase()}
      </span>
      <div className="flex-1 text-[#FBF5E8]">
        <div className="font-bold">{kid.name}</div>
        <div className="font-mono text-xs tracking-widest uppercase opacity-90">
          age {kid.age} {kid.tags.length > 0 ? `· ${kid.tags.join(' · ')}` : ''}
        </div>
        {error && <div className="mt-1 text-xs">{error}</div>}
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={pending}
        className="rounded-md border border-[#FBF5E8] bg-[#FBF5E8]/0 px-2 py-1 text-xs font-bold tracking-widest text-[#FBF5E8] uppercase disabled:opacity-50"
      >
        edit
      </button>
      <button
        type="button"
        onClick={handleRemove}
        disabled={pending}
        className="rounded-md border border-[#FBF5E8] bg-[#FBF5E8] px-2 py-1 text-xs font-bold tracking-widest text-[#16121A] uppercase disabled:opacity-50"
      >
        {pending ? '…' : 'remove'}
      </button>
    </li>
  )
}

function KidEditor({
  initial,
  onSubmit,
  onCancel,
  submitLabel
}: {
  initial: KidInput
  onSubmit: (input: KidInput) => Promise<void>
  onCancel: () => void
  submitLabel: string
}) {
  const [name, setName] = useState(initial.name)
  const [age, setAge] = useState(String(initial.age))
  const [color, setColor] = useState(initial.color)
  const [tags, setTags] = useState<string[]>(initial.tags)
  const [draftTag, setDraftTag] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function addTag() {
    const t = draftTag.trim()
    if (!t) return
    setTags((prev) => [...prev, t])
    setDraftTag('')
  }

  function removeTag(idx: number) {
    setTags((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleSubmit() {
    setError(null)
    const parsedAge = parseInt(age || '0', 10)
    if (!name.trim()) {
      setError('name is required')
      return
    }
    if (Number.isNaN(parsedAge) || parsedAge < 0 || parsedAge > 18) {
      setError('age must be 0–18')
      return
    }
    startTransition(async () => {
      try {
        await onSubmit({ name: name.trim(), age: parsedAge, color, tags })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'save failed')
      }
    })
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-[#16121A] bg-[#FBF5E8] p-4">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">age</span>
          <input
            type="number"
            min={0}
            max={18}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-3">
        <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">color</span>
        <div className="mt-1 flex gap-2">
          {COLOR_OPTIONS.map((c) => {
            const on = color === c
            return (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  on ? 'scale-110 border-[#16121A]' : 'border-[#16121A]/40'
                }`}
                style={{ background: COLOR_HEX[c] }}
                aria-label={c}
              />
            )
          })}
        </div>
      </div>

      <div className="mt-3">
        <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">tags</span>
        <div className="mt-1 flex gap-2">
          <input
            value={draftTag}
            onChange={(e) => setDraftTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag()
              }
            }}
            placeholder="e.g. loves dinosaurs"
            className="flex-1 rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addTag}
            className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm font-bold"
          >
            +
          </button>
        </div>
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.map((t, i) => (
              <button
                key={i}
                type="button"
                onClick={() => removeTag(i)}
                className="group flex items-center gap-1 rounded-full border border-[#16121A] bg-[#FBF5E8] px-2 py-0.5 text-xs"
              >
                {t}
                <span className="opacity-50 group-hover:opacity-100">×</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-[#FF3D7F]">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-sm font-bold disabled:opacity-50"
        >
          cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="flex-1 rounded-lg border-2 border-[#16121A] bg-[#16121A] px-3 py-1.5 text-sm font-bold text-[#FBF5E8] shadow-[2px_2px_0_#FF3D7F] disabled:opacity-50"
        >
          {pending ? 'saving…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
