// Seeds the complete finance handoff dataset (BRIEF.md §3a) for one family:
//   · category rules from the engine's DEFAULT_RULES, order preserved
//   · 617 transactions from fixtures/transactions.csv, with the 4 manual
//     rows (fixtures/manual-adjustments.csv) marked source='manual'
//   · 9 fixed bills with schedules, 14 paychecks with provenance,
//     6 recurring + 3 one-off income items from fixtures/config.json
//
// Usage:
//   npm run seed:finance -- --family <family-uuid>
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read from
// the environment or .env.local). Re-runnable: rules/bills/income are
// replaced, transactions re-import idempotently.

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database, TablesInsert } from '../src/lib/supabase/database.types'
import {
  DEFAULT_RULES,
  KEY_BY_REFERENCE_NAME,
  assignDedupeKeys,
  enrich,
  recordsFromCSV
} from '../src/domains/finance/engine'
import { importTransactionsCsv } from '../src/domains/finance/data/core'

const ROOT = path.resolve(__dirname, '..')
const FIXTURES = path.join(ROOT, 'docs/nido-finance-handoff/fixtures')

loadDotEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

async function main() {
  const familyId = await resolveFamilyId()
  console.log(`Seeding finance data for family ${familyId}`)

  const config = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8'))
  const csvText = readFileSync(path.join(FIXTURES, 'transactions.csv'), 'utf8')
  const manualCsv = readFileSync(path.join(FIXTURES, 'manual-adjustments.csv'), 'utf8')

  // ── category rules (order → sparse priority) ────────────────
  await run(
    'clear rules',
    supabase.from('finance_category_rules').delete().eq('family_id', familyId)
  )
  const ruleRows: TablesInsert<'finance_category_rules'>[] = DEFAULT_RULES.map((r, i) => ({
    family_id: familyId,
    match_text: r.match,
    match_type: r.exact ? 'exact' : 'substring',
    category_key: r.category,
    priority: (i + 1) * 10
  }))
  await run('insert rules', supabase.from('finance_category_rules').insert(ruleRows))
  console.log(`  rules: ${ruleRows.length}`)

  // ── fixed bills ─────────────────────────────────────────────
  await run('clear fixed', supabase.from('finance_fixed_items').delete().eq('family_id', familyId))
  const fixedRows: TablesInsert<'finance_fixed_items'>[] = config.fixedExpenses.map(
    (fx: {
      name: string
      amount: number
      category: string
      schedule?: Record<string, number>
    }) => ({
      family_id: familyId,
      name: fx.name,
      category_key: refKey(fx.category),
      amount: fx.amount,
      schedule: fx.schedule ?? {}
    })
  )
  await run('insert fixed', supabase.from('finance_fixed_items').insert(fixedRows))
  console.log(`  fixed bills: ${fixedRows.length}`)

  // ── income ──────────────────────────────────────────────────
  await run('clear income', supabase.from('finance_income').delete().eq('family_id', familyId))
  const incomeRows: TablesInsert<'finance_income'>[] = []
  for (const p of config.paychecks) {
    incomeRows.push({
      family_id: familyId,
      kind: 'paycheck',
      bucket: p.bonus ? 'bonus' : 'salary',
      name: p.type,
      pay_date: p.payDate,
      period_start: p.periodStart ?? null,
      period_end: p.periodEnd ?? null,
      gross: p.gross,
      taxes: p.taxes,
      deductions: p.deductions,
      net: p.net,
      source: p.source,
      detail: p.detail ?? null
    })
  }
  for (const r of config.recurringIncome) {
    incomeRows.push({
      family_id: familyId,
      kind: 'recurring',
      bucket: typeToBucket(r.type),
      name: r.name,
      net: r.amount,
      source: 'manual'
    })
  }
  for (const o of config.oneOffIncome) {
    incomeRows.push({
      family_id: familyId,
      kind: 'one_off',
      bucket: typeToBucket(o.type),
      name: o.name,
      month: o.month,
      net: o.amount,
      source: 'manual'
    })
  }
  await run('insert income', supabase.from('finance_income').insert(incomeRows))
  console.log(
    `  income: ${config.paychecks.length} paychecks · ${config.recurringIncome.length} recurring · ${config.oneOffIncome.length} one-off`
  )

  // ── settings ────────────────────────────────────────────────
  await run(
    'settings',
    supabase
      .from('finance_settings')
      .upsert({ family_id: familyId }, { onConflict: 'family_id', ignoreDuplicates: true })
  )

  // ── transactions ────────────────────────────────────────────
  const result = await importTransactionsCsv(supabase, familyId, csvText)
  console.log(
    `  transactions: parsed ${result.totalRowsParsed} · upserted ${result.upserted} · superseded ${result.superseded}`
  )

  // Mark the 4 manual-adjustment rows. Their dedupe keys are located inside
  // the full file's key assignment so occurrence indexes line up.
  const fullTxns = enrich(recordsFromCSV(csvText), DEFAULT_RULES)
  const fullKeys = assignDedupeKeys(fullTxns)
  const manualTxns = enrich(recordsFromCSV(manualCsv), DEFAULT_RULES)
  const manualKeys: string[] = []
  for (const m of manualTxns) {
    const idx = fullTxns.findIndex(
      (t) =>
        t.date === m.date &&
        t.amount === m.amount &&
        t.merchant.toLowerCase() === m.merchant.toLowerCase() &&
        t.type === m.type
    )
    if (idx === -1)
      throw new Error(`Manual row not found in transactions.csv: ${m.merchant} ${m.date}`)
    manualKeys.push(fullKeys[idx])
  }
  const { data: marked, error: markErr } = await supabase
    .from('finance_transactions')
    .update({ source: 'manual' })
    .eq('family_id', familyId)
    .in('dedupe_key', manualKeys)
    .select('id')
  if (markErr) throw new Error(`Failed to mark manual rows: ${markErr.message}`)
  console.log(`  manual rows marked: ${marked?.length ?? 0} (expected ${manualTxns.length})`)

  const { count } = await supabase
    .from('finance_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('family_id', familyId)
  console.log(`  total transaction rows: ${count}`)
  console.log('Done.')
}

async function resolveFamilyId(): Promise<string> {
  const argIdx = process.argv.indexOf('--family')
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1]
  const { data, error } = await supabase.from('families').select('id, household_name')
  if (error) throw new Error(error.message)
  if (data?.length === 1) return data[0].id
  console.error('Pass --family <uuid>. Families found:')
  for (const f of data ?? []) console.error(`  ${f.id}  ${f.household_name}`)
  process.exit(1)
}

function refKey(name: string): string {
  const key = KEY_BY_REFERENCE_NAME[name]
  if (!key) throw new Error(`Unknown category name in config.json: "${name}"`)
  return key
}

function typeToBucket(type: string): string {
  const ty = type.toLowerCase()
  if (ty.includes('bonus')) return 'bonus'
  if (ty.includes('interest')) return 'interest'
  return 'other'
}

async function run(label: string, q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q
  if (error) throw new Error(`${label}: ${error.message}`)
}

function loadDotEnvLocal() {
  const file = path.join(ROOT, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, key, raw] = m
    if (process.env[key] !== undefined) continue
    process.env[key] = raw.replace(/^["']|["']$/g, '')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
