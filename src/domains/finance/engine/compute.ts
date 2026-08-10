// Full dashboard computation pipeline, ported from reference/app.js
// compute(). Pure and deterministic: everything time-like derives from the
// data itself (max transaction date), never from the clock.

import { activeCategories, aggregate } from './aggregate'
import { enrich } from './categorize'
import { recordsFromCSV } from './parse'
import { linreg } from './project'
import { SEGMENT_OF, SEGMENT_ORDER } from './taxonomy'
import type {
  CategoryKey,
  DashboardInput,
  DashboardModel,
  OneOffCandidate,
  Segment,
  Transaction
} from './types'

export function oneOffId(t: { date: string; amount: number; merchant: string }): string {
  return t.date + '|' + t.amount.toFixed(2) + '|' + t.merchant
}

const DEFAULT_ONEOFF_MIN = 500

export function computeDashboard(input: DashboardInput): DashboardModel {
  const {
    csvText = '',
    rules,
    overrides,
    excludedOneOffIds = [],
    paychecks = [],
    recurringIncome = [],
    fixedExpenses = [],
    oneOffIncome = [],
    scopeStart,
    oneOffMin = DEFAULT_ONEOFF_MIN
  } = input

  const records = input.records ?? recordsFromCSV(csvText)
  const totalRowsParsed = records.length

  let cardTxns = enrich(records, rules, overrides)
  if (scopeStart) cardTxns = cardTxns.filter((t) => t.month >= scopeStart)
  const rowsInScope = cardTxns.length
  const declinedExcluded = cardTxns.filter((t) => t.declined).length

  // One-off charge candidates: any single non-declined purchase ≥ threshold
  // auto-appears — not a hardcoded list. Linked refunds (same merchant+date)
  // follow the purchase when it's excluded, so reimbursements never orphan.
  const oneOffs: OneOffCandidate[] = cardTxns
    .filter((t) => t.type === 'Purchase' && !t.declined && t.amount >= oneOffMin)
    .map((t) => ({
      id: oneOffId(t),
      date: t.date,
      merchant: t.merchant,
      amount: t.amount,
      category: t.category,
      month: t.month,
      linked: [] as Transaction[],
      linkedTotal: 0,
      net: 0
    }))
    .sort((a, b) => b.amount - a.amount)
  for (const o of oneOffs) {
    o.linked = cardTxns.filter(
      (t) => t.type === 'Refund' && t.merchant === o.merchant && t.date === o.date
    )
    o.linkedTotal = o.linked.reduce((s, t) => s + t.amount, 0)
    o.net = o.amount + o.linkedTotal
  }

  const exSet = new Set(excludedOneOffIds)
  let excludedTotal = 0
  let excludedCount = 0
  if (exSet.size) {
    const excluded = oneOffs.filter((o) => exSet.has(o.id))
    excludedCount = excluded.length
    for (const o of excluded) excludedTotal += o.net
    cardTxns = cardTxns.filter((t) => {
      if (t.type === 'Purchase' && exSet.has(oneOffId(t))) return false
      if (t.type === 'Refund') {
        for (const o of excluded) if (o.merchant === t.merchant && o.date === t.date) return false
      }
      return true
    })
  }

  const cardAgg = aggregate(cardTxns)
  const activeMonths = (
    cardAgg.completeMonths.length ? cardAgg.completeMonths : cardAgg.months
  ).slice()

  // Fixed bills and recurring income only apply from the first modelled
  // paycheck month — spending months before that would show costs with no
  // matching income (the reason 2025 history is scoped out of the P&L).
  const payMonths = paychecks
    .map((p) => String(p.payDate).slice(0, 7))
    .filter(Boolean)
    .sort()
  const incomeFloor = payMonths.length ? payMonths[0] : '2026-01'
  const fixedMonths = activeMonths.filter((m) => m >= incomeFloor)
  if (
    cardAgg.partialMonth &&
    cardAgg.partialMonth >= incomeFloor &&
    !fixedMonths.includes(cardAgg.partialMonth)
  )
    fixedMonths.push(cardAgg.partialMonth)

  // Fixed bills are synthetic transactions, one per active month.
  // schedule[m] present → use it; 0 → skip the month (paused); absent → base.
  const fixedTxns: Transaction[] = []
  for (const fx of fixedExpenses) {
    for (const m of fixedMonths) {
      const cat = fx.category || 'uncategorized'
      const amt = fx.schedule && fx.schedule[m] != null ? +fx.schedule[m] : +fx.amount || 0
      if (!amt) continue
      fixedTxns.push({
        date: m + '-01',
        month: m,
        time: '',
        cardholder: 'Fixed bill',
        amount: amt,
        points: 0,
        status: 'Recurring',
        type: 'Fixed',
        merchant: fx.name,
        description: 'Fixed monthly commitment' + (fx.schedule ? ' (actual)' : ''),
        category: cat,
        segment: SEGMENT_OF[cat] ?? 'essential',
        declined: false,
        isSpend: true,
        isFixed: true,
        fxId: fx.id
      })
    }
  }

  const transactions = cardTxns.concat(fixedTxns)
  const agg = aggregate(transactions)
  const cats = activeCategories(agg.catTotals)

  // Averages over complete months within the income window only.
  const cm = agg.completeMonths.filter((m) => m >= incomeFloor)
  const n = cm.length || 1
  const avgCat: Partial<Record<CategoryKey, number>> = {}
  for (const c of cats) {
    let s = 0
    for (const m of cm) s += agg.catMonth[c]?.[m] ?? 0
    avgCat[c] = s / n
  }
  const avgSeg: Partial<Record<Segment, number>> = {}
  for (const sg of SEGMENT_ORDER) {
    let s = 0
    for (const m of cm) s += agg.segMonth[sg]?.[m] ?? 0
    avgSeg[sg] = s / n
  }
  const completeTotals = cm.map((m) => agg.monthTotals[m] ?? 0)
  const avgMonthly = completeTotals.reduce((a, b) => a + b, 0) / n
  const trend = linreg(completeTotals)

  // ---- income model ----
  const incNetMonth: Record<string, number> = {}
  const incGrossMonth: Record<string, number> = {}
  const incTaxMonth: Record<string, number> = {}
  const incDedMonth: Record<string, number> = {}
  const incSalaryMonth: Record<string, number> = {}
  const incBonusMonth: Record<string, number> = {}
  const incOtherMonth: Record<string, number> = {}
  const incInterestMonth: Record<string, number> = {}

  for (const p of paychecks) {
    const m = String(p.payDate || '').slice(0, 7)
    if (!m) continue
    const net = +p.net || 0
    incNetMonth[m] = (incNetMonth[m] ?? 0) + net
    incGrossMonth[m] = (incGrossMonth[m] ?? 0) + (+p.gross || 0)
    incTaxMonth[m] = (incTaxMonth[m] ?? 0) + (+p.taxes || 0)
    incDedMonth[m] = (incDedMonth[m] ?? 0) + (+p.deductions || 0)
    if (+p.bonus) incBonusMonth[m] = (incBonusMonth[m] ?? 0) + net
    else incSalaryMonth[m] = (incSalaryMonth[m] ?? 0) + net
  }

  const recurMonthly = recurringIncome.reduce((s, r) => s + (+r.amount || 0), 0)
  for (const m of fixedMonths) {
    for (const r of recurringIncome) {
      const amt = +r.amount || 0
      const ty = String(r.type || '').toLowerCase()
      incNetMonth[m] = (incNetMonth[m] ?? 0) + amt
      if (ty.includes('bonus')) incBonusMonth[m] = (incBonusMonth[m] ?? 0) + amt
      else if (ty.includes('interest')) incInterestMonth[m] = (incInterestMonth[m] ?? 0) + amt
      else incOtherMonth[m] = (incOtherMonth[m] ?? 0) + amt
    }
  }

  for (const o of oneOffIncome) {
    const m = o.month
    const amt = +o.amount || 0
    if (!m || !amt) continue
    const ty = String(o.type || '').toLowerCase()
    incNetMonth[m] = (incNetMonth[m] ?? 0) + amt
    if (ty.includes('bonus')) incBonusMonth[m] = (incBonusMonth[m] ?? 0) + amt
    else if (ty.includes('interest')) incInterestMonth[m] = (incInterestMonth[m] ?? 0) + amt
    else incOtherMonth[m] = (incOtherMonth[m] ?? 0) + amt
  }

  const oneOffIncTotal = oneOffIncome.reduce((s, o) => s + (+o.amount || 0), 0)
  const incMonths = Object.keys(incNetMonth).sort()
  const incNetTotal = incMonths.reduce((s, m) => s + incNetMonth[m], 0)
  const salaryYTD = sumMap(incSalaryMonth)
  const bonusYTD = sumMap(incBonusMonth)
  const otherYTD = sumMap(incOtherMonth)
  const interestYTD = sumMap(incInterestMonth)

  // Net cash flow compares income and spend over overlapping months only.
  const overlap = agg.months.filter((m) => incNetMonth[m] != null)
  const spendOverlap = overlap.reduce((s, m) => s + (agg.monthTotals[m] ?? 0), 0)
  const ytdNetCash = incNetTotal - spendOverlap
  const savingsRate = incNetTotal ? ytdNetCash / incNetTotal : 0

  // Fixed bills per month, valued at the latest active month's schedule.
  const fmLast = fixedMonths.length ? fixedMonths[fixedMonths.length - 1] : null
  const fixedMonthly = fixedExpenses.reduce((s, f) => {
    const v =
      fmLast && f.schedule && f.schedule[fmLast] != null ? +f.schedule[fmLast] : +f.amount || 0
    return s + v
  }, 0)

  return {
    totalRowsParsed,
    rowsInScope,
    declinedExcluded,
    transactions,
    agg,
    cardAgg,
    oneOffs,
    excludedTotal,
    excludedCount,
    cats,
    avgCat,
    avgSeg,
    avgMonthly,
    completeTotals,
    trend,
    latestComplete: cm[cm.length - 1],
    priorComplete: cm[cm.length - 2],
    activeMonths,
    fixedMonths,
    incNetMonth,
    incGrossMonth,
    incTaxMonth,
    incDedMonth,
    incSalaryMonth,
    incBonusMonth,
    incOtherMonth,
    incInterestMonth,
    incMonths,
    incNetTotal,
    salaryYTD,
    bonusYTD,
    otherYTD,
    interestYTD,
    recurMonthly,
    oneOffIncTotal,
    fixedMonthly,
    overlap,
    spendOverlap,
    ytdNetCash,
    savingsRate
  }
}

function sumMap(m: Record<string, number>): number {
  let s = 0
  for (const k in m) s += m[k]
  return s
}
