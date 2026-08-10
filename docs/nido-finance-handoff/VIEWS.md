# Feature Spec — all nine views

Every view and interaction in the reference dashboard. **Open `reference/dashboard.html` alongside this document.** Implementation lives in `reference/app.js` (function names given below).

Phase mapping: **P1** = build now · **P2** = interactivity pass · **P3** = Nido-native.

---

## Shared shell

Left sidebar (nav, brand, YTD total) + sticky topbar (eyebrow, title, "Update CSV"). Nine nav items. Reference is desktop-first with a fixed sidebar; **Nido must be mobile-first** — this needs a responsive rethink, not a straight port.

### Formatting rules — get these right, they're everywhere
- Currency uses a **Unicode minus (−, U+2212)** for negatives, not a hyphen: `−$3,714`
- `money0()` (no decimals) in KPIs/charts; `money()` (2dp) in tables and drill-downs
- All numerals use **tabular figures** (`font-variant-numeric: tabular-nums`) so columns align
- Zero cells render as `·`, not `$0`
- Partial months get an asterisk in column headers (`Jun*`)
- Positive net = green, negative = red; **for spending, an increase is red** (`.down`) — inverted vs. income

---

## 1. Overview `P1`

`vOverview()`

Five KPI cards: Net Income YTD · Total Spend YTD · Net Cash Flow · Savings Rate · Fixed Bills/mo. Net Cash Flow is colour-driven by sign.

- **CFO note** — prose insight panel. Hand-written today; becomes the agent in P3.
- **Income vs spending** — grouped bars (income/spend) with a dashed net-cash-flow overlay line.
- **Monthly spend** — area chart.
- **Spending mix** — donut, top 6 categories + "Other", with legend showing value and %.
- **Segments** — horizontal proportion strip (Essential/Lifestyle/Business/Investment).
- **Biggest movers** — top 6 category deltas, latest complete month vs. prior.

## 2. Income `P1` (read) / `P2` (edit)

`vIncome()`

KPIs: Total Income YTD · Salary+Bonus · Other Income · Fixed Bills · Net Cash Flow.

- Monthly income area chart
- **Income by source** — salary / bonus / other / interest with % shares
- **Verified paycheck** — the real stub broken out line by line (federal tax, Medicare, Social Security, 401k, benefits) → net
- **Other income** — recurring list + a "One-off · $X" sub-list; `P2`: add/delete
- **Run-rate** — monthly income, annual net, annual fixed bills
- **Paychecks table** — every pay period with gross/taxes/deductions/net and a provenance badge: `verified` (stub) · `derived` · `est.` (projected) · `added`. **Keep these badges** — they tell the user which figures to trust.
- **Fixed bills** — all nine, with a `paused Jun, Jul` badge on scheduled zeros; `P2`: add/delete/edit

## 3. P&L Statement `P1` — the centrepiece

`vPnl()`

Months as columns, then YTD / Avg-per-month / % columns.

Row structure:
1. **Income** section — Salary, Bonus, Other, Interest, then *Total income*
2. **Expense** sections grouped by segment, each with a segment subtotal row; fixed categories carry a `fixed` badge
3. **Total Net Spend** grand total
4. **Net (savings)** row — signed and colour-coded per month
5. **Memo** below the table: card payments and statement credits, explicitly excluded from spend

### One-off charge toggles `P1`
Panel above the statement. **Any single non-declined purchase ≥ $500 auto-appears** — not a hardcoded list. Each row: date · merchant · net amount · included/excluded state. Plus *Include all* / *Exclude all* and a banner showing count and total excluded.

Excluding a purchase **also excludes refunds on the same merchant+date** (so Meat Club's credits follow it, shown as "incl. −$336.00 credits → net $218.52").

Toggling recalculates **the entire dashboard**, not just the P&L — a deliberate choice so no two views ever disagree. Persisted (currently `localStorage`, → `finance_settings.excluded_txns`).

### Drill-down `P1`
Every populated cell is clickable:
- **Category cell** → every transaction in that category+month, sorted by size, with a total. Fixed bills show a `fixed` badge; refunds show their description ("Credit from Jose").
- **Monthly total** → all categories for that month, each clickable through to its transactions.
- **Income line** → the paychecks or recurring/one-off items composing it.

## 4. Cash Flow `P1`

`vCash()`

- **Net cash flow** — grouped bars + net overlay, plus a table of month / net income / total spend / net flow / savings %, with a YTD row
- **Cash flow by month** — stacked bars, toggle **By segment ⇄ By category**
- **Month-over-month** table — net spend, MoM %, txn count, avg/txn, card paid, credits
- **Category heatmap** — categories × months, cell darkness ∝ amount

## 5. Categories `P1` (grid) / `P2` (detail)

`vCats()` · `catDetailPanel()`

Card grid sorted by spend: category, segment pill, YTD total, % of spend, avg/mo, sparkline, top merchant. Clicking opens a detail panel: mini-KPIs, monthly trend, and a ranked merchant bar chart with counts.

## 6. Projections `P2`

`vProj()`

Full-year forecast with two methods: **Run-rate** (category averages × 12) and **Trend** (linear regression over monthly totals). A manual adjustment slider (−30%…+30%) models cutting back.

- **Projected savings** — projected income vs. spend vs. savings and rate
- **By category** table — YTD, avg/mo, projected

**Lumpy categories are held flat.** `Investments` is flagged `one-time` and not annualized — otherwise the $5,435 bullion buy projects to $65k. There's a checkbox to toggle this behaviour. Preserve it.

## 7. Budget Alerts `P2`

`vAlerts()`

Month selector; banner summarising how many categories are over and by how much. Per category: pace bar, actual (plus a paced projection for partial months), an **editable budget input**, and a status tag.

- Thresholds: **>100% = over (red) · >85% = watch (amber) · else ok (green)**
- Budgets seed from historical monthly averages, rounded to $5
- **Fixed categories show a `fixed` badge and never flag as overspending** — you can't overspend your mortgage
- Partial months pace to a full month before comparison (`actual ÷ dayFraction`)

## 8. Transactions `P1` (list) / `P2` (edit)

`vTxns()`

Search + filters (month, category, cardholder), a declined toggle, and a running count/net. Each row: date, merchant (+ pending/declined badges), an inline **category dropdown**, cardholder, amount (credits in green).

Changing a category creates a **merchant-level override that applies to every transaction from that merchant**, past and future — not just the one row. Fixed-bill rows are excluded from this list.

## 9. Data & Tags `P1`/`P2`

`vData()`

- **Drop zone** for the weekly CSV (drag-drop or browse) → becomes the upload endpoint
- Metadata: transaction count, date range, net spend, last updated
- Actions: export categorized CSV · export settings JSON · import settings · reset overrides · restore bundled data
- **Merchant → category table**: every merchant with count, YTD total, and a category dropdown; `custom` badge on overridden ones

This is where the categorization engine is made visible and editable — Jorge specifically valued seeing "how merchants map to categories."

---

## Charts — all hand-rolled SVG, no library

In `reference/app.js`. Port to JSX; they carry zero dependencies.

| Function | Used for |
|---|---|
| `donut()` | spending mix |
| `areaLine()` | monthly trends |
| `stackedBars()` | cash flow by segment/category |
| `groupedBars()` | income vs spend + net overlay line |
| `sparkline()` | category cards |
| `hbars()` | merchant rankings |
| `heatColor()` | heatmap interpolation |

All include `<title>` children for native hover tooltips and use `viewBox` for responsive scaling. `niceMax()` computes round axis maxima.

---

## State → database mapping

Everything currently in `localStorage` moves to Postgres, family-scoped:

| localStorage key | Destination |
|---|---|
| `cfo_budgets` | `finance_settings.budgets` |
| `cfo_overrides` | `finance_merchant_overrides` |
| `cfo_excluded` | `finance_settings.excluded_txns` |
| `cfo_paychecks` · `cfo_recurring` · `cfo_fixed` | `finance_income` · `finance_fixed_items` |
| `cfo_csv` · `cfo_updated` | `finance_transactions` |
