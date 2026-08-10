// Projection helpers, ported from reference/app.js.

import type { LinearFit } from './types'

// Least-squares fit over equally spaced samples (month index → total).
export function linreg(y: number[]): LinearFit {
  const n = y.length
  if (n < 2) {
    const flat = n ? y[0] : 0
    return { m: 0, b: flat, predict: () => flat }
  }
  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += y[i]
    sxy += i * y[i]
    sxx += i * i
  }
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const b = (sy - m * sx) / n
  return { m, b, predict: (x: number) => m * x + b }
}
