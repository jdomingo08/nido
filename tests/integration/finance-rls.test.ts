// Phase 1 acceptance gates that need a live database (BRIEF.md §5):
//   · importing fixtures/transactions.csv twice produces 617 rows, not 1,234
//   · re-importing never deletes source='manual' rows
//   · a second family cannot read family one's rows (RLS)
//
// Runs only when Supabase credentials are present (NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) — point them at a
// local `supabase start` stack or a throwaway project, never production.
// Skipped otherwise so the unit suite stays hermetic.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { importTransactionsCsv } from '@/domains/finance/data/core'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const LIVE = Boolean(URL && ANON && SERVICE)

const FIXTURES = path.resolve(__dirname, '../../docs/nido-finance-handoff/fixtures')

interface TestUser {
  id: string
  client: SupabaseClient<Database>
  familyId: string
}

describe.skipIf(!LIVE)('finance · import idempotency + RLS (live database)', () => {
  let admin: SupabaseClient<Database>
  let userA: TestUser
  let userB: TestUser
  const csv = readFileSync(path.join(FIXTURES, 'transactions.csv'), 'utf8')

  beforeAll(async () => {
    admin = createClient<Database>(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    userA = await makeUser('a')
    userB = await makeUser('b')
  }, 60_000)

  afterAll(async () => {
    for (const u of [userA, userB]) {
      if (!u) continue
      await admin.from('families').delete().eq('id', u.familyId)
      await admin.auth.admin.deleteUser(u.id)
    }
  }, 60_000)

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `finance-test-${tag}-${Math.random().toString(36).slice(2)}@example.com`
    const password = `pw-${Math.random().toString(36)}-${Math.random().toString(36)}`
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })
    if (error || !created.user) throw new Error(`createUser failed: ${error?.message}`)

    const client = createClient<Database>(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
    if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`)

    const { data: familyId, error: famErr } = await client.rpc('create_family_for_current_user', {
      p_household_name: `finance-test-${tag}`,
      p_city: 'Doral',
      p_timezone: 'America/New_York',
      p_locale: 'en',
      p_member_name: `Tester ${tag}`,
      p_member_role: 'other',
      p_member_avatar_color: 'flamingo'
    })
    if (famErr || !familyId) throw new Error(`create family failed: ${famErr?.message}`)
    return { id: created.user.id, client, familyId }
  }

  async function countRows(client: SupabaseClient<Database>, familyId: string) {
    const { count, error } = await client
      .from('finance_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('family_id', familyId)
    if (error) throw new Error(error.message)
    return count ?? 0
  }

  it('imports the fixture idempotently: twice → 617 rows, not 1,234', async () => {
    const first = await importTransactionsCsv(userA.client, userA.familyId, csv)
    expect(first.totalRowsParsed).toBe(617)
    expect(await countRows(userA.client, userA.familyId)).toBe(617)

    const second = await importTransactionsCsv(userA.client, userA.familyId, csv)
    expect(second.superseded).toBe(0)
    expect(await countRows(userA.client, userA.familyId)).toBe(617)
  }, 120_000)

  it('re-importing never deletes manual rows', async () => {
    const { error } = await userA.client.from('finance_transactions').insert({
      family_id: userA.familyId,
      txn_date: '2026-05-15',
      merchant: 'Cash purchase — farmers market',
      amount: 42.5,
      status: 'Posted',
      txn_type: 'Purchase',
      category_key: 'groceries_household',
      source: 'manual',
      dedupe_key: 'manual-test-row'
    })
    expect(error).toBeNull()

    await importTransactionsCsv(userA.client, userA.familyId, csv)

    const { data } = await userA.client
      .from('finance_transactions')
      .select('id')
      .eq('family_id', userA.familyId)
      .eq('dedupe_key', 'manual-test-row')
    expect(data).toHaveLength(1)
    expect(await countRows(userA.client, userA.familyId)).toBe(618)
  }, 120_000)

  it("RLS: family B cannot read family A's rows", async () => {
    // Positive control first — A sees its own data.
    expect(await countRows(userA.client, userA.familyId)).toBeGreaterThan(0)

    const { data, count } = await userB.client
      .from('finance_transactions')
      .select('*', { count: 'exact' })
      .eq('family_id', userA.familyId)
    expect(count ?? 0).toBe(0)
    expect(data ?? []).toHaveLength(0)
  }, 60_000)

  it("RLS: family B cannot write into family A's books", async () => {
    const { error } = await userB.client.from('finance_transactions').insert({
      family_id: userA.familyId,
      txn_date: '2026-01-01',
      merchant: 'Intrusion attempt',
      amount: 1,
      dedupe_key: 'intrusion'
    })
    expect(error).not.toBeNull()
  }, 60_000)
})

// Keep vitest happy when the suite is skipped (no credentials).
describe('finance · integration preconditions', () => {
  it('documents how to run the live suite', () => {
    expect(typeof LIVE).toBe('boolean')
  })
})
