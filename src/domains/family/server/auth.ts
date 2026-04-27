import 'server-only'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/supabase/database.types'

export type Family = Tables<'families'>
export type FamilyMember = Tables<'family_members'>

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  return user
}

export async function getCurrentMember(): Promise<FamilyMember | null> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('family_members')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  return data
}

export async function getCurrentFamily(): Promise<Family | null> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from('family_members')
    .select('family_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!member) return null

  const { data: family } = await supabase
    .from('families')
    .select('*')
    .eq('id', member.family_id)
    .maybeSingle()

  return family
}

export async function requireAuth() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export async function requireFamily(): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  family: Family
}> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const family = await getCurrentFamily()
  if (!family) redirect('/onboarding')
  return { user, family }
}
