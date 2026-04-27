'use client'

import { useTransition } from 'react'
import { setActivityStatus } from '@/domains/activities/server/actions'
import { removePersonalActivity } from '@/domains/personal/server/actions'
import type { Activity } from '@/domains/planning/server/queries'
import type { ScheduledPersonalActivity } from '@/domains/personal/server/queries'
import type { Tables } from '@/lib/supabase/database.types'

type Kid = Tables<'kids'>

const BUCKET_TINTS: Record<string, string> = {
  quiet: '#B38BFF',
  focus: '#2D4DF3',
  deep: '#17C3C1',
  active: '#FF3D7F',
  creative: '#FF7A1A',
  social: '#F4D22B',
  outdoor: '#17C3C1',
  screen: '#FFB4A5'
}

const KID_HEX: Record<string, string> = {
  flamingo: '#FF3D7F',
  aqua: '#17C3C1',
  sunset: '#FF7A1A',
  electric: '#2D4DF3',
  citrus: '#F4D22B',
  lavender: '#B38BFF'
}

const CATEGORY_COLOR: Record<string, string> = {
  work: '#2D4DF3',
  exercise: '#17C3C1',
  meal: '#FF7A1A',
  errand: '#F4D22B',
  family: '#FF3D7F',
  personal: '#B38BFF',
  other: '#16121A'
}

function formatHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
}

export function TimelineKidCard({
  activity,
  kids,
  onOpen
}: {
  activity: Activity
  kids: Kid[]
  onOpen: () => void
}) {
  const tint = BUCKET_TINTS[activity.bucket] ?? '#16121A'
  const kidObjs = activity.kid_ids
    .map((id) => kids.find((k) => k.id === id))
    .filter((k): k is Kid => Boolean(k))

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block h-full w-full overflow-hidden rounded-lg border border-[#16121A] bg-[#FBF5E8] p-1.5 text-left shadow-[1px_1px_0_#16121A] transition hover:translate-y-[-1px] hover:shadow-[2px_2px_0_#16121A]"
      style={{ borderLeft: `4px solid ${tint}` }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">
          {activity.start_hour}:00 · {activity.duration_min}m
        </span>
        <StatusDot status={activity.status} />
      </div>
      <p className="mt-0.5 line-clamp-2 text-[12px] leading-tight font-bold tracking-tight">
        {activity.title}
      </p>
      {kidObjs.length > 0 && (
        <div className="mt-1 flex gap-0.5">
          {kidObjs.map((k) => (
            <span
              key={k.id}
              title={k.name}
              className="inline-block h-3 w-3 rounded-full border border-[#16121A]"
              style={{ background: KID_HEX[k.color] ?? '#16121A' }}
            />
          ))}
        </div>
      )}
    </button>
  )
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    proposed: { bg: '#F4D22B', label: 'proposed' },
    approved: { bg: '#B7E9D5', label: 'approved' },
    dismissed: { bg: '#FFB4A5', label: 'dismissed' },
    completed: { bg: '#17C3C1', label: 'completed' },
    missed: { bg: '#E7C9A3', label: 'missed' }
  }
  const s = map[status] ?? map.proposed
  return (
    <span
      title={s.label}
      className="h-2 w-2 shrink-0 rounded-full border border-[#16121A]"
      style={{ background: s.bg }}
    />
  )
}

export function TimelinePersonalCard({ activity }: { activity: ScheduledPersonalActivity }) {
  const [pending, startTransition] = useTransition()
  const tint = CATEGORY_COLOR[activity.category] ?? '#16121A'
  const start = Number(activity.start_hour)
  const end = start + activity.duration_min / 60

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    if (
      activity.is_recurring
        ? !confirm(`remove "${activity.title}" from your weekly schedule?`)
        : !confirm(`remove "${activity.title}"?`)
    )
      return
    startTransition(async () => {
      try {
        await removePersonalActivity(activity.id)
      } catch {
        // surfaced via Next dev overlay
      }
    })
  }

  return (
    <div
      className="group relative h-full overflow-hidden rounded-lg border border-[#16121A] bg-[#FBF5E8] p-1.5 shadow-[1px_1px_0_#16121A]"
      style={{ borderLeft: `4px solid ${tint}` }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">
          {formatHour(start)}–{formatHour(end)}
        </span>
        <button
          type="button"
          onClick={handleRemove}
          disabled={pending}
          className="font-mono text-[10px] tracking-widest uppercase opacity-0 group-hover:opacity-50 hover:!opacity-100 disabled:opacity-20"
          aria-label="remove"
        >
          ×
        </button>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[12px] leading-tight font-bold tracking-tight">
        {activity.title}
      </p>
      <p className="font-mono text-[9px] tracking-widest uppercase opacity-50">
        {activity.category}
        {activity.is_recurring ? ' · weekly' : ''}
      </p>
    </div>
  )
}

// Slide-in detail panel for a kid activity. Re-renders the full content the
// dashboard's <ActivityCard /> shows when expanded — same data, different UI.
export function ActivityDetailDrawer({
  activity,
  kids,
  agentLevel,
  onClose
}: {
  activity: Activity
  kids: Kid[]
  agentLevel: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const tint = BUCKET_TINTS[activity.bucket] ?? '#16121A'
  const kidObjs = activity.kid_ids
    .map((id) => kids.find((k) => k.id === id))
    .filter((k): k is Kid => Boolean(k))
  const badgeLimit = agentLevel === 'transparent' ? 4 : agentLevel === 'subtle' ? 2 : 0
  const badges = (activity.badges ?? []).slice(0, badgeLimit)
  const showReasoning = agentLevel === 'transparent' && activity.reasoning

  function setStatus(next: 'approved' | 'dismissed') {
    startTransition(async () => {
      try {
        await setActivityStatus(activity.id, next)
        onClose()
      } catch {
        // dev overlay
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#16121A]/40 p-4 md:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] shadow-[5px_5px_0_#16121A]"
        onClick={(e) => e.stopPropagation()}
        style={{ borderTop: `8px solid ${tint}` }}
      >
        <div className="border-b-2 border-dashed border-[#16121A] p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[11px] tracking-widest uppercase opacity-70">
              {activity.start_hour}:00 · {activity.duration_min}m · {activity.bucket}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-xs tracking-widest uppercase opacity-50 hover:opacity-100"
            >
              close
            </button>
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{activity.title}</h2>
          {activity.summary && <p className="mt-1 text-sm opacity-80">{activity.summary}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {kidObjs.map((k) => (
              <span
                key={k.id}
                className="inline-flex items-center gap-1 rounded-full border border-[#16121A] px-2 py-0.5 text-[11px] font-bold text-[#FBF5E8]"
                style={{ background: KID_HEX[k.color] ?? '#16121A' }}
              >
                {k.name} · {k.age}
              </span>
            ))}
            {badges.map((b) => (
              <span
                key={b}
                className="rounded-full border border-[#16121A] bg-[#F5ECDC] px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase"
              >
                {b}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-3 p-5 text-sm">
          {Array.isArray(activity.materials) && activity.materials.length > 0 && (
            <Section label="materials">
              <ul className="list-disc pl-5">
                {(
                  activity.materials as Array<{ item: string; quantity?: string; note?: string }>
                ).map((m, i) => (
                  <li key={i}>
                    <b>{m.item}</b>
                    {m.quantity ? ` · ${m.quantity}` : ''}
                    {m.note ? ` (${m.note})` : ''}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {activity.setup && <Section label="setup">{activity.setup}</Section>}
          {Array.isArray(activity.execution_steps) && activity.execution_steps.length > 0 && (
            <Section label="the plan">
              <ol className="ml-4 list-decimal space-y-1.5">
                {(
                  activity.execution_steps as Array<{
                    order: number
                    instruction: string
                    parent_script: string
                  }>
                ).map((s) => (
                  <li key={s.order}>
                    {s.instruction}
                    {s.parent_script && (
                      <div className="mt-0.5 text-xs italic opacity-80">
                        &ldquo;{s.parent_script}&rdquo;
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          )}
          {activity.variations && typeof activity.variations === 'object' && (
            <Section label="variations">
              <p>
                <b>easier:</b> {(activity.variations as { easier?: string }).easier}
              </p>
              <p>
                <b>harder:</b> {(activity.variations as { harder?: string }).harder}
              </p>
            </Section>
          )}
          {activity.troubleshooting && (
            <Section label="troubleshooting">{activity.troubleshooting}</Section>
          )}
          {activity.cleanup && <Section label="cleanup">{activity.cleanup}</Section>}
          {activity.safety_notes && <Section label="safety">{activity.safety_notes}</Section>}
          {activity.signs_it_worked && (
            <Section label="signs it worked">{activity.signs_it_worked}</Section>
          )}
          {showReasoning && (
            <Section label="why this">
              <p className="text-xs italic opacity-80">{activity.reasoning}</p>
            </Section>
          )}
          {(activity.inspiration_source || activity.inspiration_detail) && (
            <div className="rounded-lg border border-[#16121A]/30 bg-[#F5ECDC] p-3">
              <p className="font-mono text-[10px] tracking-widest uppercase opacity-60">
                where this comes from
              </p>
              {activity.inspiration_source && (
                <p className="mt-1 font-mono text-[11px] font-bold tracking-widest uppercase">
                  {activity.inspiration_source}
                </p>
              )}
              {activity.inspiration_detail && (
                <p className="mt-2 text-[13px] leading-relaxed opacity-85">
                  {activity.inspiration_detail}
                </p>
              )}
            </div>
          )}
        </div>

        {activity.status === 'proposed' && (
          <div className="flex border-t-2 border-[#16121A]">
            <button
              type="button"
              onClick={() => setStatus('dismissed')}
              disabled={pending}
              className="flex-1 border-r-2 border-[#16121A] py-3 text-sm font-bold tracking-widest uppercase disabled:opacity-50"
            >
              skip
            </button>
            <button
              type="button"
              onClick={() => setStatus('approved')}
              disabled={pending}
              className="flex-1 bg-[#17C3C1] py-3 text-sm font-bold tracking-widest text-[#FBF5E8] uppercase disabled:opacity-50"
            >
              approve
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-widest uppercase opacity-60">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}
