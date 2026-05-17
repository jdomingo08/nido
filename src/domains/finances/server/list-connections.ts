import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Entity, PlaidAccount, PlaidItem } from '../shared/types'

export interface EntityWithConnections {
  entity: Entity
  items: (PlaidItem & { accounts: PlaidAccount[] })[]
}

// Returns the current user's entities (one Personal entity per household,
// plus any business entities they own), each with its connected Plaid items
// and accounts. RLS handles visibility filtering — we never see entities
// the user isn't a member of.
export async function listMyConnections(): Promise<EntityWithConnections[]> {
  const supabase = await createSupabaseServerClient()

  const { data: entities, error: entErr } = await supabase
    .from('entities')
    .select('*')
    .eq('archived', false)
    .order('kind')
    .order('name')
  if (entErr) throw new Error(entErr.message)

  const { data: items, error: itemErr } = await supabase.from('plaid_items').select('*')
  if (itemErr) throw new Error(itemErr.message)

  const { data: accounts, error: accErr } = await supabase
    .from('plaid_accounts')
    .select('*')
    .eq('archived', false)
  if (accErr) throw new Error(accErr.message)

  return ((entities ?? []) as Entity[]).map((e) => {
    const entityItems = ((items ?? []) as PlaidItem[]).filter((i) => i.entity_id === e.id)
    return {
      entity: e,
      items: entityItems.map((i) => ({
        ...i,
        accounts: ((accounts ?? []) as PlaidAccount[]).filter((a) => a.item_id === i.id)
      }))
    }
  })
}
