import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  DEFAULT_RULES,
  computeDashboard,
  type DashboardModel,
  type CategoryKey,
  type FixedExpense,
  type OneOffIncome,
  type Paycheck,
  type PaycheckSource,
  type RawRecord,
  type RecurringIncome
} from '@/domains/finance/engine'
import { loadAllTransactions, loadCategoryRules, loadMerchantOverrides } from './core'

// Scope floor for the P&L. Oct–Dec 2025 history is deliberately excluded —
// there is no matching income data for it (DECISIONS.md §1). Overridable per
// family via finance_settings.prefs.scopeStart.
const DEFAULT_SCOPE_START = '2026-01'

export interface FinanceData {
  model: DashboardModel
  hasTransactions: boolean
  excludedOneOffIds: string[]
  paychecks: Paycheck[]
  recurringIncome: RecurringIncome[]
  oneOffIncome: OneOffIncome[]
}

export async function getFinanceData(familyId: string): Promise<FinanceData> {
  const supabase = await createSupabaseServerClient()

  const [txnRows, dbRules, overrides, fixedRows, incomeRows, settings] = await Promise.all([
    loadAllTransactions(supabase, familyId),
    loadCategoryRules(supabase, familyId),
    loadMerchantOverrides(supabase, familyId),
    supabase
      .from('finance_fixed_items')
      .select('*')
      .eq('family_id', familyId)
      .eq('active', true)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) throw new Error(`Failed to load fixed items: ${error.message}`)
        return data ?? []
      }),
    supabase
      .from('finance_income')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) throw new Error(`Failed to load income: ${error.message}`)
        return data ?? []
      }),
    supabase
      .from('finance_settings')
      .select('*')
      .eq('family_id', familyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`Failed to load settings: ${error.message}`)
        return data
      })
  ])

  // Stored rows round-trip through the same enrichment pipeline as a fresh
  // CSV: categorization always reflects the family's *current* rules and
  // overrides, so re-tagging a merchant applies to every transaction.
  const records: RawRecord[] = txnRows.map((r) => ({
    Date: r.txn_date,
    Time: r.posted_time ?? '',
    Cardholder: r.cardholder ?? '',
    Amount: String(r.amount),
    Points: String(r.points),
    Status: r.status,
    Type: r.txn_type,
    Merchant: r.merchant,
    Description: r.description ?? ''
  }))

  const paychecks: Paycheck[] = []
  const recurringIncome: RecurringIncome[] = []
  const oneOffIncome: OneOffIncome[] = []
  for (const row of incomeRows) {
    if (row.kind === 'paycheck') {
      paychecks.push({
        id: row.id,
        payDate: row.pay_date ?? '',
        periodStart: row.period_start ?? undefined,
        periodEnd: row.period_end ?? undefined,
        gross: Number(row.gross ?? 0),
        taxes: Number(row.taxes ?? 0),
        deductions: Number(row.deductions ?? 0),
        net: Number(row.net),
        bonus: row.bucket === 'bonus' ? Number(row.net) : 0,
        type: row.bucket === 'bonus' ? 'Bonus' : 'Regular',
        source: row.source as PaycheckSource,
        detail: (row.detail as Record<string, number> | null) ?? undefined
      })
    } else if (row.kind === 'recurring') {
      recurringIncome.push({
        id: row.id,
        name: row.name ?? '',
        amount: Number(row.net),
        type: bucketToType(row.bucket)
      })
    } else {
      oneOffIncome.push({
        id: row.id,
        month: row.month ?? '',
        name: row.name ?? '',
        amount: Number(row.net),
        type: bucketToType(row.bucket)
      })
    }
  }

  const fixedExpenses: FixedExpense[] = fixedRows.map((f) => ({
    id: f.id,
    name: f.name,
    amount: Number(f.amount),
    category: f.category_key as CategoryKey,
    schedule:
      f.schedule && Object.keys(f.schedule as object).length
        ? (f.schedule as Record<string, number>)
        : undefined
  }))

  const prefs = (settings?.prefs as { scopeStart?: string } | null) ?? {}
  const excludedOneOffIds = ((settings?.excluded_txns as string[] | null) ?? []).filter(
    (v): v is string => typeof v === 'string'
  )

  const model = computeDashboard({
    records,
    rules: dbRules.length ? dbRules : DEFAULT_RULES,
    overrides,
    excludedOneOffIds,
    paychecks,
    recurringIncome,
    fixedExpenses,
    oneOffIncome,
    scopeStart: prefs.scopeStart ?? DEFAULT_SCOPE_START
  })

  return {
    model,
    hasTransactions: txnRows.length > 0,
    excludedOneOffIds,
    paychecks,
    recurringIncome,
    oneOffIncome
  }
}

// The engine routes income buckets by substring on the reference type
// strings; the database stores the normalized bucket.
function bucketToType(bucket: string): string {
  switch (bucket) {
    case 'bonus':
      return 'Bonus'
    case 'interest':
      return 'Interest income'
    case 'salary':
      return 'Salary'
    default:
      return 'Other income'
  }
}
