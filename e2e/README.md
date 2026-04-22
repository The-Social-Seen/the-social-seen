# E2E suite — Playwright + local Supabase

RPC-focused end-to-end tests for the booking pipeline. Automates the
12 scenarios documented in `docs/BOOKING-RPCS-TEST-PLAN.md`, plus one
integration test for the `daily-notifications` edge function.

## What it covers

| File | Scope |
|---|---|
| `booking-rpcs.spec.ts` | 12 scenarios for `book_event`, `book_event_paid`, `claim_waitlist_spot` — verification gate, active-status gate, capacity, waitlist, concurrency race, cancelled/deleted events. |
| `daily-notifications.spec.ts` | Seeds an event 6 days out with a confirmed attendee, invokes the edge function, asserts the venue-reveal `notifications` row lands with the right `template_name` + `dedupe_key`. |

Each spec calls Postgres RPCs directly via PostgREST using a user JWT
(so `auth.uid()` enforcement runs as it would in production). The
suite does **not** drive a browser — browser-level UI E2E is a future
extension.

## Local prerequisites

1. **Docker Desktop** running (Supabase CLI needs it for the local stack).
2. **Supabase CLI** — `brew install supabase/tap/supabase` (macOS) or see <https://supabase.com/docs/guides/cli>.

## Run locally

```bash
# Terminal 1 — start the local Supabase stack (DB, Auth, Storage, etc.)
supabase start

# Terminal 2 (optional) — serve the edge function so the daily-notifications
# spec runs. Without this, that spec auto-skips with a clear diagnostic.
supabase functions serve daily-notifications

# Terminal 3 — run the suite
pnpm e2e

# Interactive UI mode (useful for debugging):
pnpm e2e:ui
```

Tests run serially (`workers: 1`) because they mutate shared tables.

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
