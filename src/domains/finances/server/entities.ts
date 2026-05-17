import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Entity } from '../shared/types'
import { forbidden, invalidInput, unauthenticated } from './errors'

export async function getMyEntities(): Promise<Entity[]> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw unauthenticated()

  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('archived', false)
    .order('kind', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw new Error(`entities query failed: ${error.message}`)
  return (data ?? []) as Entity[]
}

export async function getEntityById(entityId: string): Promise<Entity> {
  if (!entityId) throw invalidInput('entity_id required')
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('id', entityId)
    .maybeSingle()

  if (error) throw new Error(`entity lookup failed: ${error.message}`)
  if (!data) throw forbidden('Entity not visible to current user')
  return data as Entity
}
