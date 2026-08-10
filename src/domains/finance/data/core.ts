// Finance data access shared by server routes and the seed script.
// Deliberately NOT marked 'server-only': the seed script runs in plain Node.
// Nothing here holds secrets — every function takes an already-constructed
// Supabase client, and RLS enforces family scoping for non-admin clients.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables, TablesInsert } from '@/lib/supabase/database.types'
import {
  DEFAULT_RULES,
  assignDedupeKeys,
  enrich,
  recordsFromCSV,
  type CategoryKey,
  type CategoryRule,
  type MerchantOverrides,
  type Transaction
} from '@/domains/finance/engine'

type Client = SupabaseClient<Database>

const VALID_STATUSES = new Set(['Posted', 'Pending', 'Declined', 'Recurring'])
const VALID_TYPES = new Set(['Purchase', 'Refund', 'Payment', 'Other', 'Fee'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CHUNK = 500

export async function loadCategoryRules(
  supabase: Client,
  familyId: string
): Promise<CategoryRule[]> {
  const { data, error } = await supabase
    .from('finance_category_rules')
    .select('match_text, match_type, category_key')
    .eq('family_id', familyId)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Failed to load category rules: ${error.message}`)
  return (data ?? []).map((r) => ({
    match: r.match_text,
    category: r.category_key as CategoryKey,
    exact: r.match_type === 'exact'
  }))
}

export async function loadMerchantOverrides(
  supabase: Client,
  familyId: string
): Promise<MerchantOverrides> {
  const { data, error } = await supabase
    .from('finance_merchant_overrides')
    .select('merchant_key, category_key')
    .eq('family_id', familyId)
  if (error) throw new Error(`Failed to load merchant overrides: ${error.message}`)
  const overrides: MerchantOverrides = {}
  for (const row of data ?? []) overrides[row.merchant_key] = row.category_key as CategoryKey
  return overrides
}

export async function loadAllTransactions(
  supabase: Client,
  familyId: string
): Promise<Tables<'finance_transactions'>[]> {
  const rows: Tables<'finance_transactions'>[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('finance_transactions')
      .select('*')
      .eq('family_id', familyId)
      .order('txn_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Failed to load transactions: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

export interface ImportResult {
  totalRowsParsed: number
  upserted: number
  skippedManual: number
  superseded: number
}

// Idempotent CSV import (BRIEF.md §5 step 4, DECISIONS.md §9):
//   1. upsert every incoming row on (family_id, dedupe_key)
//   2. supersede: delete source='import' rows inside the file's date range
//      whose keys are absent from the file (Pending → Posted restatements)
//   3. never touch source='manual' rows — they exist in no bank export
export async function importTransactionsCsv(
  supabase: Client,
  familyId: string,
  csvText: string
): Promise<ImportResult> {
  const records = recordsFromCSV(csvText)
  if (!records.length) throw new Error('No transaction rows found in the CSV')

  let rules = await loadCategoryRules(supabase, familyId)
  if (!rules.length) rules = DEFAULT_RULES
  const overrides = await loadMerchantOverrides(supabase, familyId)

  const txns = enrich(records, rules, overrides)
  validate(txns)
  const keys = assignDedupeKeys(txns)

  // Manual rows keep their provenance even when the incoming file happens to
  // contain them (the handoff fixture does): skip upserting over them.
  const { data: manualRows, error: manualErr } = await supabase
    .from('finance_transactions')
    .select('dedupe_key')
    .eq('family_id', familyId)
    .eq('source', 'manual')
  if (manualErr) throw new Error(`Failed to load manual rows: ${manualErr.message}`)
  const manualKeys = new Set((manualRows ?? []).map((r) => r.dedupe_key))

  const inserts: TablesInsert<'finance_transactions'>[] = []
  let skippedManual = 0
  txns.forEach((t, i) => {
    if (manualKeys.has(keys[i])) {
      skippedManual++
      return
    }
    inserts.push({
      family_id: familyId,
      txn_date: t.date,
      posted_time: t.time || null,
      cardholder: t.cardholder || null,
      merchant: t.merchant,
      description: t.description || null,
      amount: t.amount,
      points: t.points,
      status: t.status,
      txn_type: t.type,
      category_key: t.category,
      source: 'import',
      dedupe_key: keys[i]
    })
  })

  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase
      .from('finance_transactions')
      .upsert(inserts.slice(i, i + CHUNK), { onConflict: 'family_id,dedupe_key' })
    if (error) throw new Error(`Import upsert failed: ${error.message}`)
  }

  // Supersede stale restated rows within the file's coverage window.
  let minDate = txns[0].date
  let maxDate = txns[0].date
  for (const t of txns) {
    if (t.date < minDate) minDate = t.date
    if (t.date > maxDate) maxDate = t.date
  }
  const incoming = new Set(keys)
  const staleIds: string[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('finance_transactions')
      .select('id, dedupe_key')
      .eq('family_id', familyId)
      .eq('source', 'import')
      .gte('txn_date', minDate)
      .lte('txn_date', maxDate)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Supersede scan failed: ${error.message}`)
    for (const row of data ?? []) if (!incoming.has(row.dedupe_key)) staleIds.push(row.id)
    if (!data || data.length < PAGE) break
  }
  for (let i = 0; i < staleIds.length; i += 100) {
    const { error } = await supabase
      .from('finance_transactions')
      .delete()
      .in('id', staleIds.slice(i, i + 100))
    if (error) throw new Error(`Supersede delete failed: ${error.message}`)
  }

  return {
    totalRowsParsed: records.length,
    upserted: inserts.length,
    skippedManual,
    superseded: staleIds.length
  }
}

function validate(txns: Transaction[]): void {
  txns.forEach((t, i) => {
    const row = i + 2 // 1-based + header
    if (!DATE_RE.test(t.date))
      throw new Error(`Row ${row}: invalid date "${t.date}" (expected YYYY-MM-DD)`)
    if (!VALID_STATUSES.has(t.status)) throw new Error(`Row ${row}: unknown status "${t.status}"`)
    if (!VALID_TYPES.has(t.type)) throw new Error(`Row ${row}: unknown type "${t.type}"`)
    if (!t.merchant) throw new Error(`Row ${row}: missing merchant`)
    if (!Number.isFinite(t.amount)) throw new Error(`Row ${row}: invalid amount`)
  })
}
