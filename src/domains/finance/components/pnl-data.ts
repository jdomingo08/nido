// Shapes the engine's DashboardModel into a serializable view-model for the
// P&L client component. Pure — safe to import from Server Components.

import {
  FIXED_CATS,
  SEGMENT_OF,
  SEGMENT_ORDER,
  type CategoryKey,
  type DashboardModel,
  type Segment
} from '@/domains/finance/engine'

export type IncomeBucket = 'salary' | 'bonus' | 'other' | 'interest'

export interface PnlIncomeRow {
  bucket: IncomeBucket
  byMonth: Record<string, number>
  total: number
  avg: number
}

export interface PnlCatRow {
  key: CategoryKey
  fixed: boolean
  byMonth: Record<string, number>
  total: number
  avg: number
  pctOfSpend: number
}

export interface PnlSegmentBlock {
  segment: Segment
  rows: PnlCatRow[]
  subtotalByMonth: Record<string, number>
  subtotal: number
  avg: number
  pctOfSpend: number
}

export interface PnlOneOff {
  id: string
  date: string
  month: string
  merchant: string
  category: CategoryKey
  amount: number
  linkedCount: number
  linkedTotal: number
  net: number
}

export interface PnlDrillTxn {
  date: string
  month: string
  merchant: string
  description: string
  amount: number
  category: CategoryKey
  type: string
  isFixed: boolean
}

export interface PnlPaycheck {
  payDate: string
  net: number
  isBonus: boolean
  verified: boolean
}

export interface PnlRecurringIncome {
  name: string
  amount: number
  bucket: IncomeBucket
}

export interface PnlOneOffIncome {
  month: string
  name: string
  amount: number
  bucket: IncomeBucket
}

export interface PnlViewData {
  months: string[]
  partialMonth: string | null
  hasIncome: boolean
  incomeRows: PnlIncomeRow[]
  incomeTotalByMonth: Record<string, number>
  incomeTotal: number
  incomeAvg: number
  segments: PnlSegmentBlock[]
  monthTotals: Record<string, number>
  totalSpend: number
  avgMonthly: number
  netByMonth: Record<string, number | null>
  netTotal: number
  savingsRate: number
  memoPayments: number
  memoCredits: number
  oneOffs: PnlOneOff[]
  excludedIds: string[]
  excludedCount: number
  excludedTotal: number
  drillTxns: PnlDrillTxn[]
  paychecks: PnlPaycheck[]
  recurring: PnlRecurringIncome[]
  oneOffIncome: PnlOneOffIncome[]
  fixedMonths: string[]
}

export function buildPnlViewData(
  model: DashboardModel,
  excludedIds: string[],
  income: {
    paychecks: PnlPaycheck[]
    recurring: PnlRecurringIncome[]
    oneOffIncome: PnlOneOffIncome[]
  }
): PnlViewData {
  const { agg } = model
  const months = agg.months
  const overlapCount = model.overlap.length || 1

  const bucketMaps: Record<IncomeBucket, Record<string, number>> = {
    salary: model.incSalaryMonth,
    bonus: model.incBonusMonth,
    other: model.incOtherMonth,
    interest: model.incInterestMonth
  }
  const incomeRows: PnlIncomeRow[] = (Object.keys(bucketMaps) as IncomeBucket[])
    .map((bucket) => {
      const byMonth = bucketMaps[bucket]
      const total = Object.values(byMonth).reduce((s, v) => s + v, 0)
      return { bucket, byMonth, total, avg: total / overlapCount }
    })
    .filter((r) => r.total !== 0)

  const segments: PnlSegmentBlock[] = SEGMENT_ORDER.map((segment) => {
    const segCats = model.cats
      .filter((c) => SEGMENT_OF[c] === segment)
      .sort((a, b) => (agg.catTotals[b] ?? 0) - (agg.catTotals[a] ?? 0))
    const rows: PnlCatRow[] = segCats.map((key) => ({
      key,
      fixed: FIXED_CATS.has(key),
      byMonth: agg.catMonth[key] ?? {},
      total: agg.catTotals[key] ?? 0,
      avg: model.avgCat[key] ?? 0,
      pctOfSpend: agg.total ? (agg.catTotals[key] ?? 0) / agg.total : 0
    }))
    return {
      segment,
      rows,
      subtotalByMonth: agg.segMonth[segment] ?? {},
      subtotal: agg.segTotals[segment] ?? 0,
      avg: model.avgSeg[segment] ?? 0,
      pctOfSpend: agg.total ? (agg.segTotals[segment] ?? 0) / agg.total : 0
    }
  }).filter((s) => s.rows.length > 0)

  const netByMonth: Record<string, number | null> = {}
  for (const m of months) {
    const inc = model.incNetMonth[m]
    netByMonth[m] = inc == null ? null : inc - (agg.monthTotals[m] ?? 0)
  }

  return {
    months,
    partialMonth: agg.partialMonth,
    hasIncome: incomeRows.length > 0,
    incomeRows,
    incomeTotalByMonth: model.incNetMonth,
    incomeTotal: model.incNetTotal,
    incomeAvg: model.incNetTotal / overlapCount,
    segments,
    monthTotals: agg.monthTotals,
    totalSpend: agg.total,
    avgMonthly: model.avgMonthly,
    netByMonth,
    netTotal: model.ytdNetCash,
    savingsRate: model.savingsRate,
    memoPayments: Object.values(agg.payByMonth).reduce((s, v) => s + v, 0),
    memoCredits: Object.values(agg.credByMonth).reduce((s, v) => s + v, 0),
    oneOffs: model.oneOffs.map((o) => ({
      id: o.id,
      date: o.date,
      month: o.month,
      merchant: o.merchant,
      category: o.category,
      amount: o.amount,
      linkedCount: o.linked.length,
      linkedTotal: o.linkedTotal,
      net: o.net
    })),
    excludedIds,
    excludedCount: model.excludedCount,
    excludedTotal: model.excludedTotal,
    drillTxns: model.transactions
      .filter((t) => t.isSpend)
      .map((t) => ({
        date: t.date,
        month: t.month,
        merchant: t.merchant,
        description: t.description,
        amount: t.amount,
        category: t.category,
        type: t.type,
        isFixed: t.isFixed ?? false
      })),
    paychecks: income.paychecks,
    recurring: income.recurring,
    oneOffIncome: income.oneOffIncome,
    fixedMonths: model.fixedMonths
  }
}
