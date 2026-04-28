'use client'

import { useState, useTransition } from 'react'
import {
  removeMember,
  revokeInvite,
  sendInvite,
  type InviteResult
} from '@/domains/family/server/invitations'
import type { Tables } from '@/lib/supabase/database.types'

type Member = Tables<'family_members'> & { email: string | null }
type Invitation = Tables<'family_invitations'>

const ROLE_OPTIONS = ['mom', 'dad', 'caregiver', 'grandparent', 'partner', 'other'] as const
const COLOR_OPTIONS = ['flamingo', 'aqua', 'sunset', 'electric', 'citrus', 'lavender'] as const

const COLOR_HEX: Record<string, string> = {
  flamingo: '#FF3D7F',
  aqua: '#17C3C1',
  sunset: '#FF7A1A',
  electric: '#2D4DF3',
  citrus: '#F4D22B',
  lavender: '#B38BFF'
}

export function AdultsSection({
  members,
  invitations,
  currentUserId,
  isOwner
}: {
  members: Member[]
  invitations: Invitation[]
  currentUserId: string
  isOwner: boolean
}) {
  const [inviting, setInviting] = useState(false)

  return (
    <section className="rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-6 shadow-[3px_3px_0_#16121A]">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-xs tracking-widest uppercase opacity-60">adults</p>
          <h2 className="text-xl font-bold tracking-tight">co-parents + caregivers.</h2>
        </div>
        {isOwner && !inviting && (
          <button
            type="button"
            onClick={() => setInviting(true)}
            className="rounded-lg border-2 border-[#16121A] bg-[#2D4DF3] px-3 py-1.5 text-xs font-bold tracking-widest text-[#FBF5E8] uppercase shadow-[2px_2px_0_#16121A]"
          >
            + invite
          </button>
        )}
      </header>

      <ul className="flex flex-col gap-3">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} currentUserId={currentUserId} canRemove={isOwner} />
        ))}

        {invitations.map((inv) => (
          <InvitationRow key={inv.id} invitation={inv} canRevoke={isOwner} />
        ))}

        {inviting && (
          <li>
            <InviteForm
              onSubmitted={() => setInviting(false)}
              onCancel={() => setInviting(false)}
            />
          </li>
        )}
      </ul>

      {!isOwner && (
        <p className="mt-3 font-mono text-[11px] tracking-widest uppercase opacity-50">
          only the household owner can invite new adults.
        </p>
      )}
    </section>
  )
}

function MemberRow({
  member,
  currentUserId,
  canRemove
}: {
  member: Member
  currentUserId: string
  canRemove: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const tint = COLOR_HEX[member.avatar_color] ?? '#16121A'
  const isYou = member.auth_user_id === currentUserId

  function handleRemove() {
    if (!confirm(`remove ${member.name} from this family?`)) return
    setError(null)
    startTransition(async () => {
      try {
        await removeMember(member.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'remove failed')
      }
    })
  }

  return (
    <li
      className="flex items-center gap-3 rounded-xl border-2 border-[#16121A] p-3"
      style={{ background: tint }}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#16121A] bg-[#FBF5E8] text-lg font-bold">
        {member.name.charAt(0).toUpperCase()}
      </span>
      <div className="flex-1 text-[#FBF5E8]">
        <div className="font-bold">
          {member.name}
          {isYou && (
            <span className="ml-2 font-mono text-[10px] tracking-widest uppercase opacity-90">
              (you)
            </span>
          )}
          {member.is_owner && (
            <span className="ml-2 font-mono text-[10px] tracking-widest uppercase opacity-90">
              · owner
            </span>
          )}
        </div>
        <div className="font-mono text-xs tracking-widest uppercase opacity-90">
          {member.role}
          {member.email && ` · ${member.email}`}
        </div>
        {error && <div className="mt-1 text-xs">{error}</div>}
      </div>
      {canRemove && !isYou && !member.is_owner && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={pending}
          className="rounded-md border border-[#FBF5E8] bg-[#FBF5E8] px-2 py-1 text-xs font-bold tracking-widest text-[#16121A] uppercase disabled:opacity-50"
        >
          {pending ? '…' : 'remove'}
        </button>
      )}
    </li>
  )
}

function InvitationRow({ invitation, canRevoke }: { invitation: Invitation; canRevoke: boolean }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const expiresAt = new Date(invitation.expires_at)
  const expiresIn = humanizeRelative(expiresAt)

  function handleRevoke() {
    if (!confirm(`revoke invitation to ${invitation.email}?`)) return
    setError(null)
    startTransition(async () => {
      try {
        await revokeInvite(invitation.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'revoke failed')
      }
    })
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border-2 border-dashed border-[#16121A] bg-[#FBF5E8] p-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#16121A] bg-[#FBF5E8] text-base">
        ✉
      </span>
      <div className="flex-1">
        <div className="font-bold tracking-tight">{invitation.email}</div>
        <div className="font-mono text-[11px] tracking-widest uppercase opacity-60">
          pending · {invitation.role} · expires {expiresIn}
        </div>
        {error && <div className="mt-1 text-xs text-[#FF3D7F]">{error}</div>}
      </div>
      {canRevoke && (
        <button
          type="button"
          onClick={handleRevoke}
          disabled={pending}
          className="rounded-md border-2 border-[#16121A] bg-[#FBF5E8] px-2 py-1 text-xs font-bold tracking-widest uppercase disabled:opacity-50"
        >
          {pending ? '…' : 'revoke'}
        </button>
      )}
    </li>
  )
}

function InviteForm({ onSubmitted, onCancel }: { onSubmitted: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>('partner')
  const [avatarColor, setAvatarColor] = useState<(typeof COLOR_OPTIONS)[number]>('aqua')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<InviteResult | null>(null)

  function handleSubmit() {
    setError(null)
    if (!email.trim()) {
      setError('email is required')
      return
    }
    startTransition(async () => {
      try {
        const r = await sendInvite({
          email: email.trim().toLowerCase(),
          role,
          avatar_color: avatarColor
        })
        setResult(r)
        if (r.kind === 'emailed') {
          // Brief confirmation, then close.
          setTimeout(onSubmitted, 1200)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'send failed')
      }
    })
  }

  if (result?.kind === 'emailed') {
    return (
      <div className="rounded-xl border-2 border-[#16121A] bg-[#B7E9D5] p-4">
        <p className="font-mono text-xs tracking-widest uppercase">invite sent</p>
        <p className="mt-1 text-sm">
          we emailed <strong>{result.email}</strong> a sign-up link. they&apos;ll land in this
          family after they confirm.
        </p>
      </div>
    )
  }

  if (result?.kind === 'manual_link') {
    return (
      <div className="rounded-xl border-2 border-[#16121A] bg-[#F4D22B]/40 p-4">
        <p className="font-mono text-xs tracking-widest uppercase">share this link manually</p>
        <p className="mt-1 text-sm">
          <strong>{result.email}</strong> already has a Nido account. We can&apos;t auto-email a
          fresh sign-in link, but you can paste this one to them:
        </p>
        <textarea
          readOnly
          value={result.url}
          rows={4}
          className="mt-2 w-full rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 font-mono text-[11px] break-all"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(result.url)}
            className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-sm font-bold"
          >
            copy
          </button>
          <button
            type="button"
            onClick={onSubmitted}
            className="flex-1 rounded-lg border-2 border-[#16121A] bg-[#16121A] px-3 py-1.5 text-sm font-bold text-[#FBF5E8]"
          >
            done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-[#16121A] bg-[#FBF5E8] p-4">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">
          their email
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="partner@example.com"
          className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-sm"
        />
      </label>

      <div className="mt-3">
        <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">role</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {ROLE_OPTIONS.map((r) => {
            const on = role === r
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-full border-2 px-3 py-1 text-xs font-bold tracking-widest uppercase ${
                  on ? 'border-[#16121A] bg-[#16121A] text-[#FBF5E8]' : 'border-[#16121A]/40'
                }`}
              >
                {r}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3">
        <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">color</span>
        <div className="mt-1 flex gap-2">
          {COLOR_OPTIONS.map((c) => {
            const on = avatarColor === c
            return (
              <button
                key={c}
                type="button"
                onClick={() => setAvatarColor(c)}
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
          {pending ? 'sending…' : 'send invite'}
        </button>
      </div>
    </div>
  )
}

function humanizeRelative(date: Date): string {
  const ms = date.getTime() - Date.now()
  if (ms < 0) return 'expired'
  const days = Math.round(ms / (1000 * 60 * 60 * 24))
  if (days >= 2) return `in ${days}d`
  const hours = Math.round(ms / (1000 * 60 * 60))
  if (hours >= 1) return `in ${hours}h`
  const mins = Math.max(1, Math.round(ms / (1000 * 60)))
  return `in ${mins}m`
}
