// Transaction categorization and enrichment, ported from reference/engine.js.
// Rules come in as a parameter (family-editable rows in the database), never
// from a module constant — the one intentional signature change from the
// reference implementation.

import { cleanMerchant, num } from './parse'
import { SEGMENT_OF } from './taxonomy'
import type { CategoryKey, CategoryRule, MerchantOverrides, RawRecord, Transaction } from './types'

export function categorize(
  merchant: unknown,
  description: unknown,
  type: string,
  rules: CategoryRule[],
  overrides?: MerchantOverrides
): CategoryKey {
  // Card payments are transfers; points/statement credits are adjustments.
  // Neither is spend — both are excluded from aggregates and shown as a memo.
  if (type === 'Payment') return 'card_payment'
  if (type === 'Other') return 'credits_rewards'

  const merchantStr = String(merchant ?? '').trim()
  const key = merchantStr.toLowerCase()
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key]

  const hay = (String(merchant ?? '') + ' ' + String(description ?? '')).toLowerCase()
  for (const rule of rules) {
    if (rule.exact) {
      if (key === rule.match.toLowerCase()) return rule.category
    } else if (hay.includes(rule.match)) {
      return rule.category
    }
  }
  return 'uncategorized'
}

export function enrich(
  records: RawRecord[],
  rules: CategoryRule[],
  overrides?: MerchantOverrides
): Transaction[] {
  return records.map((r) => {
    const amount = num(r.Amount)
    const declined = r.Status === 'Declined'
    const merchant = cleanMerchant(r.Merchant)
    const category = categorize(merchant, r.Description, r.Type ?? '', rules, overrides)
    const segment = SEGMENT_OF[category] ?? 'unassigned'
    // Declined rows are excluded from all spend — banks include declined
    // attempts, often duplicated (e.g. the $5,435.41 Apmex retry).
    const isSpend = !declined && (r.Type === 'Purchase' || r.Type === 'Refund')
    return {
      date: r.Date || '',
      month: String(r.Date || '').slice(0, 7),
      time: r.Time || '',
      cardholder: String(r.Cardholder || '').trim(),
      amount,
      points: parseInt(r.Points || '0', 10) || 0,
      status: r.Status || '',
      type: r.Type || '',
      merchant,
      description: r.Description || '',
      category,
      segment,
      declined,
      isSpend
    }
  })
}
