// Phase 1 acceptance gate (BRIEF.md §5): the TypeScript engine must reproduce
// EVERY number in docs/nido-finance-handoff/fixtures/golden-master.json from
// the fixture CSV + config. Do not loosen these assertions — if one fails, the
// port is wrong, not the fixture.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_RULES,
  KEY_BY_REFERENCE_NAME,
  computeDashboard,
  enrich,
  recordsFromCSV,
  round2,
  type CategoryKey,
  type DashboardModel,
  type FixedExpense,
  type Paycheck
} from '@/domains/finance/engine'
import enMessages from '../../messages/en.json'

const FIXTURES = path.resolve(__dirname, '../../docs/nido-finance-handoff/fixtures')

interface GoldenMaster {
  parsing: {
    totalRowsParsed: number
    rowsInScope2026: number
    spendTransactions: number
    declinedExcluded: number
    cardPayments: number
    statementCredits: number
  }
  months: string[]
  completeMonths: string[]
  partialMonth: string | null
  fixedMonths: string[]
  monthly: { month: string; income: number; spend: number; net: number }[]
  totals: { income: number; spend: number; netCashFlow: number; savingsRate: string }
  categoryTotals: Record<string, number>
  segmentTotals: Record<string, number>
  categoryByMonth: Record<string, Record<string, number>>
  incomeBreakdown: { salary: number; bonus: number; other: number; interest: number }
  spotChecks: { name: string; value: unknown }[]
}

function catKey(referenceName: string): CategoryKey {
  const key = KEY_BY_REFERENCE_NAME[referenceName]
  if (!key) throw new Error(`No category key for reference name "${referenceName}"`)
  return key
}

function loadModel(): { model: DashboardModel; golden: GoldenMaster } {
  const csvText = readFileSync(path.join(FIXTURES, 'transactions.csv'), 'utf8')
  const config = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8'))
  const golden: GoldenMaster = JSON.parse(
    readFileSync(path.join(FIXTURES, 'golden-master.json'), 'utf8')
  )
  const model = computeDashboard({
    csvText,
    rules: DEFAULT_RULES,
    paychecks: config.paychecks as Paycheck[],
    recurringIncome: config.recurringIncome,
    fixedExpenses: (
      config.fixedExpenses as (Omit<FixedExpense, 'category'> & { category: string })[]
    ).map((fx) => ({ ...fx, category: catKey(fx.category) })),
    oneOffIncome: config.oneOffIncome,
    scopeStart: '2026-01'
  })
  return { model, golden }
}

const { model, golden } = loadModel()

const enCategories = enMessages.finance.categories as Record<string, string>
const enSegments = enMessages.finance.segments as Record<string, string>

function sumMap(m: Record<string, number>): number {
  return Object.values(m).reduce((s, v) => s + v, 0)
}

describe('finance engine · golden master', () => {
  it('parses the fixture exactly (row counts, declined, memo lines)', () => {
    expect(model.totalRowsParsed).toBe(golden.parsing.totalRowsParsed)
    expect(model.rowsInScope).toBe(golden.parsing.rowsInScope2026)
    expect(model.declinedExcluded).toBe(golden.parsing.declinedExcluded)
    expect(model.agg.spend.length).toBe(golden.parsing.spendTransactions)
    expect(round2(sumMap(model.agg.payByMonth))).toBe(golden.parsing.cardPayments)
    expect(round2(sumMap(model.agg.credByMonth))).toBe(golden.parsing.statementCredits)
  })

  it('derives the month structure', () => {
    expect(model.agg.months).toEqual(golden.months)
    expect(model.agg.completeMonths).toEqual(golden.completeMonths)
    expect(model.agg.partialMonth).toBe(golden.partialMonth)
    expect(model.fixedMonths).toEqual(golden.fixedMonths)
  })

  it('reproduces every monthly income / spend / net figure', () => {
    for (const row of golden.monthly) {
      expect(round2(model.incNetMonth[row.month] ?? 0), `${row.month} income`).toBe(row.income)
      expect(round2(model.agg.monthTotals[row.month] ?? 0), `${row.month} spend`).toBe(row.spend)
      expect(
        round2((model.incNetMonth[row.month] ?? 0) - (model.agg.monthTotals[row.month] ?? 0)),
        `${row.month} net`
      ).toBe(row.net)
    }
  })

  it('reproduces the YTD totals and savings rate', () => {
    expect(round2(model.incNetTotal)).toBe(golden.totals.income)
    expect(round2(model.agg.total)).toBe(golden.totals.spend)
    expect(round2(model.ytdNetCash)).toBe(golden.totals.netCashFlow)
    expect((model.savingsRate * 100).toFixed(2) + '%').toBe(golden.totals.savingsRate)
  })

  it('reproduces every category total — and no extras', () => {
    const engineByName: Record<string, number> = {}
    for (const [key, total] of Object.entries(model.agg.catTotals)) {
      engineByName[enCategories[key]] = round2(total as number)
    }
    expect(engineByName).toEqual(
      Object.fromEntries(Object.entries(golden.categoryTotals).map(([k, v]) => [k, round2(v)]))
    )
  })

  it('reproduces every segment total', () => {
    const engineByName: Record<string, number> = {}
    for (const [key, total] of Object.entries(model.agg.segTotals)) {
      engineByName[enSegments[key]] = round2(total as number)
    }
    expect(engineByName).toEqual(golden.segmentTotals)
  })

  it('reproduces every category × month cell — presence and value', () => {
    for (const [name, byMonth] of Object.entries(golden.categoryByMonth)) {
      const key = catKey(name)
      const engineMonths = model.agg.catMonth[key] ?? {}
      const engineRounded = Object.fromEntries(
        Object.entries(engineMonths).map(([m, v]) => [m, round2(v)])
      )
      expect(engineRounded, name).toEqual(byMonth)
    }
    // No category-by-month data outside the golden set
    const goldenKeys = new Set(Object.keys(golden.categoryByMonth).map(catKey))
    expect(new Set(Object.keys(model.agg.catMonth))).toEqual(goldenKeys)
  })

  it('reproduces the income breakdown by bucket', () => {
    expect(round2(model.salaryYTD)).toBe(golden.incomeBreakdown.salary)
    expect(round2(model.bonusYTD)).toBe(golden.incomeBreakdown.bonus)
    expect(round2(model.otherYTD)).toBe(golden.incomeBreakdown.other)
    expect(round2(model.interestYTD)).toBe(golden.incomeBreakdown.interest)
  })

  it('spot check: Meat Club Market nets refunds against the purchase', () => {
    const meatClubJune = model.agg.spend.filter(
      (t) => t.merchant === 'Meat Club Market' && t.month === '2026-06'
    )
    expect(round2(meatClubJune.reduce((s, t) => s + t.amount, 0))).toBe(218.52)
  })

  it('spot check: student loan is paused Jun+Jul via schedule zeros', () => {
    const byMonth = model.agg.catMonth.student_loan ?? {}
    expect(byMonth['2026-06']).toBeUndefined()
    expect(byMonth['2026-07']).toBeUndefined()
  })

  it('spot check: Utilities equals the FPL per-month schedule exactly', () => {
    const fpl = golden.spotChecks.find((c) => c.name.startsWith('FPL'))!
    expect(model.agg.catMonth.utilities).toEqual(fpl.value)
  })

  it('spot check: declined Apmex retry is excluded — Investments total', () => {
    expect(round2(model.agg.catTotals.investments ?? 0)).toBe(5435.41)
  })

  it('spot check: one-off candidates are exactly the five ≥ $500 purchases', () => {
    const expected = golden.spotChecks.find((c) => c.name.startsWith('One-off'))!.value as {
      date: string
      merchant: string
      amount: number
    }[]
    expect(
      model.oneOffs.map((o) => ({ date: o.date, merchant: o.merchant, amount: o.amount }))
    ).toEqual(expected)
  })

  it('en messages cover every category with the exact reference display name', () => {
    for (const name of Object.keys(golden.categoryTotals)) {
      expect(enCategories[catKey(name)], name).toBe(name)
    }
  })

  it('survives a database round-trip: stored-row shape reproduces the same totals', () => {
    // Mirror of the mapping in data/queries.ts — a stored row is re-fed to
    // the engine as a header-keyed record (Balance dropped, amount
    // re-serialized). The P&L must match the CSV path cell for cell.
    const csvText = readFileSync(path.join(FIXTURES, 'transactions.csv'), 'utf8')
    const config = JSON.parse(readFileSync(path.join(FIXTURES, 'config.json'), 'utf8'))
    const enriched = enrich(recordsFromCSV(csvText), DEFAULT_RULES)
    const roundTripped = computeDashboard({
      records: enriched.map((t) => ({
        Date: t.date,
        Time: t.time,
        Cardholder: t.cardholder,
        Amount: String(t.amount),
        Points: String(t.points),
        Status: t.status,
        Type: t.type,
        Merchant: t.merchant,
        Description: t.description
      })),
      rules: DEFAULT_RULES,
      paychecks: config.paychecks as Paycheck[],
      recurringIncome: config.recurringIncome,
      fixedExpenses: (
        config.fixedExpenses as (Omit<FixedExpense, 'category'> & { category: string })[]
      ).map((fx) => ({ ...fx, category: catKey(fx.category) })),
      oneOffIncome: config.oneOffIncome,
      scopeStart: '2026-01'
    })
    expect(round2(roundTripped.agg.total)).toBe(golden.totals.spend)
    expect(round2(roundTripped.incNetTotal)).toBe(golden.totals.income)
    expect(round2(roundTripped.ytdNetCash)).toBe(golden.totals.netCashFlow)
    for (const [key, total] of Object.entries(roundTripped.agg.catTotals)) {
      expect(round2(total as number), key).toBe(round2(model.agg.catTotals[key as CategoryKey]!))
    }
  })
})
