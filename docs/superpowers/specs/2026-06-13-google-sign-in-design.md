# Google Sign-In — Design Spec

**Date:** 2026-06-13
**Status:** Approved
**Branch:** `feature/google-sign-in`

## Problem

The current login page (`src/app/login/page.tsx`) offers two equally-weighted, high-friction
options — email magic-link and email+password — with no social login. Signing in is
"complicated and hard." It also hardcodes English strings, violating the project's
i18n-only convention.

## Goal

Replace the two-tab login with a single, dead-simple **"Continue with Google"** flow,
using Supabase-managed Google OAuth via the standard redirect flow.

## Decisions (locked)

- **Google-only login page.** No email/password or magic-link UI on the login page.
- **Standard redirect OAuth**, not Google One-Tap (no iframe/CSP complications; works everywhere).
- **Invite-by-email path is preserved.** The `/auth/callback` `token_hash` branch stays, so
  family members invited via `auth.admin.inviteUserByEmail` can still accept via their email link.
  Only the *login page* becomes Google-only.
- **Existing email accounts:** Supabase auto-links identities by matching confirmed email, so a
  user whose account email equals their Google email signs in seamlessly. A user with a
  non-Google account email would be locked out — acceptable at this early stage, and email login
  can be re-added later (handlers removed from the page, not deleted from git history).

## What changes

### 1. Login page — `src/app/login/page.tsx`
- Single primary action: a styled "Continue with Google" button matching the existing
  neo-brutalist palette (`#F5ECDC` / `#16121A` / `#FF3D7F`, Archivo Black).
- Calls:
  ```ts
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}/auth/callback` }
  })
  ```
  The `@supabase/ssr` browser client uses PKCE; it auto-redirects to Google and returns to
  `/auth/callback?code=...`.
- Reads an `error` query param via `window.location` in a `useEffect` (avoids the Next 16
  `useSearchParams` Suspense requirement) and shows a friendly error banner. The callback already
  redirects to `/login?error=auth` on failure.
- All strings come from a new `auth` i18n namespace.

### 2. i18n — `messages/en.json`, `messages/es.json`
Add an `auth` namespace: `continueWithGoogle`, `signingIn`, `error`, plus a short subtitle.

### 3. Backend — no code changes
- `src/app/auth/callback/route.ts` already exchanges `?code=` via `exchangeCodeForSession`.
- `src/app/page.tsx` already routes auth+no-family users to `/onboarding`, so new Google users
  are onboarded automatically.
- CSP (`src/lib/security/headers.ts`): `form-action 'self'` does not restrict top-level redirects,
  so OAuth navigation is not blocked. No change needed.

## External setup (manual, guided)

### Google Cloud Console
1. Create/select a project (e.g. "Nido").
2. OAuth consent screen: **External**, scopes `email` / `profile` / `openid`, then **Publish**
   (so sign-in is not limited to test users).
3. Create **Web application** OAuth client.
4. **Authorized redirect URI:** `https://xbovkmlxuppiwhfvpwth.supabase.co/auth/v1/callback`
5. Copy **Client ID** + **Client Secret**.

### Supabase dashboard
1. Authentication → Providers → **Google** → enable; paste Client ID + Secret.
2. Authentication → URL Configuration:
   - **Site URL:** production URL.
   - **Redirect URLs (allowlist):** `http://localhost:3000/auth/callback` and the production
     `https://<nido>.vercel.app/auth/callback`.

## Testing

- Unit test (`tests/`): mock the Supabase browser client; assert the Google button renders, that
  clicking it calls `signInWithOAuth` with `provider: 'google'` and the correct `redirectTo`, and
  that an `?error=auth` URL renders the error banner.
- Manual: run locally, complete the real Google round-trip after dashboard config; confirm a new
  user lands on `/onboarding` and an existing-family user lands on `/dashboard`.

## Out of scope

Google One-Tap, Apple sign-in, deleting email/password code from the codebase, custom production
domain, re-adding an email fallback hatch.
