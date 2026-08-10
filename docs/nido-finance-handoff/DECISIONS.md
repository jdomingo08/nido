# Decision Ledger — every assumption baked into the data

**Read this before touching `fixtures/config.json`.** Every number in that file is here with its rationale, provenance, and confidence level. Without this document the config is a pile of magic numbers, and a future maintainer (human or agent) will "fix" something that was deliberate.

**Confidence key:**
`VERIFIED` — from a source document, reconciles exactly ·
`DERIVED` — computed from verified figures ·
`ESTIMATE` — reasonable assumption, should be replaced with actuals ·
`UNCONFIRMED` — needs a decision from Jorge

---

## 1. Data provenance

The household is Jorge Domingo + Chrissy Oquendo (both appear as cardholders), Doral FL. Daughter **Amelia** (Kid's Strong, swimming lessons). **Alberto Domingo** is a family member repaying loans.

### Import lineage

| Date | Export | Rows | Coverage | Action |
|---|---|---|---|---|
| 2026-06-01 | first export | 418 | Jan 2 – Jun 1 | initial load |
| 2026-06-11 | refresh | 451 | Jan 2 – Jun 11 | full replace |
| 2026-06-22 | refresh | 571 | **Oct 2025** – Jun 22 | full replace; 2025 tail scoped out |
| 2026-06-22 | *(May-only file)* | 86 | May only | **rejected** — identical to data already held; importing would have duplicated all of May |
| 2026-07-31 | current | 613 | Jan 1 – **Jul 31** | full replace → `fixtures/transactions.csv` |

**Every refresh was a full replace, never an append.** Each new export re-states prior months with `Pending` rows now `Posted`. Jan–May totals were verified unchanged to the cent on every single refresh — that check is the canary for a botched import.

**One export was rejected outright** (the May-only file) because it was a subset of data already held. Your import endpoint must handle this gracefully via `dedupe_key`; it should be a no-op, not 86 duplicate rows.

### Scope decision — 2026 only `DERIVED`

The 2026-06-22 export included Oct–Dec 2025. The dashboard filters to `month >= '2026-01'`.

**Why:** income, fixed bills, and paychecks are only modelled from 2026. Including 2025 months would show spending with no matching income and drag every average, projection and savings-rate calculation. The 2025 rows are preserved in `fixtures/history-2025.csv` — **do not silently include them in P&L aggregates.** They're useful for trailing-12-month trend views only, which is a deliberately separate feature.

---

## 2. Income model

The P&L is **net-basis** (take-home), not gross. This single choice drives several others below.

### Salary `VERIFIED` / `DERIVED`

Source: Entravision pay stub, pay date 2026-05-29 (period 05/16–05/31), in `reference/paystub-summary.md`.

- VP, Strategy & Programs · **semi-monthly**, 24 checks/year
- Per check: gross **$4,936.77**, taxes $696.37, deductions $583.71, **net $3,656.69**
- Stub YTD through 2026-05-31: gross $59,367.70 · net **$43,622.13** · incl. **$10,000 bonus**

Jan–May paychecks (10) were **reconstructed** from the stub's YTD totals: 10 × $3,656.69 = $36,566.90, plus bonus net $7,055.23 = **$43,622.13 exactly**. That reconciliation is the proof the reconstruction is right. The 2026-05-31 check is tagged `source: 'stub'` (verified); the other Jan–May are `'reconstructed'`.

**Jun + Jul paychecks are `source: 'projected'` `ESTIMATE`** — modelled at the same rate because no stubs were provided. Replace with actuals when available; if either month contained a raise or bonus, current figures are wrong.

### Bonus amortization `DERIVED` — changed twice, read carefully

$10,000 gross bonus. Its treatment changed three times:
1. Originally placed entirely in **January**
2. Then **split Jan/Feb** at Jorge's request
3. **Current: amortized evenly across all 12 months** so monthly P&L shows a smooth bonus line

**It is amortized NET ($587.94/mo), not gross ($833.33/mo).** Net bonus = $43,622.13 − (10 × $3,656.69) = **$7,055.23**; ÷ 12 = $587.94.

**Why net:** the entire income model is take-home. Amortizing the gross would overstate income by the tax portion (~$2,945/yr) and inflate the savings rate. Jorge was told this and did not object, but he asked for "$10,000 divided by twelve" — if someone later reads the config and sees $587.94 where they expected $833.33, **this is the reason. Do not change it without also switching the whole P&L to gross-basis.**

Implementation note: it lives in `recurringIncome` with `type: 'Bonus'`, not in `paychecks` — so it routes to the Bonus line while applying monthly.

**Consequence:** YTD income no longer equals the cash-basis stub figure ($43,622.13). That's expected on an accrual/smoothed basis.

### Other recurring income `VERIFIED` (amounts given directly by Jorge)

| Item | Amount/mo | Bucket |
|---|---|---|
| Alberto Domingo — car repayment | $261.12 | Other |
| Alberto Domingo — loan repayment | $173.33 | Other |
| Alberto Domingo — Verizon repayment | $36.18 | Other |
| Interest income — Robinhood | $276.00 | Interest |
| Interest income — Openbank | $161.00 | Interest |

The three Alberto items **replaced** a single earlier $284.38 line. Keep them separate — Jorge explicitly wanted the breakdown.

### One-off income `VERIFIED`

Three Robinhood credit-card cashback rewards in **July**: $22.44 + $26.72 + $84.19 = **$133.35**, booked as *Other income*.

The dictated amounts were ambiguous ("2244 plus another 2672 and eighty-four and nineteen cents"); one plausible reading was ~$4,900, which would have flipped July to a surplus. **Jorge confirmed these figures explicitly.** Booked as income rather than as a spending reduction — also his explicit choice.

---

## 3. Fixed monthly commitments

None of these appear on the credit card. All are injected as synthetic transactions, one per active month.

| Item | Amount | Category | Notes |
|---|---|---|---|
| Mortgage | $1,653.71 | Mortgage | `VERIFIED` flat |
| HOA — Costa del Sol | $1,000.00 | HOA | `VERIFIED` flat |
| FPL — electricity | schedule | Utilities | see below |
| Verizon | $238.00 | **Phone** | see below |
| Tesla car payment | $791.41 | Auto Loan | `VERIFIED` flat |
| Student loan — Dept. of Education | $520.47 | Student Loan | **paused Jun+Jul** |
| Kid's Strong | $159.00 | Kids & Activities | `VERIFIED` flat |
| Netflix | $22.00 | Subscriptions | from January |
| Amelia — swimming lessons | $80.00 | Kids & Activities | from July |

### FPL — real per-month actuals `VERIFIED`

Read from Jorge's FPL usage dashboard (a screenshot), 2026 months only:

```
Jan 213.41 · Feb 182.42 · Mar 213.77 · Apr 184.52 · May 269.47 · Jun 285.00 · Jul 335.00
```

Base `amount` is **$240.51** — the 7-month average, used only as a fallback for months with no actual yet. Recompute it when new bills arrive.

This is why the `schedule` mechanism exists at all. **FPL is trending sharply up (+84% Feb→Jul, summer AC).** Budget Aug at $340–360, not the average.

### Verizon lives in `Phone`, not `Utilities` `DERIVED`

Originally categorized as Utilities. Jorge noticed the Utilities line didn't match his FPL report — because it was FPL **+ Verizon**. Verizon was split into its own **Phone** category so **Utilities === FPL exactly**.

Both remain in the *Essential* segment, so totals were unaffected — it was a labelling fix, not a math fix. **Don't merge them back.**

### Student loan paused Jun + Jul `VERIFIED`

`schedule: {"2026-06": 0, "2026-07": 0}` — a `0` means skip the month entirely. Jan–May fall through to the $520.47 base.

Reason not stated (forbearance/deferment presumed). **`UNCONFIRMED`: whether it resumes in August.** If it does, clear those keys.

### Netflix $22/mo from January `VERIFIED`

Verified there are **no Netflix charges anywhere on the card** before adding — otherwise it would double-count. Card Subscriptions are Spotify/Apple/Peacock only.

### Amelia's swimming lessons — $80/mo from July `UNCONFIRMED`

Jorge said: *"Starting in August and for July make it eighty dollars."* That's ambiguous — lessons start in August, but July has an $80 charge.

**Current interpretation: $80/mo from July onward** (zeroed Jan–Jun). **Confirm August's amount** — it may differ if July was a prorate or deposit.

---

## 4. Manual transaction adjustments

Four rows in `fixtures/manual-adjustments.csv` exist in **no bank export**. They must be re-applied on every import and never deleted by an import job. Model as `source = 'manual'`.

| Date | Amount | Merchant | Why |
|---|---|---|---|
| 2026-06-20 | −$295.00 | Meat Club Market | Reimbursement from **Jose** for a shared group buy |
| 2026-06-20 | −$41.00 | Meat Club Market | Reimbursement from **JP** for the same |
| 2026-07-31 | +$197.00 | CVS | Pharmacy charge not on the card. `ESTIMATE` on date — Jorge said "in July", no day given |
| 2026-07-31 | +$150.00 | Hotel — Melbourne Beach | Hotel not on the card. `ESTIMATE` on date, same reason |

**Meat Club:** the June 20 purchase was $554.52; net of both credits it is **$218.52**. This is the canonical example of refund-netting and of the "excluding a purchase must also exclude its linked refunds" rule.

**`UNCONFIRMED`: possible double-count.** The $150 Melbourne Beach hotel may be the same stay as the *Element by Marriott Melbourne Oceanfront* $22.47 charge already on the card. Jorge was asked and hasn't confirmed. If they're the same stay, one should be removed.

---

## 5. Categorization

23 categories in 5 segments (Essential · Lifestyle · Business · Investment · Unassigned) plus 2 adjustment pseudo-categories. Full rule list in `reference/engine.js`.

**Rule ordering is load-bearing.** First match wins, so specific rules must precede general ones:
- `'uber eats'` → Dining **must** come before `'uber'` → Transportation
- `'apple.com'` before `'apple'`
- `'central park'`/`'parks broward'` → Entertainment before `'parking'`/`'parkin'` → Transportation

**Categories added over time as merchants appeared:** Travel (Airbnb/airlines/hotels), Pets (Bark Square), Phone (Verizon split), Taxes & Fees (Miami-Dade tax collector). Expect more.

**Business & Software** captures a side venture: Replit, Supabase, OpenAI, Bluehost, Facebook ads, Prodigi, Twilio, n8n, plus LLCs *Polsia Inc* and *Fabuloom LLC*. Kept in its own segment so it doesn't distort household lifestyle spending. `UNCONFIRMED`: whether this should eventually split into a separate business entity/book.

### Deliberately uncategorized `VERIFIED`

7 small merchants remain `Uncategorized` (~1% of spend): `2020 Ponce`, `Ana V. Hernandez,`, `Doral`, `Fly Buy`, `Pablo Repun Tango`, `THE ORIGINAL BIZZARR`, `USPS`, `Yarbou`.

These are genuinely ambiguous (opaque descriptors). **Left deliberately, not overlooked** — they're surfaced in the UI for Jorge to tag. Don't auto-assign them to make a number look tidier.

---

## 6. Known gaps

**The Robinhood credit card is not in the dashboard.** Only its *cashback* and *interest* are captured. Any spending on it is invisible, so total household expenses are understated by an unknown amount. Jorge was told; no export supplied yet. **This is the single largest accuracy gap** and the reason `finance_accounts` exists in the schema from day one.

**Card-only view of expenses.** Anything paid by cash, check, ACH, or another card is missing unless manually added.

**Savings rate is not a true savings rate.** It's (net income − tracked spending). It does not observe actual account balances or transfers to savings/investments.

---

## 7. Reference figures as of 2026-07-31

Full detail in `fixtures/golden-master.json`. Headline numbers:

```
YTD income          $61,796.00
YTD spend           $65,509.64
Net cash flow       −$3,713.64   (−6.0%)

Monthly net:  Jan +2,497.78 · Feb −4,124.68 · Mar +436.17 · Apr −299.98
              May +538.42 · Jun −1,273.09* · Jul −1,040.61*
              (*before the Jul manual adjustments; see golden-master for finals)

Fixed bills   $4,279/mo (Jul, incl. Netflix + swim, excl. paused student loan)
Take-home     $8,809/mo (salary + recurring other income)
```

**The story the data tells** — worth preserving, because it's the product's actual value:

Jorge's *recurring* finances are healthy. The full-year deficit is driven almost entirely by five discrete one-off decisions totalling **$8,947**: a $5,435 bullion purchase (Apmex, Feb) and **$3,294 of travel booked in June–July** (two Airbnbs, American Airlines). Excluding those five, YTD net is **+$5,876 — roughly a 10% savings rate**.

That distinction — *structural position vs. one-off decisions* — is why the P&L has include/exclude toggles, and it's the insight the CFO-note agent should be able to reach on its own.

---

## 8. Open questions for Jorge

1. **August swim lessons** — is it $80, or was July a prorate/deposit?
2. **Melbourne Beach hotel** — is the $150 manual entry the same stay as the $22.47 Element by Marriott card charge?
3. **Student loan** — does it resume in August?
4. **Robinhood card** — can an export be produced?
5. **Uncategorized merchants** — tag the remaining 7.
6. **CVS + hotel dates** — both defaulted to Jul 31; exact dates?

---

## 9. Port-time amendments (2026-08-10, Nido integration)

Documented deviations from BRIEF.md / SCHEMA.sql, made while porting into
Nido. None change any golden-master number.

### dedupe_key gains an occurrence index `VERIFIED`

BRIEF §6 defines `dedupe_key = hash(date, amount, merchant, status, type)`.
Checked against the fixture, that formula collides on **4 pairs** of rows —
three declined retry pairs (harmless) and one pair of **legitimate posted
charges**: two OpenAI $10.00 purchases on 2026-03-15. A unique upsert on the
documented key would silently collapse those into one row, drop $10 of real
Business & Software spend, and break the golden master after a DB round-trip.

Amended key: the plain composite string
`date|amount|merchant_lower|status|type|n`, where `n` is the 0-based
occurrence index of that tuple within the import file. Same file in → same
keys out, so re-imports stay idempotent; genuinely identical same-day rows
each keep a row. No hash — the composite is unique, shorter to debug, and
needs no crypto in the pure engine.

### Import supersedes by date range, not upsert alone `DERIVED`

Pure upsert cannot express "re-imports supersede" (§1): a Pending row
restated as Posted produces a *different* key (status is part of it), so the
stale Pending row would linger and double-count. The import instead:

1. upserts every incoming row on `(family_id, dedupe_key)`, then
2. deletes `source='import'` rows inside the file's `[min_date, max_date]`
   whose keys are absent from the file.

Consequences, all matching documented history: a full refresh replaces
restated months; the rejected May-only subset file (§1) becomes a graceful
no-op (every key already present, nothing deleted); `source='manual'` rows
are never touched; even an amount-changed restatement (pending pre-tip →
posted with tip) supersedes cleanly.

### Rules gain `match_type` (`substring`|`exact`) `DERIVED`

The reference engine special-cases merchant `UPS` in code (substring `ups`
would over-match, e.g. "cups"). Rules now live in `finance_category_rules`,
so that special case becomes a data row with `match_type='exact'` instead of
a hardcoded branch.

### Paycheck provenance is a column, not a boolean `DERIVED`

SCHEMA.sql modelled provenance as `is_estimate boolean`. The UI requires
`verified / derived / est.` badges (VIEWS.md §2) and §3a requires provenance
preserved, so `finance_income` stores
`source in ('stub','reconstructed','projected','manual')` plus a `detail`
jsonb for the verified stub's line items.

### Category identity is a stable key `DERIVED`

Per BRIEF §7, categories are stored as keys (`dining_takeout`), with
English/Spanish display names in `messages/{en,es}.json`. The golden-master
test asserts the English display names still match the reference spellings
exactly.
