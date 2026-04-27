'use client'

import { useState, useTransition } from 'react'
import { updateFamily, type FamilyUpdateInput } from '@/domains/family/server/actions'
import type { Tables } from '@/lib/supabase/database.types'

type Family = Tables<'families'>

const METHODOLOGIES = [
  { id: 'montessori', label: 'Montessori' },
  { id: 'waldorf', label: 'Waldorf' },
  { id: 'reggio', label: 'Reggio Emilia' },
  { id: 'play-based', label: 'Play-based' },
  { id: 'outdoor', label: 'Outdoor / nature' },
  { id: 'stem', label: 'STEM' },
  { id: 'mixed', label: 'Mixed' }
] as const

const DENSITIES = [
  { id: 'calm', label: 'calm', desc: '~3/day' },
  { id: 'balanced', label: 'balanced', desc: '~5/day' },
  { id: 'packed', label: 'packed', desc: '~7/day' }
] as const

const AGENT_LEVELS = [
  { id: 'hidden', label: 'hidden', desc: 'no badges' },
  { id: 'subtle', label: 'subtle', desc: '2 badges' },
  { id: 'transparent', label: 'transparent', desc: 'full reasoning' }
] as const

const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' }
] as const

type MethodologyId = FamilyUpdateInput['methodologies'][number]

export function FamilySection({ family }: { family: Family }) {
  const [householdName, setHouseholdName] = useState(family.household_name)
  const [city, setCity] = useState(family.city ?? '')
  const [methodologies, setMethodologies] = useState<MethodologyId[]>(
    (family.methodologies ?? []) as MethodologyId[]
  )
  const [density, setDensity] = useState<FamilyUpdateInput['density']>(
    family.density as FamilyUpdateInput['density']
  )
  const [agentLevel, setAgentLevel] = useState<FamilyUpdateInput['agent_level']>(
    family.agent_level as FamilyUpdateInput['agent_level']
  )
  const [locale, setLocale] = useState<FamilyUpdateInput['locale']>(
    family.locale as FamilyUpdateInput['locale']
  )

  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleMethodology(id: MethodologyId) {
    setMethodologies((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await updateFamily({
          household_name: householdName.trim(),
          city: city.trim() || null,
          methodologies,
          density,
          agent_level: agentLevel,
          locale
        })
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'something went wrong')
      }
    })
  }

  return (
    <section className="rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-6 shadow-[3px_3px_0_#16121A]">
      <header className="mb-4">
        <p className="font-mono text-xs tracking-widest uppercase opacity-60">family</p>
        <h2 className="text-xl font-bold tracking-tight">household, framework, voice.</h2>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="household name" value={householdName} onChange={setHouseholdName} />
        <Field label="city" value={city} onChange={setCity} placeholder="Miami, FL" />
      </div>

      <Block label="methodologies (pick any — they'll blend)">
        <div className="flex flex-wrap gap-2">
          {METHODOLOGIES.map((m) => {
            const on = methodologies.includes(m.id as MethodologyId)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMethodology(m.id as MethodologyId)}
                className={`rounded-full border-2 border-[#16121A] px-3 py-1 text-sm font-bold transition ${
                  on ? 'bg-[#B38BFF] text-[#FBF5E8] shadow-[2px_2px_0_#16121A]' : 'bg-[#FBF5E8]'
                }`}
              >
                {on ? '✓ ' : ''}
                {m.label}
              </button>
            )
          })}
          {methodologies.length > 0 && (
            <button
              type="button"
              onClick={() => setMethodologies([])}
              className="rounded-full border-2 border-dashed border-[#16121A] bg-transparent px-3 py-1 text-sm font-bold opacity-70"
            >
              clear
            </button>
          )}
        </div>
        {methodologies.length === 0 && (
          <p className="mt-1 font-mono text-[10px] tracking-widest uppercase opacity-50">
            no preference — orchestrator blends freely
          </p>
        )}
      </Block>

      <Block label="day density">
        <Chips
          options={DENSITIES.map((d) => ({ id: d.id, label: `${d.label} · ${d.desc}` }))}
          value={density}
          onChange={(v) => setDensity(v as FamilyUpdateInput['density'])}
        />
      </Block>

      <Block label="agent transparency">
        <Chips
          options={AGENT_LEVELS.map((a) => ({ id: a.id, label: `${a.label} · ${a.desc}` }))}
          value={agentLevel}
          onChange={(v) => setAgentLevel(v as FamilyUpdateInput['agent_level'])}
        />
      </Block>

      <Block label="language">
        <Chips
          options={LOCALES}
          value={locale}
          onChange={(v) => setLocale(v as FamilyUpdateInput['locale'])}
        />
      </Block>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded-lg border-2 border-[#16121A] bg-[#16121A] px-4 py-2 text-sm font-bold tracking-tight text-[#FBF5E8] shadow-[3px_3px_0_#FF3D7F] transition disabled:opacity-60"
        >
          {pending ? 'saving…' : 'save family settings'}
        </button>
        {saved && (
          <span className="font-mono text-[11px] tracking-widest text-[#17C3C1] uppercase">
            ✓ saved
          </span>
        )}
        {error && <span className="font-mono text-[11px] text-[#FF3D7F]">{error}</span>}
      </div>
    </section>
  )
}

function Field({
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
      <span className="font-mono text-[11px] tracking-widest uppercase opacity-60">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-base focus:ring-2 focus:ring-[#FF3D7F] focus:outline-none"
      />
    </label>
  )
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="font-mono text-[11px] tracking-widest uppercase opacity-60">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Chips<T extends string | null>({
  options,
  value,
  onChange
}: {
  options: ReadonlyArray<{ id: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.id
        return (
          <button
            key={o.id ?? '__none__'}
            type="button"
            onClick={() => onChange(o.id)}
            className={`rounded-full border-2 border-[#16121A] px-3 py-1 text-sm font-bold transition ${
              on ? 'bg-[#16121A] text-[#FBF5E8] shadow-[2px_2px_0_#FF3D7F]' : 'bg-[#FBF5E8]'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
