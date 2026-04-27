'use client'

import { useState, useTransition } from 'react'
import { setActivityStatus } from '@/domains/activities/server/actions'
import type { Activity } from '@/domains/planning/server/queries'
import type { Tables } from '@/lib/supabase/database.types'

type Kid = Tables<'kids'>

const KID_HEX: Record<string, string> = {
  flamingo: '#FF3D7F',
  aqua: '#17C3C1',
  sunset: '#FF7A1A',
  electric: '#2D4DF3',
  citrus: '#F4D22B',
  lavender: '#B38BFF'
}

const STATUS_STYLE: Record<string, { bg: string; label: string }> = {
  proposed: { bg: '#F4D22B', label: 'proposed' },
  approved: { bg: '#B7E9D5', label: 'approved' },
  dismissed: { bg: '#FFB4A5', label: 'dismissed' },
  completed: { bg: '#17C3C1', label: 'completed' },
  missed: { bg: '#E7C9A3', label: 'missed' }
}

export function ActivityCard({
  activity,
  kidsById,
  tint,
  agentLevel
}: {
  activity: Activity
  kidsById: Record<string, Kid | null>
  tint: string
  agentLevel: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const status = STATUS_STYLE[activity.status] ?? STATUS_STYLE.proposed

  function setStatus(next: 'approved' | 'dismissed') {
    startTransition(async () => {
      try {
        await setActivityStatus(activity.id, next)
      } catch {
        // server-action errors are surfaced via Next's error overlay in dev
      }
    })
  }

  const badgeLimit = agentLevel === 'transparent' ? 4 : agentLevel === 'subtle' ? 2 : 0
  const badges = (activity.badges ?? []).slice(0, badgeLimit)
  const showReasoning = agentLevel === 'transparent' && activity.reasoning

  return (
    <li
      className="relative overflow-hidden rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] shadow-[3px_3px_0_#16121A]"
      style={{ borderLeft: `8px solid ${tint}` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="block w-full p-4 text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="font-mono text-[11px] tracking-widest uppercase opacity-70">
            {activity.start_hour}:00 · {activity.duration_min}m · {activity.bucket}
          </div>
          <span
            className="shrink-0 rounded-md border border-[#16121A] px-1.5 py-0.5 font-mono text-[10px] tracking-widest uppercase"
            style={{ background: status.bg }}
          >
            {status.label}
          </span>
        </div>

        <h3 className="mt-1.5 text-lg leading-snug font-bold tracking-tight">{activity.title}</h3>

        {activity.summary && <p className="mt-1 text-sm opacity-80">{activity.summary}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {Object.entries(kidsById).map(([id, k]) =>
            k ? (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-[#16121A] px-2 py-0.5 text-[11px] font-bold text-[#FBF5E8]"
                style={{ background: KID_HEX[k.color] ?? '#16121A' }}
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-[#FBF5E8] text-[9px] font-bold"
                  style={{ color: KID_HEX[k.color] ?? '#16121A' }}
                >
                  {k.name.charAt(0).toUpperCase()}
                </span>
                {k.name} · {k.age}
              </span>
            ) : null
          )}
          {badges.map((b) => (
            <span
              key={b}
              className="rounded-full border border-[#16121A] bg-[#F5ECDC] px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase"
            >
              {b}
            </span>
          ))}
        </div>
      </button>

      {open && (
        <div className="border-t-2 border-dashed border-[#16121A] p-4 text-sm">
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
                    duration_est_min: number
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
            <div className="mt-4 rounded-lg border border-[#16121A]/30 bg-[#F5ECDC] p-3">
              <p className="font-mono text-[10px] tracking-widest uppercase opacity-60">
                where this comes from
              </p>
              {activity.inspiration_source && (
                <p className="mt-1 font-mono text-[11px] font-bold tracking-widest text-[#16121A] uppercase">
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
      )}

      {activity.status === 'proposed' && (
        <div className="flex border-t-2 border-[#16121A]">
          <button
            type="button"
            onClick={() => setStatus('dismissed')}
            disabled={pending}
            className="flex-1 border-r-2 border-[#16121A] py-2 text-sm font-bold tracking-widest uppercase disabled:opacity-50"
          >
            skip
          </button>
          <button
            type="button"
            onClick={() => setStatus('approved')}
            disabled={pending}
            className="flex-1 bg-[#17C3C1] py-2 text-sm font-bold tracking-widest text-[#FBF5E8] uppercase disabled:opacity-50"
          >
            approve
          </button>
        </div>
      )}
    </li>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="font-mono text-[10px] tracking-widest uppercase opacity-60">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}
