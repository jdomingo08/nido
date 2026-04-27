'use client'

import { useState, useTransition } from 'react'
import { completeOnboarding, type OnboardingInput } from '@/domains/family/server/onboarding'

const ROLES = ['mom', 'dad', 'caregiver', 'grandparent', 'partner', 'other'] as const
const METHODOLOGIES = [
  { id: 'montessori', label: 'Montessori', desc: 'practical life, real tools, focus periods' },
  { id: 'waldorf', label: 'Waldorf', desc: 'nature, rhythm, open-ended play' },
  { id: 'reggio', label: 'Reggio Emilia', desc: 'project-based, child-led, documentation' },
  { id: 'play-based', label: 'Play-based', desc: 'no framework — just play' },
  { id: 'outdoor', label: 'Outdoor / nature', desc: 'mud, sticks, sky' },
  { id: 'stem', label: 'STEM-focused', desc: 'experiments, building, logic' },
  { id: 'mixed', label: 'Mixed / no preference', desc: 'blend everything' }
] as const

const STEPS = ['household', 'kids', 'methodology', 'preferences'] as const
type Step = (typeof STEPS)[number]

type Kid = { name: string; age: number; color: string; tags: string[] }

const COLOR_OPTIONS = ['flamingo', 'aqua', 'sunset', 'electric', 'citrus', 'lavender'] as const
const COLOR_HEX: Record<string, string> = {
  flamingo: '#FF3D7F',
  aqua: '#17C3C1',
  sunset: '#FF7A1A',
  electric: '#2D4DF3',
  citrus: '#F4D22B',
  lavender: '#B38BFF'
}

export function OnboardingFlow({ defaultName }: { defaultName: string }) {
  const [step, setStep] = useState<Step>('household')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [householdName, setHouseholdName] = useState('')
  const [city, setCity] = useState('')
  const [memberName, setMemberName] = useState(defaultName)
  const [memberRole, setMemberRole] = useState<(typeof ROLES)[number]>('mom')
  const [memberAvatarColor, setMemberAvatarColor] = useState<string>('flamingo')

  const [kids, setKids] = useState<Kid[]>([])
  const [draftKid, setDraftKid] = useState<Kid>({ name: '', age: 3, color: 'sunset', tags: [] })
  const [draftTag, setDraftTag] = useState('')

  const [methodologies, setMethodologies] = useState<string[]>([])

  function toggleMethodology(id: string) {
    setMethodologies((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  const [valuesText, setValuesText] = useState('less screens, more outside')
  const [constraintsText, setConstraintsText] = useState('')
  const [dislikesText, setDislikesText] = useState('')

  const stepIdx = STEPS.indexOf(step)

  function addKid() {
    if (!draftKid.name.trim()) return
    setKids((prev) => [...prev, draftKid])
    setDraftKid({ name: '', age: 3, color: 'sunset', tags: [] })
    setDraftTag('')
  }

  function removeKid(idx: number) {
    setKids((prev) => prev.filter((_, i) => i !== idx))
  }

  function addTagToDraft() {
    const tag = draftTag.trim()
    if (!tag) return
    setDraftKid((prev) => ({ ...prev, tags: [...prev.tags, tag] }))
    setDraftTag('')
  }

  function next() {
    setError(null)
    if (step === 'household') {
      if (!householdName.trim() || !memberName.trim()) {
        setError('household name and your name are required.')
        return
      }
    }
    if (step === 'kids' && kids.length === 0) {
      setError('add at least one kid.')
      return
    }
    const nextStep = STEPS[stepIdx + 1]
    if (nextStep) setStep(nextStep)
    else void submit()
  }

  function prev() {
    setError(null)
    const prevStep = STEPS[stepIdx - 1]
    if (prevStep) setStep(prevStep)
  }

  async function submit() {
    const input: OnboardingInput = {
      household_name: householdName.trim(),
      city: city.trim() || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      member_name: memberName.trim(),
      member_role: memberRole,
      member_avatar_color: memberAvatarColor,
      methodologies: methodologies as OnboardingInput['methodologies'],
      kids: kids.map((k) => ({ ...k, name: k.name.trim() })),
      values: csvToList(valuesText),
      constraints: csvToList(constraintsText),
      dislikes: csvToList(dislikesText)
    }
    startTransition(async () => {
      try {
        await completeOnboarding(input)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'something went wrong')
      }
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5ECDC] p-6">
      <div className="w-full max-w-2xl rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-8 shadow-[4px_4px_0_#16121A]">
        <div className="mb-6 flex gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full border border-[#16121A] ${
                i <= stepIdx ? 'bg-[#FF3D7F]' : 'bg-[#FBF5E8]'
              }`}
            />
          ))}
        </div>
        <p className="font-mono text-xs tracking-widest uppercase opacity-60">
          step {stepIdx + 1} of {STEPS.length}
        </p>

        {step === 'household' && (
          <section className="mt-2 flex flex-col gap-4">
            <h1 className="text-3xl font-bold tracking-tight">who lives here.</h1>
            <Field
              label="household name"
              value={householdName}
              onChange={setHouseholdName}
              placeholder="Familia Ortega"
            />
            <Field
              label="city (optional)"
              value={city}
              onChange={setCity}
              placeholder="Miami, FL"
            />
            <Field label="your name" value={memberName} onChange={setMemberName} />
            <SelectChips
              label="your role"
              options={ROLES.map((r) => ({ value: r, label: r }))}
              value={memberRole}
              onChange={(v) => setMemberRole(v as (typeof ROLES)[number])}
            />
            <ColorPicker
              label="your color"
              value={memberAvatarColor}
              onChange={setMemberAvatarColor}
            />
          </section>
        )}

        {step === 'kids' && (
          <section className="mt-2 flex flex-col gap-4">
            <h1 className="text-3xl font-bold tracking-tight">the kids.</h1>

            {kids.length > 0 && (
              <ul className="flex flex-col gap-2">
                {kids.map((k, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-xl border-2 border-[#16121A] p-3"
                    style={{ background: COLOR_HEX[k.color] }}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#16121A] bg-[#FBF5E8] text-lg font-bold">
                      {k.name.charAt(0).toUpperCase() || '?'}
                    </span>
                    <div className="flex-1 text-[#FBF5E8]">
                      <div className="font-bold">{k.name}</div>
                      <div className="font-mono text-xs tracking-widest uppercase opacity-90">
                        age {k.age} {k.tags.length > 0 ? `· ${k.tags.join(' · ')}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeKid(i)}
                      className="rounded-md border border-[#FBF5E8] bg-[#FBF5E8]/0 px-2 py-1 text-xs font-bold tracking-widest text-[#FBF5E8] uppercase"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded-xl border-2 border-dashed border-[#16121A] p-4">
              <p className="font-mono text-xs tracking-widest uppercase opacity-60">add a kid</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field
                  label="name"
                  value={draftKid.name}
                  onChange={(v) => setDraftKid({ ...draftKid, name: v })}
                />
                <Field
                  label="age"
                  type="number"
                  value={String(draftKid.age)}
                  onChange={(v) => setDraftKid({ ...draftKid, age: Number.parseInt(v || '0', 10) })}
                />
              </div>
              <ColorPicker
                label="kid color"
                value={draftKid.color}
                onChange={(v) => setDraftKid({ ...draftKid, color: v })}
              />
              <div className="mt-3">
                <span className="font-mono text-xs tracking-widest uppercase opacity-60">
                  tags (e.g. curious, loves dinosaurs)
                </span>
                <div className="mt-1 flex gap-2">
                  <input
                    value={draftTag}
                    onChange={(e) => setDraftTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addTagToDraft()
                      }
                    }}
                    className="flex-1 rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={addTagToDraft}
                    className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm font-bold"
                  >
                    add tag
                  </button>
                </div>
                {draftKid.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {draftKid.tags.map((t, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-[#16121A] bg-[#FBF5E8] px-2 py-0.5 text-xs"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={addKid}
                disabled={!draftKid.name.trim()}
                className="mt-3 w-full rounded-lg border-2 border-[#16121A] bg-[#16121A] px-3 py-2 font-bold text-[#FBF5E8] disabled:opacity-50"
              >
                + add kid
              </button>
            </div>
          </section>
        )}

        {step === 'methodology' && (
          <section className="mt-2 flex flex-col gap-3">
            <h1 className="text-3xl font-bold tracking-tight">how you play.</h1>
            <p className="text-sm opacity-70">
              pick any that fit — they&apos;ll blend across the week. skip if you have no
              preference.
            </p>
            <ul className="flex flex-col gap-2">
              {METHODOLOGIES.map((m) => {
                const on = methodologies.includes(m.id)
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggleMethodology(m.id)}
                      className={`w-full rounded-xl border-2 border-[#16121A] p-3 text-left transition ${
                        on
                          ? 'bg-[#B38BFF] text-[#FBF5E8] shadow-[2px_2px_0_#16121A]'
                          : 'bg-[#FBF5E8]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-bold tracking-tight">{m.label}</div>
                        {on && <span className="font-mono text-xs">✓</span>}
                      </div>
                      <div className={`text-xs ${on ? 'opacity-90' : 'opacity-70'}`}>{m.desc}</div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {step === 'preferences' && (
          <section className="mt-2 flex flex-col gap-4">
            <h1 className="text-3xl font-bold tracking-tight">what matters.</h1>
            <Textarea
              label="we love (comma-separated)"
              value={valuesText}
              onChange={setValuesText}
              placeholder="less screens, more outside, bilingual"
            />
            <Textarea
              label="constraints (allergies, nap times — comma-separated)"
              value={constraintsText}
              onChange={setConstraintsText}
              placeholder="peanut allergy, nap at 1pm, dinner at 6"
            />
            <Textarea
              label="we don't want (comma-separated)"
              value={dislikesText}
              onChange={setDislikesText}
              placeholder="crafts with glitter"
            />
          </section>
        )}

        {error && (
          <p className="mt-4 rounded-md border border-[#FF3D7F] bg-[#FFB4A5]/40 p-2 text-sm">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          {stepIdx > 0 && (
            <button
              type="button"
              onClick={prev}
              disabled={pending}
              className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-4 py-2 font-bold"
            >
              back
            </button>
          )}
          <button
            type="button"
            onClick={next}
            disabled={pending}
            className="flex-1 rounded-lg border-2 border-[#16121A] bg-[#FF3D7F] px-4 py-3 font-bold tracking-tight text-[#FBF5E8] shadow-[3px_3px_0_#16121A] disabled:opacity-60"
          >
            {pending ? 'saving…' : stepIdx === STEPS.length - 1 ? 'start the week' : 'next'}
          </button>
        </div>
      </div>
    </main>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-xs tracking-widest uppercase opacity-60">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-base focus:ring-2 focus:ring-[#FF3D7F] focus:outline-none"
      />
    </label>
  )
}

function Textarea({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-xs tracking-widest uppercase opacity-60">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="resize-none rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-base focus:ring-2 focus:ring-[#FF3D7F] focus:outline-none"
      />
    </label>
  )
}

function SelectChips({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs tracking-widest uppercase opacity-60">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={`rounded-full border-2 border-[#16121A] px-3 py-1 text-sm font-bold ${
                on ? 'bg-[#16121A] text-[#FBF5E8]' : 'bg-[#FBF5E8]'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ColorPicker({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs tracking-widest uppercase opacity-60">{label}</span>
      <div className="flex flex-wrap gap-2">
        {COLOR_OPTIONS.map((c) => {
          const on = value === c
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className={`h-8 w-8 rounded-full border-2 transition ${
                on ? 'scale-110 border-[#16121A]' : 'border-[#16121A]/40 hover:border-[#16121A]'
              }`}
              style={{ background: COLOR_HEX[c] }}
              aria-label={c}
            />
          )
        })}
      </div>
    </div>
  )
}

function csvToList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
