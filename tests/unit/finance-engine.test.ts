// Focused unit tests for the domain rules that are easy to get wrong
// (BRIEF.md §6). Each of these encodes a behaviour learned from real bank
// data — see DECISIONS.md before "fixing" any of them.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES,
  categorize,
  computeDashboard,
  oneOffId,
  parseCSV,
  round2
} from '@/domains/finance/engine'

const HEADER = 'Date,Time,Cardholder,Amount,Points,Balance,Status,Type,Merchant,Description'

function csv(rows: string[]): string {
  return [HEADER, ...rows].join('\n')
}

describe('categorize · rule ordering is load-bearing', () => {
  it("routes 'uber eats' to dining before 'uber' hits transportation", () => {
    expect(categorize('Uber Eats', '', 'Purchase', DEFAULT_RULES)).toBe('dining_takeout')
    expect(categorize('Uber Trip', '', 'Purchase', DEFAULT_RULES)).toBe('transportation_auto')
  })

  it("routes 'central park' / 'parks broward' to entertainment before 'parking'", () => {
    expect(categorize('Central Park Parking', '', 'Purchase', DEFAULT_RULES)).toBe(
      'entertainment_recreation'
    )
    expect(categorize('Mpa Parkin Pay By Phon', '', 'Purchase', DEFAULT_RULES)).toBe(
      'transportation_auto'
    )
  })

  it('matches UPS exactly, not as a substring', () => {
    expect(categorize('UPS', '', 'Purchase', DEFAULT_RULES)).toBe('business_software')
    // 'cups' contains 'ups' — an exact rule must not fire on it
    expect(categorize('World of Cups', '', 'Purchase', DEFAULT_RULES)).toBe('uncategorized')
  })

  it('classifies Payment and Other as non-spend adjustment pseudo-categories', () => {
    expect(categorize('Payment', '', 'Payment', DEFAULT_RULES)).toBe('card_payment')
    expect(categorize('Points Redeemed', '', 'Other', DEFAULT_RULES)).toBe('credits_rewards')
  })

  it('merchant overrides beat every rule', () => {
    expect(
      categorize('Winn-Dixie', '', 'Purchase', DEFAULT_RULES, { 'winn-dixie': 'shopping_retail' })
    ).toBe('shopping_retail')
  })
})

describe('parseCSV', () => {
  it('handles quoted fields with commas and escaped quotes', () => {
    const grid = parseCSV('a,"b,c","d""e"\n1,2,3')
    expect(grid).toEqual([
      ['a', 'b,c', 'd"e'],
      ['1', '2', '3']
    ])
  })
})

describe('fixed-bill schedules', () => {
  const twoMonthsCsv = csv([
    '2026-01-05,1:00 PM,JORGE DOMINGO,10.00,0,,Posted,Purchase,Publix,',
    '2026-02-28,1:00 PM,JORGE DOMINGO,10.00,0,,Posted,Purchase,Publix,'
  ])

  it('a schedule value of 0 skips the month entirely; absent falls back to base', () => {
    const model = computeDashboard({
      csvText: twoMonthsCsv,
      rules: DEFAULT_RULES,
      fixedExpenses: [
        {
          id: 'fx-test',
          name: 'Test bill',
          amount: 100,
          category: 'utilities',
          schedule: { '2026-01': 0 }
        }
      ]
    })
    expect(model.agg.catMonth.utilities).toEqual({ '2026-02': 100 })
  })

  it('a schedule value overrides the base amount for that month', () => {
    const model = computeDashboard({
      csvText: twoMonthsCsv,
      rules: DEFAULT_RULES,
      fixedExpenses: [
        {
          id: 'fx-test',
          name: 'Test bill',
          amount: 100,
          category: 'utilities',
          schedule: { '2026-01': 250.5 }
        }
      ]
    })
    expect(model.agg.catMonth.utilities).toEqual({ '2026-01': 250.5, '2026-02': 100 })
  })
})

describe('one-off exclusion', () => {
  it('excluding a purchase also excludes its linked same-merchant same-date refunds', () => {
    const model = computeDashboard({
      csvText: csv([
        '2026-06-20,1:00 PM,JORGE DOMINGO,554.52,0,,Posted,Purchase,Meat Club Market,',
        '2026-06-20,2:00 PM,JORGE DOMINGO,-295.00,0,,Posted,Refund,Meat Club Market,Credit from Jose',
        '2026-06-20,3:00 PM,JORGE DOMINGO,-41.00,0,,Posted,Refund,Meat Club Market,Credit from JP',
        '2026-06-28,1:00 PM,JORGE DOMINGO,20.00,0,,Posted,Purchase,Publix,'
      ]),
      rules: DEFAULT_RULES,
      excludedOneOffIds: [
        oneOffId({ date: '2026-06-20', amount: 554.52, merchant: 'Meat Club Market' })
      ]
    })
    // Neither the purchase nor the −$336 of credits remain
    expect(round2(model.agg.catTotals.groceries_household ?? 0)).toBe(20)
    expect(round2(model.excludedTotal)).toBe(218.52)
    expect(model.excludedCount).toBe(1)
  })

  it('declined purchases never become one-off candidates', () => {
    const model = computeDashboard({
      csvText: csv([
        '2026-02-15,1:00 PM,JORGE DOMINGO,5435.41,0,,Declined,Purchase,Apmex,',
        '2026-02-15,2:00 PM,JORGE DOMINGO,5435.41,0,,Posted,Purchase,Apmex,'
      ]),
      rules: DEFAULT_RULES
    })
    expect(model.oneOffs).toHaveLength(1)
    expect(round2(model.agg.catTotals.investments ?? 0)).toBe(5435.41)
  })
})

describe('partial months', () => {
  it('flags the latest month as partial when its max date is before the 28th', () => {
    const model = computeDashboard({
      csvText: csv([
        '2026-01-30,1:00 PM,JORGE DOMINGO,10.00,0,,Posted,Purchase,Publix,',
        '2026-02-10,1:00 PM,JORGE DOMINGO,10.00,0,,Posted,Purchase,Publix,'
      ]),
      rules: DEFAULT_RULES
    })
    expect(model.agg.partialMonth).toBe('2026-02')
    expect(model.agg.completeMonths).toEqual(['2026-01'])
  })
})
