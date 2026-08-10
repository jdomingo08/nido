// CSV parsing and numeric helpers, ported from reference/engine.js.

import type { RawRecord } from './types'

export function num(x: unknown): number {
  if (x === null || x === undefined) return 0
  const v = parseFloat(String(x).replace(/[$,]/g, ''))
  return Number.isNaN(v) ? 0 : v
}

export function cleanMerchant(m: unknown): string {
  return String(m ?? '')
    .replace(/^Refund:\s*/i, '')
    .trim()
}

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

// Minimal RFC-4180-ish parser: handles quoted fields, escaped quotes ("") and
// both newline conventions. Bank exports are messy; do not swap this for a
// naive split(',').
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let inQ = false
  const src = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  while (i < src.length) {
    const c = src[i]
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQ = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQ = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += c
    i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export function recordsFromCSV(text: string): RawRecord[] {
  const grid = parseCSV(text)
  if (!grid.length) return []
  const header = grid[0].map((h) => String(h).trim())
  const objs: RawRecord[] = []
  for (let r = 1; r < grid.length; r++) {
    const g = grid[r]
    if (g.length === 1 && g[0] === '') continue
    const o: RawRecord = {}
    for (let k = 0; k < header.length; k++) o[header[k]] = g[k] !== undefined ? g[k] : ''
    if (!o.Date && !o.Amount && !o.Merchant) continue
    objs.push(o)
  }
  return objs
}
