// Spend aggregation, ported from reference/engine.js.

import { CATEGORY_ORDER } from './taxonomy'
import type { Aggregate, CategoryKey, Transaction } from './types'

export function aggregate(txns: Transaction[]): Aggregate {
  // Refunds carry negative amounts and simply sum in — a $554.52 grocery buy
  // with −$295 and −$41 reimbursements nets to $218.52 inside its category.
  const spend = txns.filter(
    (t) => t.isSpend && t.category !== 'credits_rewards' && t.category !== 'card_payment'
  )

  const monthsSet: Record<string, true> = {}
  const catTotals: Partial<Record<CategoryKey, number>> = {}
  const segTotals: Aggregate['segTotals'] = {}
  const monthTotals: Record<string, number> = {}
  const catMonth: Aggregate['catMonth'] = {}
  const segMonth: Aggregate['segMonth'] = {}
  const merchantTotals: Record<string, number> = {}
  const merchantMeta: Aggregate['merchantMeta'] = {}
  const payByMonth: Record<string, number> = {}
  const credByMonth: Record<string, number> = {}
  const txnCountMonth: Record<string, number> = {}

  for (const t of spend) {
    monthsSet[t.month] = true
    catTotals[t.category] = (catTotals[t.category] ?? 0) + t.amount
    segTotals[t.segment] = (segTotals[t.segment] ?? 0) + t.amount
    monthTotals[t.month] = (monthTotals[t.month] ?? 0) + t.amount
    txnCountMonth[t.month] = (txnCountMonth[t.month] ?? 0) + 1
    const cm = (catMonth[t.category] = catMonth[t.category] ?? {})
    cm[t.month] = (cm[t.month] ?? 0) + t.amount
    const sm = (segMonth[t.segment] = segMonth[t.segment] ?? {})
    sm[t.month] = (sm[t.month] ?? 0) + t.amount
    merchantTotals[t.merchant] = (merchantTotals[t.merchant] ?? 0) + t.amount
    if (!merchantMeta[t.merchant]) merchantMeta[t.merchant] = { count: 0, category: t.category }
    merchantMeta[t.merchant].count++
  }

  for (const t of txns) {
    if (t.declined) continue
    if (t.category === 'card_payment') payByMonth[t.month] = (payByMonth[t.month] ?? 0) + t.amount
    if (t.category === 'credits_rewards')
      credByMonth[t.month] = (credByMonth[t.month] ?? 0) + t.amount
  }

  const months = Object.keys(monthsSet).sort()
  const total = months.reduce((s, m) => s + (monthTotals[m] ?? 0), 0)

  // Partial-month detection: the latest month is partial if its max
  // transaction date is before the 28th. Partial months are excluded from
  // averages and projections so a month-to-date figure doesn't drag them down.
  let maxDate = ''
  for (const t of txns) {
    if (!t.declined && t.date > maxDate) maxDate = t.date
  }
  const currentMonth = maxDate.slice(0, 7)
  const maxDay = parseInt(maxDate.slice(8, 10), 10) || 1
  const partialMonth =
    months.length && months[months.length - 1] === currentMonth && maxDay < 28 ? currentMonth : null
  const completeMonths = months.filter((m) => m !== partialMonth)

  return {
    spend,
    months,
    completeMonths,
    partialMonth,
    currentMonth,
    maxDate,
    maxDay,
    catTotals,
    segTotals,
    monthTotals,
    catMonth,
    segMonth,
    txnCountMonth,
    merchantTotals,
    merchantMeta,
    payByMonth,
    credByMonth,
    total
  }
}

// Categories present in the data, in canonical display order; anything not in
// CATEGORY_ORDER (e.g. new user-defined categories) appends at the end.
export function activeCategories(catTotals: Partial<Record<CategoryKey, number>>): CategoryKey[] {
  const present = Object.keys(catTotals) as CategoryKey[]
  const ordered = CATEGORY_ORDER.filter((c) => present.includes(c))
  for (const c of present) if (!ordered.includes(c)) ordered.push(c)
  return ordered
}
