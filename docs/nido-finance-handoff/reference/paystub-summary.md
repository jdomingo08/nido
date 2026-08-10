# Source document — Entravision pay stub

Transcribed from `EEPayrollPayCheckDetail may 30 2026.pdf`. **This is the origin of every income figure in `fixtures/config.json`.** The original PDF was not included (it contains an employee number and home address); everything needed to reproduce the model is below.

```
Employer      Entravision Communications Corporation
Employee      Jorge M Domingo
Job           VP, Strategy & Programs
Frequency     Semi-Monthly (24 checks/year)

Period        05/16/2026 – 05/31/2026      Pay date 05/29/2026
```

## This check

| Earnings | Hours | Rate | Current | YTD |
|---|---|---|---|---|
| Regular Pay | 86.667 | $56.9625 | $4,936.77 | $49,367.70 |
| Bonus Pay | — | — | $0.00 | **$10,000.00** |

| Deduction (pre-tax) | Current | YTD | Employer YTD |
|---|---|---|---|
| 401K Fidelity | $296.21 | $3,562.10 | $1,781.00 |
| Entravision FL (medical) | $281.12 | $2,203.60 | — |
| Vision Sec 125 | $6.38 | $63.80 | — |

| Tax | Current | YTD |
|---|---|---|
| Federal Income Tax | $340.70 | $5,547.90 |
| Employee Medicare | $67.41 | $827.95 |
| Social Security | $288.26 | $3,540.22 |

| Pay summary | Gross | FIT taxable | Taxes | Deductions | **Net** |
|---|---|---|---|---|---|
| Current | $4,936.77 | $4,353.06 | $696.37 | $583.71 | **$3,656.69** |
| **YTD** | **$59,367.70** | $53,538.20 | $9,916.07 | $5,829.50 | **$43,622.13** |

Net pay is split across two checking accounts ($3,000.00 + $656.69).

## Time off (as of this stub)

Paid Time Off 8.00 hrs · Sick 48.00 hrs · Vacation 180.00 hrs

## How the model was reconstructed

The stub gives YTD totals, so all ten Jan–May paychecks are derivable:

```
10 regular checks × $3,656.69   = $36,566.90
bonus net (plug)                = $ 7,055.23
                                  ───────────
                                  $43,622.13   ← matches stub YTD net exactly
```

Bonus net is therefore **$7,055.23** on $10,000 gross (implied tax $2,944.77). Amortized across 12 months → **$587.94/mo**. See `DECISIONS.md §2` for why net rather than gross.

**Effective rates worth noting:** taxes ≈16.7% of gross, pre-tax deductions ≈9.8%, take-home ≈73.5%. Useful for sanity-checking future stubs — a big deviation means something changed (raise, benefit change, bonus).

**Only this one stub was provided.** Jun/Jul paychecks are projected at the same rate. Ask for the real stubs.
