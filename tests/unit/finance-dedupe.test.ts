// Dedupe-key semantics (DECISIONS.md §9): identical tuples within one file
// get distinct occurrence-indexed keys, and the same file always produces the
// same keys — the property that makes re-imports idempotent.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_RULES, assignDedupeKeys, enrich, recordsFromCSV } from '@/domains/finance/engine'

const FIXTURES = path.resolve(__dirname, '../../docs/nido-finance-handoff/fixtures')

describe('assignDedupeKeys', () => {
  it('gives identical rows distinct occurrence-indexed keys', () => {
    const rows = [
      { date: '2026-03-15', amount: 10, merchant: 'OpenAI', status: 'Posted', type: 'Purchase' },
      { date: '2026-03-15', amount: 10, merchant: 'OpenAI', status: 'Posted', type: 'Purchase' }
    ]
    const keys = assignDedupeKeys(rows)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[0].endsWith('|0')).toBe(true)
    expect(keys[1].endsWith('|1')).toBe(true)
  })

  it('is deterministic: the same file produces the same keys', () => {
    const csv = readFileSync(path.join(FIXTURES, 'transactions.csv'), 'utf8')
    const txns = enrich(recordsFromCSV(csv), DEFAULT_RULES)
    const a = assignDedupeKeys(txns)
    const b = assignDedupeKeys(txns)
    expect(a).toEqual(b)
  })

  it('assigns 617 unique keys across the fixture (no silent collisions)', () => {
    const csv = readFileSync(path.join(FIXTURES, 'transactions.csv'), 'utf8')
    const txns = enrich(recordsFromCSV(csv), DEFAULT_RULES)
    const keys = assignDedupeKeys(txns)
    expect(keys).toHaveLength(617)
    expect(new Set(keys).size).toBe(617)
  })
})
