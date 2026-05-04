# Fix password-reset redirect (homepage instead of `/reset-password`)

**Agent:** `/project:backend-developer` (route handler is server-side; no UI change). Hand off to `/project:tester` for the route handler test, then `/project:code-reviewer`.
**Branch to create:** `fix/password-reset-redirect` from latest `main`.
**Type:** Bugfix. One new file (`src/app/auth/callback/route.ts`), one modified file (`src/app/(auth)/actions.ts`), one new test file. **Plus** two manual config steps the user does in Vercel + Supabase dashboards — these are not code changes but the fix doesn't work end-to-end without them.

**Origin:** 2026-05-04 user report — password-reset email link drops users on the homepage instead of `/reset-password`. Diagnosed in conversation with the user.

---

## Why this is happening (read before touching code)

Three independent problems combined. All three need fixing for the flow to work end-to-end. Two are dashboard config (the user does these); one is a code change (this prompt).

A real reset email captured for diagnosis contained:

```
https://omabvqhvcdzngeiriiii.supabase.co/auth/v1/verify
  ?token=pkce_8241688c…
  &type=recovery
  &redirect_to=https://the-social-seen.vercel.app/
```

Note `redirect_to` is just `/`, not `/reset-password`, and the host is the Vercel auto-domain rather than the production custom domain (`the-social-seen.com`).

### Problem 1 (dashboard) — Supabase URL Configuration

User-confirmed current state in Supabase dashboard → Authentication → URL Configuration:

- **Site URL:** `https://the-social-seen.vercel.app/`
- **Redirect URLs:** empty

With an empty allow list, Supabase rejects every `redirectTo` the SDK sends and silently substitutes the Site URL. That's why the email landed on the homepage.

### Problem 2 (env var) — `NEXT_PUBLIC_SITE_URL` not set in Vercel prod

`src/app/(auth)/actions.ts:325-329` builds `origin` via `NEXT_PUBLIC_SITE_URL ?? NEXT_PUBLIC_VERCEL_URL ?? localhost`. In Vercel production `NEXT_PUBLIC_SITE_URL` is unset, so the code falls through to `NEXT_PUBLIC_VERCEL_URL`, which is the auto-assigned `the-social-seen.vercel.app`. Real prod is `the-social-seen.com`.

### Problem 3 (code, this prompt's job) — no `/auth/callback` route

`@supabase/ssr` uses the PKCE flow. Once Problems 1+2 are fixed, the recovery link will land at `https://the-social-seen.com/reset-password?code=…`. To establish the recovery session, the app must call `supabase.auth.exchangeCodeForSession(code)` on a server route, then redirect to the page that lets the user set a new password. **No such route exists** — `find src/app -name "route.*"` returns only Sentry/Stripe/cron handlers. So even with Problems 1+2 fixed, `updatePassword` would still fail because there's no recovery session.

The fix is:
1. Add `src/app/auth/callback/route.ts` — exchanges the PKCE code, then redirects to a safe `next` path.
2. Update `src/app/(auth)/actions.ts:332` to send `redirectTo: ${origin}/auth/callback?next=/reset-password` instead of `${origin}/reset-password`.
3. Tighten the env fallback chain so production fails loud / logs a warning when `NEXT_PUBLIC_SITE_URL` is missing — local dev keeps the localhost fallback.

---

## Required dashboard config (the user must do these — call out in PR description)

These are not code changes. The PR description must list them under a **Required dashboard config** section so it's obvious the merge alone doesn't fix the bug.

### A. Vercel → Project Settings → Environment Variables (Production)

- Add `NEXT_PUBLIC_SITE_URL=https://the-social-seen.com`.
- Redeploy after saving.

### B. Supabase Dashboard → Authentication → URL Configuration

- **Site URL:** change from `https://the-social-seen.vercel.app/` to `https://the-social-seen.com`.
- **Redirect URLs:** add (one per line):
  ```
  https://the-social-seen.com/reset-password
  https://the-social-seen.com/auth/callback
  http://localhost:3000/reset-password
  http://localhost:3000/auth/callback
  ```
  Optional, only if Vercel preview deploys need to test the flow:
  ```
  https://*.vercel.app/reset-password
  https://*.vercel.app/auth/callback
  ```

---

## Code tasks

### 1. New file: `src/app/auth/callback/route.ts`

Path matters — **must NOT be inside the `(auth)` route group** (`src/app/(auth)/`), because route groups don't appear in the URL. Place it at `src/app/auth/callback/route.ts` so it's served at `/auth/callback`.

Behaviour:

- Export an async `GET(request: Request)` handler.
- Read `code` and `next` from `URL(request.url).searchParams`.
- Sanitise `next` with `sanitizeRedirectPath(next, '/reset-password')` from `@/lib/utils/redirect`. **Default fallback for this route is `/reset-password`** — it overrides the helper's default of `/events` because this route is reached only after a recovery link, where the natural destination is the password reset page. Pass the fallback explicitly.
- If `code` is missing → 302 redirect to `/forgot-password?error=expired_link`. (No code on the URL means the user clicked a malformed link or hit `/auth/callback` directly.)
- If `code` present:
  - Build a server client via `createServerClient()` from `@/lib/supabase/server`.
  - Call `await supabase.auth.exchangeCodeForSession(code)`.
  - On success → 302 redirect to the sanitised `next` path (using `new URL(next, url.origin)` so it's an absolute URL — `NextResponse.redirect` requires that).
  - On failure (returns `{ error }` or throws) → 302 redirect to `/forgot-password?error=expired_link`. The existing `/forgot-password` page should treat this as "your link expired, request a new one"; the existing `linkExpired` UI inside `reset-password-form.tsx` is a separate path used after `updatePassword` fails, not this one. **Do not** alter `reset-password-form.tsx` — the error UI lives on `/forgot-password` for the pre-session-exchange failure mode.
- Use `NextResponse.redirect(...)` from `next/server`.

Implementation sketch (executor: do not paste verbatim, write idiomatic code that matches the project's style — but the shape is this):

```ts
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { sanitizeRedirectPath } from '@/lib/utils/redirect'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = sanitizeRedirectPath(url.searchParams.get('next'), '/reset-password')

  if (!code) {
    return NextResponse.redirect(new URL('/forgot-password?error=expired_link', url.origin))
  }

  const supabase = await createServerClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL('/forgot-password?error=expired_link', url.origin))
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
```

Add a short top-of-file comment block (kept tight per CLAUDE.md style) explaining: this is the PKCE exchange handler for password-recovery (and any future OAuth) flows; `redirectTo` in `resetPasswordForEmail` points here, not `/reset-password` directly.

### 2. Modify: `src/app/(auth)/actions.ts` — `requestPasswordReset` (lines ~310-337)

- Change line 332 from:
  ```ts
  redirectTo: `${origin}/reset-password`,
  ```
  to:
  ```ts
  redirectTo: `${origin}/auth/callback?next=/reset-password`,
  ```
- Update the JSDoc comment on the function (lines ~299-310) so the "reset link points to the URL configured in Supabase Auth → URL Configuration → Redirect URLs" sentence reflects that the link now goes through `/auth/callback`. Keep it concise — one or two lines.

### 3. Modify: `src/app/(auth)/actions.ts` — env fallback chain (lines ~322-329)

Currently the fallback silently uses `NEXT_PUBLIC_VERCEL_URL` (the auto-assigned Vercel hostname) when `NEXT_PUBLIC_SITE_URL` is missing. That is what masked the bug — production silently used the wrong domain.

Change the behaviour so:

- In production (`process.env.NODE_ENV === 'production'`), if `NEXT_PUBLIC_SITE_URL` is missing, log a server-side `console.warn` warning. Do **not** throw — that would take down password reset entirely. The fallback to `NEXT_PUBLIC_VERCEL_URL` should remain so the function still returns rather than 500ing if the env var is forgotten on a future deploy, but the warning makes the misconfiguration visible in Vercel logs.
- In dev (`NODE_ENV !== 'production'`), keep the existing behaviour silently — `localhost:3000` fallback is fine for local work.

Add a one-line comment (per CLAUDE.md "default to no comments; only when WHY is non-obvious") explaining: warning fires because reliance on `NEXT_PUBLIC_VERCEL_URL` produces the auto-domain, which won't be on Supabase's allow list and silently breaks reset emails.

---

## Tests

Add `src/app/auth/callback/__tests__/route.test.ts` (Vitest). Mirror the structure used by `src/app/api/admin/cron/reap-stale-bookings/__tests__/route.test.ts` for mocking `createServerClient`.

Cases:

1. **No `code` param** → response is a 302 redirect with `Location` containing `/forgot-password?error=expired_link`.
2. **Valid `code`, exchange succeeds, no `next` param** → response is a 302 redirect to `/reset-password` (the explicit fallback).
3. **Valid `code`, exchange succeeds, safe `next=/profile`** → response is a 302 redirect to `/profile`. (Confirms `next` honoured when safe.)
4. **Valid `code`, exchange succeeds, malicious `next=https://evil.com`** → response is a 302 redirect to `/reset-password` (the fallback) — confirms `sanitizeRedirectPath` rejects the absolute URL.
5. **Valid `code`, exchange returns `{ error: ... }`** → response is a 302 redirect to `/forgot-password?error=expired_link`.

Mock `@/lib/supabase/server`'s `createServerClient` to return an object whose `auth.exchangeCodeForSession` returns the fixture for each case. No real Supabase calls.

Do **not** add a Playwright E2E here — the recovery flow can't be exercised without a real Supabase recovery email. Document this gap in the test file's top comment so a future contributor knows it's deliberate.

---

## Verification before reporting done

1. `pnpm tsc --noEmit` — clean.
2. `pnpm lint` — clean.
3. `pnpm test src/app/auth/callback` — all five cases pass.
4. `pnpm test src/app/\(auth\)/__tests__` — existing `reset-password-form.test.tsx` and `forgot-password-form.test.tsx` still pass (no behaviour change to those files, but `actions.ts` JSDoc edit is in their dependency tree).
5. `pnpm build` — succeeds. New route handler appears in the build manifest.
6. Local manual test of the *redirect string* shape only: in a Server Action playground (or a unit test), call `requestPasswordReset({ email: 'someone@example.com' })` with `NEXT_PUBLIC_SITE_URL=http://localhost:3000` set, then read the Supabase mock to confirm `redirectTo` is `http://localhost:3000/auth/callback?next=/reset-password`. The end-to-end email + click flow can only be validated post-merge after the user completes Required Dashboard Config A and B.

---

## What this PR does NOT do (out of scope, intentional)

- **Does not change `reset-password-form.tsx`.** The `linkExpired` state in that file is triggered by `updatePassword` returning an "expired" error mid-form; the new `auth/callback` route handles a different failure mode (code never exchanged) and routes to `/forgot-password?error=expired_link` for that.
- **Does not modify `/forgot-password` to render anything different when `?error=expired_link` is present.** That's a follow-up if we want a friendlier message — for now the user just sees the standard "request a reset link" form, which is the correct next action.
- **Does not add OAuth or social login** even though `/auth/callback` is the canonical home for those when added later. The handler is named generically so it can absorb that flow later, but the only consumer today is password recovery.
- **Does not refactor the `origin` derivation into a shared util.** It's used in one place (`requestPasswordReset`); a util is premature.
- **Does not change cookie / `httpOnly` settings** on `createServerClient`. Out of scope.

---

## Done checklist (executor pastes this filled in to the handover)

- [ ] Branch `fix/password-reset-redirect` created from `main`.
- [ ] `src/app/auth/callback/route.ts` created and follows the spec above.
- [ ] `src/app/(auth)/actions.ts` line 332 updated to point at `/auth/callback?next=/reset-password`.
- [ ] `src/app/(auth)/actions.ts` env fallback emits a `console.warn` in production when `NEXT_PUBLIC_SITE_URL` is missing.
- [ ] JSDoc on `requestPasswordReset` updated to reflect the new redirect path.
- [ ] `src/app/auth/callback/__tests__/route.test.ts` created with all five cases passing.
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` succeeds.
- [ ] PR description includes a **Required dashboard config** section listing Vercel env var + Supabase Site URL + Redirect URLs entries the user must apply before testing in prod.
- [ ] Conventional commit: `fix(auth): exchange PKCE code on /auth/callback so password reset establishes recovery session`.
