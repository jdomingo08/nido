export type EntityKind = 'personal' | 'business'
export type EntityMemberRole = 'owner' | 'member'

export interface Entity {
  id: string
  name: string
  kind: EntityKind
  family_id: string | null
  owner_user_id: string | null
  archived: boolean
  created_at: string
  updated_at: string
}

export interface EntityMember {
  entity_id: string
  user_id: string
  role: EntityMemberRole
  created_at: string
}

export type PlaidAccountType = 'depository' | 'credit' | 'loan' | 'investment' | 'other'

export type PlaidItemStatus = 'active' | 'login_required' | 'error' | 'disconnected'

export interface PlaidItem {
  id: string
  entity_id: string
  plaid_item_id: string
  institution_id: string | null
  institution_name: string
  status: PlaidItemStatus
  cursor: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface PlaidAccount {
  id: string
  item_id: string
  entity_id: string
  plaid_account_id: string
  name: string
  official_name: string | null
  mask: string | null
  type: PlaidAccountType
  subtype: string | null
  current_balance_cents: number | null
  available_balance_cents: number | null
  iso_currency_code: string
  archived: boolean
  created_at: string
  updated_at: string
}
