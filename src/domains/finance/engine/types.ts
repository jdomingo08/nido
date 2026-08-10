// Finance engine types. The engine is pure: no React, no Supabase, no fetch,
// no Date.now(). Deterministic in, deterministic out — this is what makes the
// golden-master fixture (docs/nido-finance-handoff/fixtures/golden-master.json)
// a usable test oracle.

export type Segment =
  | 'essential'
  | 'lifestyle'
  | 'business'
  | 'investment'
  | 'unassigned'
  | 'adjustments'

export type CategoryKey =
  | 'dining_takeout'
  | 'groceries_household'
  | 'shopping_retail'
  | 'business_software'
  | 'investments'
  | 'insurance'
  | 'personal_care_beauty'
  | 'health_medical'
  | 'entertainment_recreation'
  | 'transportation_auto'
  | 'subscriptions'
  | 'travel'
  | 'pets'
  | 'taxes_fees'
  | 'housing_home'
  | 'mortgage'
  | 'hoa'
  | 'utilities'
  | 'phone'
  | 'auto_loan'
  | 'student_loan'
  | 'kids_activities'
  | 'uncategorized'
  | 'credits_rewards'
  | 'card_payment'

// A raw CSV row keyed by header name (Date, Time, Cardholder, Amount, …).
export type RawRecord = Record<string, string>

export interface Transaction {
  date: string // 'YYYY-MM-DD' — calendar date, never a timestamp
  month: string // 'YYYY-MM'
  time: string
  cardholder: string
  amount: number // positive = money out, negative = money in
  points: number
  status: string // Posted | Pending | Declined | Recurring
  type: string // Purchase | Refund | Payment | Other | Fixed
  merchant: string
  description: string
  category: CategoryKey
  segment: Segment
  declined: boolean
  isSpend: boolean
  isFixed?: boolean
  fxId?: string
}

// Categorization rule. Rules are family-editable rows in the database and are
// passed to the engine as an argument — the one intentional signature change
// from the reference implementation. Order is load-bearing: first match wins,
// so specific rules ('uber eats' → dining) must precede broad ones ('uber').
// `exact: true` matches the trimmed merchant name case-insensitively as a
// whole (needed for 'UPS', where substring 'ups' would over-match).
export interface CategoryRule {
  match: string // lowercase substring (or exact merchant when exact: true)
  category: CategoryKey
  exact?: boolean
}

// merchant key (lower/trim) → category. Overrides beat every rule.
export type MerchantOverrides = Record<string, CategoryKey>

// Fixed monthly commitment (mortgage, HOA, …). Never on the card; injected as
// one synthetic transaction per active month.
// schedule semantics: value present → use it; 0 → SKIP the month entirely
// (paused); month absent → fall back to `amount`.
export interface FixedExpense {
  id: string
  name: string
  amount: number
  category: CategoryKey
  schedule?: Record<string, number>
}

export type PaycheckSource = 'stub' | 'reconstructed' | 'projected' | 'manual'

export interface Paycheck {
  id: string
  payDate: string // 'YYYY-MM-DD'
  periodStart?: string
  periodEnd?: string
  gross: number
  taxes: number
  deductions: number
  net: number
  bonus: number // non-zero routes the check to the bonus bucket
  type: string
  source: PaycheckSource
  detail?: Record<string, number>
}

// `type` routes buckets by substring: 'bonus' → bonus, 'interest' → interest,
// anything else → other. Matches the reference implementation.
export interface RecurringIncome {
  id: string
  name: string
  amount: number
  type: string
}

export interface OneOffIncome {
  id: string
  month: string // 'YYYY-MM'
  name: string
  amount: number
  type: string
}

export interface Aggregate {
  spend: Transaction[]
  months: string[]
  completeMonths: string[]
  partialMonth: string | null
  currentMonth: string
  maxDate: string
  maxDay: number
  catTotals: Partial<Record<CategoryKey, number>>
  segTotals: Partial<Record<Segment, number>>
  monthTotals: Record<string, number>
  catMonth: Partial<Record<CategoryKey, Record<string, number>>>
  segMonth: Partial<Record<Segment, Record<string, number>>>
  txnCountMonth: Record<string, number>
  merchantTotals: Record<string, number>
  merchantMeta: Record<string, { count: number; category: CategoryKey }>
  payByMonth: Record<string, number>
  credByMonth: Record<string, number>
  total: number
}

// A large single purchase (≥ threshold) that can be toggled in/out of the
// books. Excluding it also excludes its linked refunds (same merchant+date) —
// otherwise the reimbursements orphan and the category goes negative.
export interface OneOffCandidate {
  id: string // date|amount|merchant
  date: string
  merchant: string
  amount: number
  category: CategoryKey
  month: string
  linked: Transaction[]
  linkedTotal: number
  net: number
}

export interface LinearFit {
  m: number
  b: number
  predict: (x: number) => number
}

export interface DashboardInput {
  csvText?: string
  // Pre-parsed rows (e.g. loaded from the database) — takes precedence over
  // csvText when provided.
  records?: RawRecord[]
  rules: CategoryRule[]
  overrides?: MerchantOverrides
  excludedOneOffIds?: string[]
  paychecks?: Paycheck[]
  recurringIncome?: RecurringIncome[]
  fixedExpenses?: FixedExpense[]
  oneOffIncome?: OneOffIncome[]
  scopeStart?: string // e.g. '2026-01' — drop rows from earlier months
  oneOffMin?: number // default 500
}

export interface DashboardModel {
  // parsing / provenance
  totalRowsParsed: number
  rowsInScope: number
  declinedExcluded: number

  // card + fixed transactions, post exclusion filtering
  transactions: Transaction[]
  agg: Aggregate
  cardAgg: Aggregate

  // one-off toggles
  oneOffs: OneOffCandidate[]
  excludedTotal: number
  excludedCount: number

  // spend analytics over complete months
  cats: CategoryKey[]
  avgCat: Partial<Record<CategoryKey, number>>
  avgSeg: Partial<Record<Segment, number>>
  avgMonthly: number
  completeTotals: number[]
  trend: LinearFit
  latestComplete: string | undefined
  priorComplete: string | undefined
  activeMonths: string[]
  fixedMonths: string[]

  // income model
  incNetMonth: Record<string, number>
  incGrossMonth: Record<string, number>
  incTaxMonth: Record<string, number>
  incDedMonth: Record<string, number>
  incSalaryMonth: Record<string, number>
  incBonusMonth: Record<string, number>
  incOtherMonth: Record<string, number>
  incInterestMonth: Record<string, number>
  incMonths: string[]
  incNetTotal: number
  salaryYTD: number
  bonusYTD: number
  otherYTD: number
  interestYTD: number
  recurMonthly: number
  oneOffIncTotal: number
  fixedMonthly: number

  // headline
  overlap: string[]
  spendOverlap: number
  ytdNetCash: number
  savingsRate: number
}
