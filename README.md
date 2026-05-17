# Needle

A multi-agent weekly activity planner for families with young kids.

> Six cooperating LLM agents (weather, ages, methodology, balance, history, materials) propose age-appropriate activities for each kid, each day. A caregiver swipes through them. A balance dashboard keeps the week well-rounded.

See [`docs/implementation-plan-v0.2.md`](./docs/implementation-plan-v0.2.md) for the full product + technical spec.

---

## Stack

- **Next.js 16** (App Router) on **Vercel**
- **Supabase** Postgres (us-east-1) — auth, RLS, pgvector
- **OpenAI** — `gpt-4o-mini` (cheap paths) + `gpt-4o` (orchestrator/hydrate)
- **next-intl** for EN/ES localization (no mixed strings)
- **Vitest** + Testing Library for unit/integration tests
- **Upstash Redis** for rate limiting
- **Web Push** (VAPID) for per-activity reminders

## Local setup

```bash
# 1. Clone, install
npm install

# 2. Configure env
cp .env.example .env.local
# Fill in real values — see "What you need" below.

# 3. Generate VAPID keys for web push (one-time)
npx web-push generate-vapid-keys

# 4. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What you need (external accounts)

| Service | Purpose | Variables |
|---|---|---|
| [Supabase](https://supabase.com) | Database + Auth | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| [OpenAI](https://platform.openai.com) | LLM + embeddings | `OPENAI_API_KEY` |
| [Upstash](https://upstash.com) | Rate limiting | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| [OpenWeatherMap](https://openweathermap.org/api) | Weather agent | `OPENWEATHER_API_KEY` |
| [Vercel](https://vercel.com) | Hosting + cron | (set via `vercel link`) |
| [Plaid](https://dashboard.plaid.com) | Bank + card aggregation (Finances) | `PLAID_CLIENT_ID`, `PLAID_SECRET_SANDBOX`, `PLAID_ENV`, `PLAID_PRODUCTS`, `PLAID_COUNTRY_CODES`, `FINANCES_ENCRYPTION_KEY` |
| [Sentry](https://sentry.io) (optional) | Error tracking | `NEXT_PUBLIC_SENTRY_DSN` etc. |

## Scripts

```bash
npm run dev            # dev server
npm run build          # production build
npm run start          # production server
npm run lint           # ESLint
npm run type-check     # tsc --noEmit
npm run test           # Vitest, single run
npm run test:watch     # Vitest, watch mode
npm run test:coverage  # Vitest with coverage report
npm run format         # Prettier write
npm run format:check   # Prettier check
```

## Project layout

```
src/
  app/                     # Next.js App Router
  domains/                 # DDD bounded contexts
    family/                #   household, adults, kids, preferences
    library/               #   activity templates, retrieval
    planning/              #   orchestrator, week plans, balance
    activities/            #   proposed/approved/dismissed lifecycle
    history/               #   completion tracking, evening nudge
    notifications/         #   push, reminders
    admin/                 #   cost ledger, review queue, overrides
  lib/
    supabase/              # SSR + browser + admin clients
    openai/                # OpenAI client + model constants
    i18n/                  # next-intl config + request helper
    security/              # CSP/CORS/security headers
    validation/            # Zod schemas (TBD)
  components/              # shared UI atoms
  middleware.ts            # security headers + locale cookie
messages/                  # en.json, es.json (UI chrome only)
supabase/migrations/       # SQL migrations (TBD)
tests/
  unit/
  integration/
docs/
  implementation-plan-v0.2.md
config/                    # build-time configs (TBD)
scripts/                   # one-off scripts (TBD)
```

## Conventions

- Files under 500 lines; prefer many small files.
- DDD: business logic lives in `src/domains/<context>`; each context has `server/` (server-only) and `client/` (browser-safe) splits.
- TDD where it pays — write tests for orchestrator logic, validators, retrieval ranking. Visual regression for screens.
- 80%+ coverage target.
- All UI strings come from `messages/*.json`. No hardcoded English in components.
- All DB tables have RLS enabled with `family_id`-scoped policies.
- OpenAI key never reaches the client bundle — server routes only.

## Status

**Phase 0 — Infra & scaffolding.** Complete.
Next up: Phase 1 — Auth + family model + onboarding.

**Phase F1 — Finances foundation.** Entity model + Plaid Link end-to-end (sandbox). Next: F2 transactions sync.

See `docs/implementation-plan-v0.2.md` §14 for the full phase plan.
