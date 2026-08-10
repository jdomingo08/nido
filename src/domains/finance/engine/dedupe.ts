// Dedupe keys make re-imports idempotent: same file in → same keys out.
//
// Key = date|amount|merchant_lower|status|type|n, where n is the 0-based
// occurrence index of that tuple within the file. The occurrence index is a
// deliberate amendment to the handoff spec (DECISIONS.md §9): the fixture
// contains legitimately identical rows — two posted OpenAI $10.00 charges on
// 2026-03-15 and three declined retry pairs — that a key of the documented
// five fields alone would collapse into single rows.

export interface DedupeFields {
  date: string
  amount: number
  merchant: string
  status: string
  type: string
}

export function assignDedupeKeys(txns: DedupeFields[]): string[] {
  const seen = new Map<string, number>()
  return txns.map((t) => {
    const base = [
      t.date,
      t.amount.toFixed(2),
      t.merchant.trim().toLowerCase(),
      t.status,
      t.type
    ].join('|')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return base + '|' + n
  })
}
