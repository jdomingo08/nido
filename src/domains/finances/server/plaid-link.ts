import 'server-only'
import { CountryCode, Products } from 'plaid'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getPlaidClient, plaidCountryCodes, plaidProducts } from './plaid-client'
import { encryptToken } from './encryption'
import { getEntityById } from './entities'
import { ExchangePublicTokenSchema, type ExchangePublicTokenInput } from '../shared/schema'
import { invalidInput, plaidFailure, unauthenticated } from './errors'

export async function createLinkToken(): Promise<{ link_token: string; expiration: string }> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw unauthenticated()

  const client = getPlaidClient()
  try {
    const resp = await client.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'Needle',
      products: plaidProducts() as Products[],
      country_codes: plaidCountryCodes() as CountryCode[],
      language: 'en',
      webhook: process.env.PLAID_WEBHOOK_URL || undefined
    })
    return {
      link_token: resp.data.link_token,
      expiration: resp.data.expiration
    }
  } catch (e) {
    throw plaidFailure('Failed to create link token', e)
  }
}

export async function exchangePublicToken(
  input: ExchangePublicTokenInput
): Promise<{ item_id: string; account_count: number }> {
  const parsed = ExchangePublicTokenSchema.safeParse(input)
  if (!parsed.success) throw invalidInput(parsed.error.message)

  const supabase = await createSupabaseServerClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw unauthenticated()

  // RLS will throw forbidden if the user isn't a member of this entity.
  const entity = await getEntityById(parsed.data.entity_id)

  const client = getPlaidClient()
  let accessToken: string
  let itemPlaidId: string
  try {
    const resp = await client.itemPublicTokenExchange({
      public_token: parsed.data.public_token
    })
    accessToken = resp.data.access_token
    itemPlaidId = resp.data.item_id
  } catch (e) {
    throw plaidFailure('Failed to exchange public token', e)
  }

  const enc = encryptToken(accessToken)

  // Insert via service-role admin client to bypass RLS for this trusted write.
  const { getSupabaseAdminClient } = await import('@/lib/supabase/admin')
  const admin = getSupabaseAdminClient()

  const { data: item, error: itemErr } = await admin
    .from('plaid_items')
    .insert({
      entity_id: entity.id,
      plaid_item_id: itemPlaidId,
      institution_id: parsed.data.institution.id,
      institution_name: parsed.data.institution.name,
      access_token_ciphertext: enc.ciphertext.toString('base64'),
      access_token_nonce: enc.nonce.toString('base64'),
      access_token_tag: enc.tag.toString('base64'),
      status: 'active'
    })
    .select('id')
    .single()

  if (itemErr || !item) {
    throw new Error(`Failed to store plaid_item: ${itemErr?.message ?? 'unknown'}`)
  }

  // Fetch full account details from Plaid to capture type/subtype/balance.
  const accountsResp = await client.accountsGet({ access_token: accessToken })
  const rows = accountsResp.data.accounts.map((a) => ({
    item_id: item.id,
    entity_id: entity.id,
    plaid_account_id: a.account_id,
    name: a.name,
    official_name: a.official_name ?? null,
    mask: a.mask ?? null,
    type: a.type,
    subtype: a.subtype ?? null,
    current_balance_cents: a.balances.current != null ? Math.round(a.balances.current * 100) : null,
    available_balance_cents:
      a.balances.available != null ? Math.round(a.balances.available * 100) : null,
    iso_currency_code: a.balances.iso_currency_code ?? 'USD'
  }))

  if (rows.length > 0) {
    const { error: accErr } = await admin.from('plaid_accounts').insert(rows)
    if (accErr) {
      throw new Error(`Failed to store plaid_accounts: ${accErr.message}`)
    }
  }

  return { item_id: item.id, account_count: rows.length }
}
