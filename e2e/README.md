# E2E suite — Playwright + local Supabase

RPC-focused end-to-end tests for the booking pipeline. Automates the
12 scenarios documented in `docs/BOOKING-RPCS-TEST-PLAN.md`, plus one
integration test for the `daily-notifications` edge function.

## What it covers

Two Playwright projects:

### `rpc` — direct PostgREST hits (no browser)

| File | Scope |
|---|---|
| `booking-rpcs.spec.ts` | 12 scenarios for `book_event`, `book_event_paid`, `claim_waitlist_spot` — verification gate, active-status gate, capacity, waitlist, concurrency race, cancelled/deleted events. |
| `daily-notifications.spec.ts` | Seeds an event 6 days out with a confirmed attendee, invokes the edge function, asserts the venue-reveal `notifications` row lands with the right `template_name` + `dedupe_key`. |

Each spec calls Postgres RPCs directly via PostgREST using a user JWT
(so `auth.uid()` enforcement runs as it would in production).

### `ui` — chromium-driven Next.js dev server (CL-7)

| File | Scope |
|---|---|
| `ui/auth.spec.ts` | (1) Register happy path → 3-step form → profile row exists with correct consent flags. (2) Register duplicate email → "already a member" + sign-in link surfaces. (3) Login + OTP verify → seeded user signs in, OTP read from Inbucket, typed back, `profiles.email_verified` flips true. |

The `ui` project starts the Next.js dev server automatically via
Playwright's `webServer` config. Tests run after the server is up.

## Local prerequisites

1. **Docker Desktop** running (Supabase CLI needs it for the local stack).
2. **Supabase CLI** — `brew install supabase/tap/supabase` (macOS) or see <https://supabase.com/docs/guides/cli>.

## Run locally

```bash
# Terminal 1 — start the local Supabase stack (DB, Auth, Storage,
# Inbucket mail catcher, etc.)
supabase start

# Terminal 2 (optional) — serve the edge function so the
# daily-notifications spec runs. Without this, that spec auto-skips
# with a clear diagnostic.
supabase functions serve daily-notifications

# Terminal 3 — run the suite. The ui project auto-boots `pnpm dev`
# on port 6500; the rpc project doesn't need it.
pnpm e2e                       # both projects
pnpm e2e --project=rpc         # rpc only
pnpm e2e --project=ui          # ui only
pnpm e2e:ui                    # interactive Playwright UI mode
```

Tests run serially (`workers: 1`) because they mutate shared tables.

### Inbucket — Supabase's local mail catcher

The `ui` auth spec reads the OTP email out of Inbucket (Supabase's
built-in dev-only SMTP receiver). Inbucket is part of the default
`supabase start` stack on port `54324`. When `--exclude inbucket`
is set the OTP scenario auto-skips with a clear error.

## Safety guards

- `e2e/helpers/supabase.ts` refuses to run against any `*.supabase.co`
  URL. E2E is destructive (it seeds and deletes rows) — it must never
  touch a hosted project.
- Every row created in a run is tagged with a unique `e2e-<runId>-`
  prefix on `email` + `slug`. Teardown sweeps those only.

## Environment variables (all optional)

All default to the well-known local-dev values baked into the
Supabase CLI. Override only if you're running against a disposable
staging project explicitly dedicated to E2E.

| Var | Default |
|---|---|
| `SUPABASE_E2E_URL` | `http://127.0.0.1:54321` |
| `SUPABASE_E2E_ANON_KEY` | local-dev anon key (hardcoded fallback) |
| `SUPABASE_E2E_SERVICE_ROLE_KEY` | local-dev service-role key (hardcoded fallback) |
| `INBUCKET_URL` | `http://127.0.0.1:54324` |
| `E2E_BASE_URL` | `http://127.0.0.1:6500` (Next.js dev server for `ui` project) |

## CI

The GitHub Actions `e2e` job (`.github/workflows/ci.yml`) runs after
the main `ci` job succeeds. It:

1. Installs pnpm deps + the Supabase CLI.
2. Runs `supabase start` (excludes Studio / Inbucket / Realtime /
   Imgproxy / Edge-Runtime to trim boot time; the core DB + Auth
   are what we need).
3. Runs `pnpm e2e`.
4. Uploads the Playwright HTML report as an artifact on failure.

Failures in this job fail the overall CI run.

## Extending the suite

- New RPC or booking-invariant test → add to `booking-rpcs.spec.ts`.
- New edge-function test → new file in `e2e/`, follow the
  `isFunctionReachable()` pattern so the test skips with a clear
  message when the function server isn't running locally.
- Fixtures (new user status, new event state) → extend
  `createTestUser` / `createTestEvent` in `e2e/helpers/fixtures.ts`.
