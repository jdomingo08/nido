# Nido — Finance Domain: Build Brief

**For:** Claude Code
**Repo:** Nido (Next.js 16 App Router · React 19 · Supabase · TypeScript · Tailwind v4 · next-intl · Vitest)
**Goal:** Port a working personal-CFO dashboard into Nido as a first-class domain at `src/domains/finance/`.

---

## 1. Read this first

This is **not** a greenfield feature. A fully working version already exists as a single self-contained HTML file, built and refined over many iterations against real data. It is included in `reference/`.

**Your job is a port, not a redesign.** The financial logic is correct and verified. `fixtures/golden-master.json` contains the exact expected output of that logic. A correct port reproduces every number in it. Treat that file as the definition of done for Phase 1.

Do not "improve" the calculation rules while porting. If something looks wrong, flag it — don't silently change it. Several rules that look odd are deliberate and were arrived at by debugging real bank data (see §6).

---

## 2. What the product does

A household financial dashboard: ingests credit-card CSV exports, categorizes every transaction, layers in fixed bills and income that never appear on the card, and produces a monthly P&L, cash-flow view, projections, and overspend alerts.

Nine views exist today: Overview, Income, P&L Statement, Cash Flow, Categories, Projections, Budget Alerts, Transactions, Data & Tags.

**Why it belongs in Nido:** Nido is a family "nest" app. Household finances are family-scoped by nature — this should hang off the existing `family` domain, not be user-scoped. Both spouses should see the same books.

---

## 3. What's in this package

```
BRIEF.md                      ← you are here: architecture + phases
DECISIONS.md                  ← WHY every number is what it is. Read before touching config.
VIEWS.md                      ← feature spec for all nine views
SCHEMA.sql                    ← starter Supabase migration + RLS policies
reference/
  engine.js                   ← THE CORE LOGIC. Port this to TypeScript first.
  app.js                      ← UI layer: views, SVG charts, state. Port second.
  design-tokens.css           ← CSS custom properties → Tailwind v4 @theme
  dashboard.html              ← the working app. Open it in a browser first.
  paystub-summary.md          ← source doc behind every income figure
fixtures/
  golden-master.json          ← verified expected outputs. Your test oracle.
  transactions.csv            ← 617 rows (Jan–Jul 2026) = 613 bank + 4 manual
  manual-adjustments.csv      ← the 4 manual rows isolated. MUST survive re-imports.
  config.json                 ← fixed bills, paychecks, recurring + one-off income
  history-2025.csv            ← 86 rows Oct–Dec 2025. OUT of P&L scope — see below.
```

**Start by opening `reference/dashboard.html` in a browser.** Click through all nine views, open the P&L drill-downs, toggle the one-off charges. Ten minutes there will save you hours.

**Then read `DECISIONS.md` end to end.** `config.json` looks like arbitrary numbers without it. Examples of things you would otherwise get wrong: the bonus is amortized **net** ($587.94/mo) not gross, on purpose; Verizon sits in `Phone` rather than `Utilities` on purpose; the student loan is zeroed for Jun–Jul on purpose; seven merchants are left `Uncategorized` on purpose.

## 3a. Data completeness — this package is the whole system of record

Everything ever entered into the working dashboard is here. Nothing lives only in a chat log. Specifically:

- **All 617 transactions**, including the 4 manual rows that appear in no bank export
- **All 9 fixed monthly bills**, with per-month schedules where amounts vary (FPL) or are paused (student loan, swim lessons)
- **All 14 paychecks** with provenance (`stub` / `reconstructed` / `projected`)
- **All 6 recurring income items + 3 one-off items**
- **Employer pay-stub detail** in `reference/paystub-summary.md`
- **Oct–Dec 2025 history** — deliberately excluded from the P&L (no matching income data), preserved for future trailing-12-month work
- **Every assumption, its rationale, confidence level, and 6 open questions** in `DECISIONS.md`

**Every phase must preserve all of it.** Do not ship a phase that drops fixed bills, loses paycheck provenance badges, silently re-categorizes the deliberately-uncategorized merchants, or folds 2025 into YTD totals.

---

## 4. Target architecture

```
src/domains/finance/
  engine/          types.ts · parse.ts · categorize.ts · aggregate.ts · project.ts
  data/            queries.ts · mutations.ts   (Supabase, server-only)
  components/      views + chart primitives
  agents/          cfo-note.ts   (Phase 3 — fits your existing multi-agent system)
  index.ts
app/[locale]/(app)/finance/
  page.tsx                     Server Component: fetch → pass to views
  import/route.ts              POST CSV → parse → upsert
```

**Layer rules**
- `engine/` is **pure**: no React, no Supabase, no `fetch`, no `Date.now()`. Deterministic in, deterministic out. This is what makes it testable and is why the golden master works.
- `data/` is the only place that talks to Supabase.
- `components/` receive typed props. Server Components fetch; client components handle interaction.

---

## 5. Phases

### Phase 1 — Foundation (do this first, ship it before anything else)

1. **Port `reference/engine.js` → TypeScript.** ~265 lines, pure functions, zero dependencies. It already uses `module.exports`, so the shape carries over directly. Add real types: `Transaction`, `Category`, `Segment`, `Aggregate`, `FixedExpense`, `Paycheck`.
2. **Write Vitest tests against `fixtures/golden-master.json`.** Load the fixture CSV + config, run your engine, assert every total matches. **This is the acceptance gate for Phase 1.**
3. **Apply `SCHEMA.sql`** (review it first — it's a starting point, adapt to Nido's conventions for `family_id`, timestamps, naming).
4. **Build the CSV import route.** `POST /finance/import` → parse with the engine → upsert on `dedupe_key`. Must be idempotent: importing the same file twice changes nothing, and it must never delete `source='manual'` rows.
5. **Seed the complete dataset** (see §3a). A seed script loads `fixtures/transactions.csv` (with the 4 manual rows marked `source='manual'`), all of `config.json` — 9 fixed bills with schedules, 14 paychecks with provenance, 6 recurring + 3 one-off income items — and the category rules from `reference/engine.js` into `finance_category_rules` **preserving rule order**.
6. **Read-only P&L view.** Months as columns, categories as rows, segment subtotals, income section, net row, one-off toggles, and drill-downs (`VIEWS.md` §3).

**Done when — all five must hold:**
- golden-master tests pass, every value
- importing `fixtures/transactions.csv` twice produces 617 rows, not 1,234
- re-importing does not delete the 4 manual rows
- the P&L matches `reference/dashboard.html` cell for cell
- a second family cannot read family one's rows (RLS test)

### Phase 2 — Interactivity
Budget editing, one-off include/exclude toggles, merchant re-tagging, fixed-bill and income editors, remaining views (`VIEWS.md` §§4–9). All `localStorage` state moves to Postgres, family-scoped — mapping table at the end of `VIEWS.md`.

**Preserve these behaviours** (each exists for a reason, all documented):
- Re-tagging a merchant applies to **all** its transactions, past and future
- Lumpy categories (Investments) are held flat in projections, not annualized
- Fixed categories never flag as overspending
- Partial months are paced before budget comparison, and excluded from averages
- Paycheck provenance badges (`verified` / `derived` / `est.`) stay visible

### Phase 3 — Nido-native
- **CFO note agent** — the Overview narrative is currently hand-written prose. Make it a real agent alongside your weather/ages/balance agents. **Send it aggregates only** (category totals, monthly nets, trends) — never raw transaction rows. `DECISIONS.md §7` describes the insight it should be able to reach unaided: structural position is healthy, the deficit is five discrete one-off decisions.
- **Spanish localization** via next-intl. Category names are user-facing strings; see §7.
- **Overspend push notifications** via your existing Web Push setup.
- **Answer the 6 open questions** in `DECISIONS.md §8` — surface them in the UI as "needs confirmation" prompts rather than letting them decay into silent inaccuracies.
- *(Optional)* trailing-12-month trend view using `fixtures/history-2025.csv` — the one legitimate use of the 2025 data.

---

## 6. Domain rules that are easy to get wrong

These were all learned by debugging real bank exports. Violating any of them silently corrupts the numbers.

| Rule | Why |
|---|---|
| **Declined rows are excluded from all spend.** | Banks include declined attempts, often duplicated. There's a declined $5,435.41 Apmex retry AND a posted one — counting both doubles a major purchase. |
| **Re-imports supersede, they don't append.** | A new export re-states earlier months with `Pending` rows now `Posted`. Upsert on `dedupe_key`, never blind-insert. |
| **`dedupe_key` = hash(date, amount, merchant, status, type).** | Legitimate same-day identical charges exist, so the key must include enough fields. Two genuinely-identical declined retries in the fixture are expected and harmless. |
| **Refunds net against purchases within their category.** | Type=`Refund` rows carry negative amounts and simply sum in. A $554.52 grocery buy with −$295 and −$41 reimbursements nets to $218.52. |
| **`Payment` and `Other` are NOT spend.** | Card payments are transfers; points/statement credits are adjustments. Both are excluded from spend and shown as a memo. |
| **Fixed bills are synthetic transactions.** | Mortgage, HOA, utilities etc. never touch the card. They're injected per month, one row each, flagged `isFixed`. |
| **A `schedule` value of `0` skips that month entirely.** | This is how a bill is paused — e.g. the student loan is paused Jun+Jul. `null`/absent means "fall back to the base `amount`". |
| **Partial months are excluded from averages and projections.** | Otherwise a month-to-date figure drags every average down. Detect via max transaction date; a month is partial if it's the latest and the day < 28. |
| **Money is `numeric(12,2)`. Never float.** | Non-negotiable. |
| **Dates are calendar dates, not timestamps.** | Use `date`, not `timestamptz`. A transaction on the 31st must not become the 30th in another timezone. |
| **Manual adjustments must survive re-import.** | Some rows don't exist in any bank export (shared-purchase reimbursements, cash spend). They're kept separately and re-applied on every import — see `fixtures/transactions.csv`, rows tagged "added manually". Model this as a `source` column (`import` vs `manual`) and never delete `manual` rows during import. |
| **Excluding a purchase must also exclude its linked refunds.** | Otherwise excluding a $554.52 charge leaves −$336 of orphaned credits behind, and the category goes negative. |

---

## 7. Non-negotiables

**RLS first.** Financial data. Write the policies before the queries, and write a test that asserts a second family cannot read family one's rows. Do not rely on the client passing the right `family_id`.

**Categories are user-facing strings.** They're currently hardcoded English constants in the engine (`'Dining & Takeout'`). Before you ship, make the category a stable **key** (`dining_takeout`) with next-intl handling display. Retrofitting this after data lands is painful — a migration over every row. Do it in Phase 1.

**Keep category rules in the database, not in code.** `finance_category_rules` is family-editable. The engine should accept rules as an argument rather than importing a constant — that's the one intentional signature change from the reference implementation.

**Charts need no library.** The reference uses hand-rolled SVG (donut, area, stacked bars, grouped bars with an overlay line, sparklines, heatmap). It ports to JSX nearly as-is and adds zero bundle weight. Don't reach for Recharts.

---

## 8. Design system

`reference/design-tokens.css` holds the full palette and type scale as CSS custom properties — warm paper/ink editorial styling, deliberately not a generic SaaS dashboard. Tailwind v4's `@theme` maps these almost 1:1.

Reconcile with Nido's existing look before going far. If Nido has its own tokens, keep Nido's and treat these as the finance-domain accent set. Note the reference is desktop-first with a fixed sidebar; **Nido should be mobile-first** — the tables need a card-based responsive treatment that doesn't exist yet.

---

## 9. Suggested first prompt to yourself

> Read BRIEF.md, DECISIONS.md and VIEWS.md, then open reference/dashboard.html in a
> browser. Port reference/engine.js to TypeScript at src/domains/finance/engine/, with
> categorization rules passed in as a parameter instead of a module constant. Write
> Vitest tests that load fixtures/transactions.csv + fixtures/config.json and assert the
> output matches every value in fixtures/golden-master.json. Don't touch the database or
> UI until those tests pass.

## 10. Document index

| File | Read when |
|---|---|
| `BRIEF.md` | first — architecture, phases, acceptance criteria |
| `DECISIONS.md` | **before touching `config.json` or any financial rule** |
| `VIEWS.md` | building any UI; full feature spec of all nine views |
| `SCHEMA.sql` | Phase 1 step 3 |
| `reference/paystub-summary.md` | when working on income |
| `fixtures/golden-master.json` | writing tests — this is the oracle |

If you change a documented assumption, **update `DECISIONS.md` in the same commit.** That file is the system of record for *why*, and it's only useful if it stays true.
