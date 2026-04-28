'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireFamily } from './auth'

const Role = z.enum(['mom', 'dad', 'caregiver', 'grandparent', 'partner', 'other'])

const InviteSchema = z.object({
  email: z.string().email().max(200),
  role: Role,
  avatar_color: z.string().min(1).max(40)
})

export type InviteInput = z.infer<typeof InviteSchema>

// Outcome surfaced to the UI:
//   "emailed" — Supabase sent the invite email (most common path).
//   "manual_link" — invitee already has a Supabase auth account, so we can't
//     auto-send. We return a magic link the owner can copy/paste themselves.
//   "error" — anything else; message is surfaced.
export type InviteResult =
  | { kind: 'emailed'; email: string }
  | { kind: 'manual_link'; email: string; url: string }

export async function sendInvite(input: InviteInput): Promise<InviteResult> {
  const data = InviteSchema.parse(input)
  const { user } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  // RPC validates owner + uniqueness and returns the token.
  const { data: token, error: rpcError } = await supabase.rpc('create_family_invitation', {
    p_email: data.email,
    p_role: data.role,
    p_avatar_color: data.avatar_color
  })
  if (rpcError || !token) {
    throw new Error(rpcError?.message ?? 'Failed to create invitation')
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  if (!appUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL is not configured')
  }

  // After the magic link succeeds, Supabase redirects here. The callback
  // exchanges the code, then forwards to `next`. We url-encode the inner
  // path so the embedded `?token=` survives the round-trip.
  const next = `/invite/accept?token=${encodeURIComponent(token)}`
  const redirectTo = `${appUrl}/auth/callback?next=${encodeURIComponent(next)}`

  const admin = getSupabaseAdminClient()
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(data.email, {
    redirectTo,
    data: { invite_token: token, invited_by: user.id }
  })

  // If invitee already has an auth account, inviteUserByEmail rejects with
  // `User already registered`. Fall back to a magic-link signin and surface
  // the URL so the owner can share it manually.
  if (inviteError) {
    const msg = inviteError.message ?? ''
    const alreadyRegistered = /already (registered|exists)/i.test(msg)
    if (!alreadyRegistered) {
      throw new Error(`Could not send invite: ${msg}`)
    }
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: data.email,
      options: { redirectTo }
    })
    if (linkError || !linkData?.properties?.action_link) {
      throw new Error('Invitee already has an account, but a sign-in link could not be generated.')
    }
    revalidatePath('/settings')
    return { kind: 'manual_link', email: data.email, url: linkData.properties.action_link }
  }

  revalidatePath('/settings')
  return { kind: 'emailed', email: data.email }
}

export async function revokeInvite(invitationId: string) {
  const id = z.string().uuid().parse(invitationId)
  await requireFamily()
  const supabase = await createSupabaseServerClient()

  // RLS: only owners can update; status check prevents touching accepted ones.
  const { error } = await supabase
    .from('family_invitations')
    .update({ status: 'revoked' })
    .eq('id', id)
    .eq('status', 'pending')
  if (error) throw new Error(error.message)

  revalidatePath('/settings')
}

// Called from /invite/accept after the invitee has signed in. Wraps the RPC
// so the page component stays dumb.
export async function acceptInvite(token: string): Promise<{ family_id: string }> {
  const validated = z.string().min(1).max(200).parse(token)
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('accept_family_invitation', { p_token: validated })
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to accept invitation')
  }
  return { family_id: data }
}

export async function removeMember(memberId: string) {
  const id = z.string().uuid().parse(memberId)
  await requireFamily()
  const supabase = await createSupabaseServerClient()

  // RLS: owners can delete other members in their family.
  const { error } = await supabase.from('family_members').delete().eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath('/settings')
}
