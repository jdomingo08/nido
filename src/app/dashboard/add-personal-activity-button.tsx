'use client'

import { useState, useTransition } from 'react'
import { addPersonalActivity, type PersonalActivityInput } from '@/domains/personal/server/actions'

const CATEGORIES = [
  { id: 'work', label: 'work', color: 'electric' },
  { id: 'exercise', label: 'exercise', color: 'aqua' },
  { id: 'meal', label: 'meal', color: 'sunset' },
  { id: 'errand', label: 'errand', color: 'citrus' },
  { id: 'family', label: 'family', color: 'flamingo' },
  { id: 'personal', label: 'personal', color: 'lavender' },
  { id: 'other', label: 'other', color: 'ink' }
] as const

const DAYS = [
  { id: 'mon', label: 'M' },
  { id: 'tue', label: 'T' },
  { id: 'wed', label: 'W' },
  { id: 'thu', label: 'Th' },
  { id: 'fri', label: 'F' },
  { id: 'sat', label: 'S' },
  { id: 'sun', label: 'Su' }
] as const

type Category = (typeof CATEGORIES)[number]['id']
type DayId = (typeof DAYS)[number]['id']

export function AddPersonalActivityButton() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border-2 border-[#16121A] bg-[#2D4DF3] px-3 py-1.5 text-xs font-bold tracking-widest text-[#FBF5E8] uppercase shadow-[2px_2px_0_#16121A]"
      >
        + add your activity
      </button>
    )
  }

  return <Form onClose={() => setOpen(false)} />
}

function Form({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<Category>('work')
  const [recurring, setRecurring] = useState(true)
  const [recurringDays, setRecurringDays] = useState<DayId[]>(['mon', 'tue', 'wed', 'thu', 'fri'])
  const [oneOffDay, setOneOffDay] = useState<DayId>('mon')
  const [startHour, setStartHour] = useState('09:00')
  const [durationMin, setDurationMin] = useState(60)
  const [notes, setNotes] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggleDay(d: DayId) {
    setRecurringDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) {
      setError('title is required')
      return
    }
    if (recurring && recurringDays.length === 0) {
      setError('pick at least one day, or switch to one-off')
      return
    }
    const [hh, mm] = startHour.split(':').map((s) => parseInt(s, 10))
    if (Number.isNaN(hh) || Number.isNaN(mm)) {
      setError('invalid time')
      return
    }
    // snap to half-hour
    const snappedMin = Math.round(mm / 30) * 30
    const startDecimal = hh + (snappedMin === 60 ? 1 : snappedMin / 60)

    const cat = CATEGORIES.find((c) => c.id === category)
    const color = cat?.color ?? 'electric'

    const input: PersonalActivityInput = recurring
      ? {
          is_recurring: true,
          recurring_days: recurringDays,
          title: title.trim(),
          category,
          color,
          notes: notes.trim() || null,
          start_hour: startDecimal,
          duration_min: durationMin
        }
      : {
          is_recurring: false,
          day: oneOffDay,
          title: title.trim(),
          category,
          color,
          notes: notes.trim() || null,
          start_hour: startDecimal,
          duration_min: durationMin
        }

    startTransition(async () => {
      try {
        await addPersonalActivity(input)
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'save failed')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-xl rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-4 shadow-[3px_3px_0_#16121A]"
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs tracking-widest uppercase opacity-60">your activity</p>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-xs tracking-widest uppercase opacity-50 hover:opacity-100"
        >
          cancel
        </button>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. work block, gym, dinner prep"
        className="mt-2 w-full rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-base focus:ring-2 focus:ring-[#2D4DF3] focus:outline-none"
      />

      <div className="mt-3">
        <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">category</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => {
            const on = category === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`rounded-full border-2 border-[#16121A] px-2.5 py-0.5 text-xs font-bold ${
                  on ? 'bg-[#16121A] text-[#FBF5E8]' : 'bg-[#FBF5E8]'
                }`}
              >
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3">
        <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">when</span>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => setRecurring(true)}
            className={`flex-1 rounded-lg border-2 border-[#16121A] px-3 py-1.5 text-sm font-bold ${
              recurring ? 'bg-[#16121A] text-[#FBF5E8]' : 'bg-[#FBF5E8]'
            }`}
          >
            recurring weekly
          </button>
          <button
            type="button"
            onClick={() => setRecurring(false)}
            className={`flex-1 rounded-lg border-2 border-[#16121A] px-3 py-1.5 text-sm font-bold ${
              !recurring ? 'bg-[#16121A] text-[#FBF5E8]' : 'bg-[#FBF5E8]'
            }`}
          >
            one-off (this week)
          </button>
        </div>

        {recurring ? (
          <div className="mt-2 flex gap-1">
            {DAYS.map((d) => {
              const on = recurringDays.includes(d.id)
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleDay(d.id)}
                  className={`h-9 flex-1 rounded-md border-2 border-[#16121A] text-xs font-bold ${
                    on ? 'bg-[#2D4DF3] text-[#FBF5E8]' : 'bg-[#FBF5E8]'
                  }`}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        ) : (
          <select
            value={oneOffDay}
            onChange={(e) => setOneOffDay(e.target.value as DayId)}
            className="mt-2 w-full rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-sm font-bold"
          >
            {DAYS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">starts</span>
          <input
            type="time"
            value={startHour}
            step={1800}
            onChange={(e) => setStartHour(e.target.value)}
            className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">
            duration
          </span>
          <select
            value={durationMin}
            onChange={(e) => setDurationMin(parseInt(e.target.value, 10))}
            className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm"
          >
            {[15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${(m / 60).toString()} h${m % 60 ? ` ${m % 60}m` : ''}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="notes (optional)"
        className="mt-3 w-full rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm"
      />

      {error && <p className="mt-2 text-xs text-[#FF3D7F]">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-lg border-2 border-[#16121A] bg-[#16121A] px-4 py-2 text-sm font-bold text-[#FBF5E8] shadow-[3px_3px_0_#2D4DF3] disabled:opacity-60"
      >
        {pending ? 'saving…' : 'save activity'}
      </button>
    </form>
  )
}
