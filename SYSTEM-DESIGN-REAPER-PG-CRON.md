# SYSTEM-DESIGN — Reaper move from Vercel cron to pg_cron

> Produced by: Architect agent (side-spec)
> Date: 2026-05-15
> Status: Spec — hand to backend-developer for implementation
> Scope: Replace `vercel.json` cron entry for `/api/admin/cron/reap-stale-bookings` with a `pg_cron` schedule running a `SECURITY DEFINER` SQL function. Vercel route stays as a manual-probe surface.

This is a focused side-spec. It does NOT replace `SYSTEM-DESIGN.md`. A one-line cross-reference is added to `SYSTEM-DESIGN.md` so future readers can find this file.

---

## 0. TL;DR

| Item | Before (Vercel cron) | After (pg_cron) |
|------|----------------------|-----------------|
| Trigger | `vercel.json` cron entry → HTTP GET `/api/admin/cron/reap-stale-bookings` | `pg_cron` schedule calling `public.reap_stale_pending_bookings()` |
| Frequency | `0 3 * * *` (1×/day, Hobby cap) | `*/15 * * * *` (every 15 min, UTC) |
| Auth chain | `CRON_SECRET` env in Vercel → Bearer match | None — function runs as `postgres` inside the DB |
| Observability | Sentry breadcrumb + 401 alarm (PR #107) | `cron.job_run_details` (rows reaped via RETURN value) plus the PR #107 alarm path preserved on the manual-probe route |
| Failure surface | Missing env var = 17-day silent 401 (2026-05-15 Roza) | None — no env var. Job runs as long as DB is up. |
| Vercel route | Scheduled invocation surface | **Stays** as manual-probe surface (Bearer CRON_SECRET path) |

Material simplifier vs the daily-notifications migration: the reaper is pure SQL. No `pg_net` / `net.http_post`, no vault, no JWT, no Edge Function. One function, one schedule.

---

## 1. SQL surface design

### 1.1 Function name and schema

Name: **`public.reap_stale_pending_bookings()`**

Schema choice — `public`, **not** an admin / internal schema. Justification:
- All existing `SECURITY DEFINER` business-logic functions in this codebase live in `public` (`book_event`, `book_event_paid`, `claim_waitlist_spot`, etc. — see migrations `20260402000012`, `20260422000002`, `20260422000004`).
- Keeping the reaper in `public` mirrors that convention and means one less search-path edge case for operators.
- Anon visibility is governed by `REVOKE EXECUTE ... FROM PUBLIC` (Section 2), not by schema placement.

### 1.2 Signature and return type

```sql
public.reap_stale_pending_bookings() RETURNS integer
```

- **Arguments: none.** The 35-minute cutoff is a compile-time constant inside the function body. Don't parameterise it. Reasons:
  - The Vercel route hard-codes 35 minutes; mirroring that locks in identical behaviour during the swap.
  - Parameterised cutoffs invite mistakes — an operator typing `interval '35 seconds'` in the SQL editor while debugging will reap live `pending_payment` rows mid-Stripe-checkout.
  - If the cutoff ever needs to change, a follow-up migration with `CREATE OR REPLACE FUNCTION` is the right surface.
- **Returns `integer`** — the count of rows reaped. Two reasons:
  - `cron.job_run_details.return_message` will contain the count, giving free observability without `pg_net` instrumentation.
  - Tests can assert against the return value directly (`SELECT public.reap_stale_pending_bookings()`).
- Do NOT return a `SETOF bookings` or `TABLE(id uuid, ...)`. That would leak booking IDs into `cron.job_run_details.return_message` (PII-adjacent, low value, makes the log noisy).

### 1.3 Function body

```sql
CREATE OR REPLACE FUNCTION public.reap_stale_pending_bookings()
RETURNS integer AS $$
DECLARE
  v_reaped integer;
BEGIN
  WITH reaped AS (
    UPDATE public.bookings
       SET status       = 'cancelled',
           cancelled_at = now()
     WHERE status              = 'pending_payment'
       AND stripe_payment_id   IS NULL
       AND deleted_at          IS NULL
       AND created_at          < now() - interval '35 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_reaped FROM reaped;

  RETURN v_reaped;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;
```

Key points the developer must preserve:

- **WHERE clause is byte-identical to the Vercel route's predicate set** (`route.ts:98-101`):
  - `status = 'pending_payment'`
  - `stripe_payment_id IS NULL`
  - `deleted_at IS NULL`
  - `created_at < now() - interval '35 minutes'`
- **`UPDATE ... RETURNING id` wrapped in a CTE `SELECT count(*)`** — single statement, atomic. No `SELECT FOR UPDATE` then `UPDATE`. The Postgres `UPDATE` already takes row-level locks on the matched rows; doing this in two steps would only widen the race window.
- **Sets `cancelled_at = now()`** to match the Vercel route's payload (`route.ts:96`). Don't drop this — `cancelled_at` is the canonical "when was this cancelled" column added in migration `20260422000003`, and admin pages / refund logic read it.
- **`SET search_path = public, pg_catalog`** — explicit. Supabase SECURITY DEFINER best practice. Prevents a hijacked search_path resolving `bookings` to a user-shadowed table.
- **`LANGUAGE plpgsql`** — required because we need `DECLARE ... INTO v_reaped`. A pure SQL function returning `setof int` is achievable but reduces readability for no win.
- **`SECURITY DEFINER`** — runs as the function owner (`postgres`), bypassing RLS on `bookings`. The Vercel route uses `service_role` to achieve the same bypass. The function is the same trust boundary, just inside the DB.

### 1.4 Owner role

Owner: **`postgres`** (Supabase's default superuser, the role pg_cron jobs run as).

Justification:
- `pg_cron` runs jobs as the role that called `cron.schedule(...)`. When a Supabase migration applies, statements run as `postgres`. So the schedule belongs to `postgres`.
- A SECURITY DEFINER function runs with the owner's privileges. Owner = `postgres` means the UPDATE bypasses RLS on `bookings`. That's the correct posture — same as `book_event_paid` (also owned by `postgres` by virtue of being created in a migration).
- Do NOT use `ALTER FUNCTION ... OWNER TO authenticator` or any role-juggling. The default owner is correct.

Explicitly do NOT add `ALTER FUNCTION public.reap_stale_pending_bookings() OWNER TO ...` to the migration. The default (`postgres`) is what we want.

---

## 2. Permissions matrix

The default Postgres rule is: when a function is created, `EXECUTE` is granted to `PUBLIC`. We override with `REVOKE FROM PUBLIC` and selectively `GRANT` back.

| Role | Can EXECUTE? | Why |
|------|--------------|-----|
| `postgres` | **Yes (implicit)** | Owner of the function. Owner privileges aren't subject to `REVOKE FROM PUBLIC`. `pg_cron` jobs run as `postgres`, so the scheduled call succeeds without an explicit grant. |
| `service_role` | **Yes (explicit GRANT)** | Operational lever — the manual-probe Vercel route (`/api/admin/cron/reap-stale-bookings`) uses the admin client (`service_role` bound) and could be migrated to call `supabase.rpc('reap_stale_pending_bookings')` in a follow-up. Not strictly needed today (route still does an inline UPDATE), but grant it now so the swap is a 1-line code change later. Also useful for ad-hoc DBA invocations during incidents. |
| `authenticated` | **No** | An authenticated user must never be able to force-cancel `pending_payment` rows. This would let any logged-in member bulk-cancel paid-event holds. |
| `anon` | **No** | Same as `authenticated`, plus anon should never touch any state-mutating function. |
| `PUBLIC` | **No (revoked)** | Standard Supabase posture — explicit grants only. |

SQL block:

```sql
REVOKE EXECUTE ON FUNCTION public.reap_stale_pending_bookings() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reap_stale_pending_bookings() TO   service_role;
-- No GRANT to authenticated or anon — intentional.
```

This matches the pattern used by `book_event_paid` (`20260422000002:134-135`), modulo the `service_role` vs `authenticated` distinction: `book_event_paid` grants `authenticated` because end users call it; the reaper grants `service_role` because only admins do.

---

## 3. pg_cron schedule registration

### 3.1 Schedule string and job name

- **Job name:** `reap-stale-pending-bookings` (kebab-case, mirrors `daily-notifications` convention).
- **Schedule:** `*/15 * * * *` — every 15 minutes, on UTC.

Rationale for 15 minutes:
- The original PR #77 design intent was 15-min cleanup; the Vercel Hobby tier 1×/day cap was the reason it shipped at daily cadence. pg_cron has no such cap.
- A `pending_payment` booking blocks the user from rebooking. 24h was the upper bound of that block under Vercel daily; 15 min puts it close to the natural Stripe Checkout session expiry (most sessions expire at ~30 min anyway). The 35-min cutoff plus 15-min poll gives a worst-case unblock latency of ~50 min from session abandonment.
- Cost: 96 UPDATE statements per day on a small indexed table. Negligible.

Don't use `* * * * *` (every minute) — overkill, increases noise in `cron.job_run_details`, and provides no user-visible improvement over 15-min.

### 3.2 `cron.schedule(...)` invocation

```sql
SELECT cron.schedule(
  'reap-stale-pending-bookings',
  '*/15 * * * *',
  $$ SELECT public.reap_stale_pending_bookings(); $$
);
```

Notes:
- Command body is a **plain `SELECT` of the function**. No DO/BEGIN wrapper needed (unlike `daily-notifications`, which had to read from vault then call `net.http_post`). This is the simplifier.
- The `SELECT`'s return value (`integer`) lands in `cron.job_run_details.return_message`. The default `pg_cron` configuration captures this.
- `$$ ... $$` dollar-quoting (not `'...'`) so the SQL inside isn't escaped twice. Mirrors the daily-notifications migration.

### 3.3 Idempotency — unschedule guard

`cron.unschedule(jobname)` raises an error if the job doesn't exist. Guard it with the same DO/EXCEPTION pattern used in `20260514070757`:

```sql
DO $$
BEGIN
  PERFORM cron.unschedule('reap-stale-pending-bookings');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- No existing schedule — nothing to unschedule.
END $$;
```

This block goes **before** the `cron.schedule(...)` call, so re-running the migration doesn't double-schedule (which would cause two parallel runs every 15 min — harmless but wasteful and confusing in `cron.job_run_details`).

---

## 4. Migration filename and structure

### 4.1 Filename

```
supabase/migrations/<YYYYMMDDhhmmss>_reaper_pgcron_schedule.sql
```

Suggested timestamp: today's UTC, e.g. `20260515090000_reaper_pgcron_schedule.sql`. The execution agent should use `supabase migration new reaper_pgcron_schedule` to auto-generate the timestamp; do NOT hand-pick a timestamp earlier than the most recent applied migration (`20260514070757`), to avoid out-of-order apply surprises.

### 4.2 Top-of-file docstring

The docstring must include:

1. **Purpose** — schedule the orphan-pending_payment reaper via pg_cron.
2. **Why pg_cron, not Vercel cron** — the 2026-05-15 Roza incident (Vercel env var missing → 17-day silent 401). pg_cron has no env var dependency. Also: Hobby-cap workaround (15-min instead of 24h cadence).
3. **What it supersedes** — the `vercel.json` cron entry for `/api/admin/cron/reap-stale-bookings`. Spell out that the Vercel route itself stays as a manual-probe surface.
4. **Operator setup required** — none. (This is the standout difference vs daily-notifications and worth calling out explicitly: "Unlike `20260514070757_supersede_daily_notifications_schedule_with_vault_pattern.sql`, this migration requires zero post-apply operator setup — no vault secrets, no env vars.")
5. **References** — PR #107 (Sentry alarm on missing CRON_SECRET), the 2026-05-15 Roza incident, `project_migration_apply_step.md` (operator-must-`db push` reminder).

### 4.3 Migration internal ordering

```
1. Header docstring (above)
2. CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
3. CREATE OR REPLACE FUNCTION public.reap_stale_pending_bookings() ...
4. REVOKE EXECUTE ... FROM PUBLIC;
   GRANT  EXECUTE ... TO service_role;
5. DO $$ ... cron.unschedule('reap-stale-pending-bookings') ... EXCEPTION $$;
6. SELECT cron.schedule('reap-stale-pending-bookings', '*/15 * * * *', $$ SELECT public.reap_stale_pending_bookings(); $$);
7. Optional: DO $$ RAISE NOTICE 'reaper pg_cron schedule installed.'; END $$;
```

The extension guard is a no-op on Supabase (pg_cron is pre-installed) but keeps the migration runnable against fresh local Supabase instances. Mirror the pattern from `20260514070757:72`.

Do NOT also `CREATE EXTENSION pg_net` — the reaper doesn't make HTTP calls. Leaving it out is a small signal of "this is the simple path."

---

## 5. The Vercel route's fate

### 5.1 Keep the route — repurpose it

`src/app/api/admin/cron/reap-stale-bookings/route.ts` **stays in place**. Body logic does not change (the inline UPDATE is fine for manual probes; converting it to call the new RPC is a follow-up the developer can take if they want, but it's not required for this PR).

Authentication path stays: Bearer `CRON_SECRET`. Manual probes (Mitesh poking the prod route during an incident, or a future on-call runbook) continue to work.

### 5.2 Updated docstring

Replace the existing top-of-file docstring (`route.ts:1-42`) with text along these lines (final wording is a developer call; this is the spec for what it must convey):

```
/**
 * Manual-probe surface for the orphan `pending_payment` booking reaper.
 *
 * SCHEDULING: This route is NOT scheduled by Vercel cron any more. The
 * 15-minute scheduled invocation is handled by pg_cron (migration
 * 20260515xxxxxx_reaper_pgcron_schedule.sql), which calls the
 * public.reap_stale_pending_bookings() SECURITY DEFINER function inside
 * the DB. The pg_cron path has no env var dependency — it cannot
 * silent-fail the way the Vercel-cron path did during the 2026-05-15
 * Roza incident (17 days of 401s because CRON_SECRET was unset).
 *
 * WHAT THIS ROUTE IS FOR: ad-hoc manual probes during incidents. Hit it
 * with `curl -H "Authorization: Bearer ${CRON_SECRET}" ...` to force a
 * reap pass and see the count without waiting for the next pg_cron tick.
 *
 * AUTHENTICATION: Authorization: Bearer ${CRON_SECRET}. The
 * x-vercel-cron defensive fallback is retained for now but is not
 * exercised by any scheduled invocation in prod — there's no
 * vercel.json cron entry pointing here. (The reason the fallback stays
 * is so the route still behaves correctly if a future operator
 * re-enables the Vercel cron entry for any reason; defence in depth.)
 *
 * SENTRY: PR #107 added a missing-CRON_SECRET alarm. We keep it — even
 * though the scheduled invocation path is gone, a manual probe that
 * 401s because CRON_SECRET is unset is still a useful signal that
 * Vercel env is misconfigured.
 *
 * SAFETY: WHERE-clause predicates are kept byte-identical to the
 * pg_cron function (public.reap_stale_pending_bookings). If you change
 * one, change both — they are two paths to the same effect.
 */
```

Key things the docstring must communicate (the wording above is illustrative; the developer may tweak):

- This is now the **manual-probe surface**, not the scheduled surface.
- The pg_cron migration is the scheduled surface — cross-reference the migration filename.
- `CRON_SECRET` Bearer auth still works for ad-hoc probes.
- Predicates must stay in sync with the SQL function.

### 5.3 What stays in the route file

- Auth logic (`authorize()` function): keep verbatim.
- Sentry instrumentation: keep verbatim — still useful for manual probes.
- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`: keep.
- The UPDATE body: keep. Two paths to the same effect; the docstring warns about staying in sync.
- Tests at `src/app/api/admin/cron/reap-stale-bookings/__tests__/route.test.ts`: keep verbatim. The tests pin the predicate shape — if a future refactor breaks it, we want them to fail.

---

## 6. vercel.json cleanup

### 6.1 Remove the cron entry

Current `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["lhr1"],
  "crons": [
    {
      "path": "/api/admin/cron/reap-stale-bookings",
      "schedule": "0 3 * * *"
    }
  ]
}
```

After this PR:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["lhr1"]
}
```

Remove the entire `"crons"` array. Reason for removing in **this** PR (not a follow-up): leaving a stale Vercel cron entry pointing at a route that's no longer the scheduled surface is a footgun. A future maintainer reading `vercel.json` will believe the cron is Vercel-driven; they'll spend time debugging Vercel env vars during an incident. Also, double-firing: between merge and the pg_cron migration applying to prod, Vercel cron would still tick once a day, racing with the new pg_cron schedule. Better to remove vercel.json's entry in the same PR and accept a brief gap (see Section 9.3 — coexistence period).

### 6.2 What stays in vercel.json

`"regions": ["lhr1"]` stays. That's the LHR (London) region pin, unrelated to cron.

### 6.3 Vercel Dashboard

Removing the entry from `vercel.json` and re-deploying will also remove the cron from Vercel's dashboard automatically. No manual dashboard click required. Per Vercel docs the source of truth is `vercel.json` and the dashboard reflects it.

---

## 7. Test strategy

Three layers, in order of value-for-effort.

### 7.1 Layer 1 — Unit test on the SECURITY DEFINER function (local Supabase)

**Path:** `supabase/tests/reap_stale_pending_bookings.sql` (suggested — there's no existing pgTAP fixture dir; the developer may choose `supabase/tests/` for new test SQL, or co-locate as `supabase/migrations/__tests__/reap_stale_pending_bookings.test.sql` if that pattern is preferred. Confirm with backend-developer.)

Alternative path the developer may prefer: a Vitest integration test at `src/__tests__/integration/reap-stale-pending-bookings.test.ts` that uses the admin client against a locally-running Supabase, mirroring the style of any other integration tests already in the repo. Either works — pgTAP is closer to the SQL layer, Vitest plays well with the existing `pnpm test` runner.

**Approach (Vitest-flavoured pseudocode):**

```
1. supabase start (local DB)
2. supabase db reset --linked=false  -- apply all migrations including new one
3. Seed 4 booking rows owned by a single test user:
   - Row A: status='pending_payment', stripe_payment_id=NULL,  deleted_at=NULL, created_at = now() - interval '40 minutes'  → SHOULD reap
   - Row B: status='pending_payment', stripe_payment_id='pi_x', deleted_at=NULL, created_at = now() - interval '40 minutes'  → must NOT reap (paid)
   - Row C: status='pending_payment', stripe_payment_id=NULL,  deleted_at=now(), created_at = now() - interval '40 minutes'  → must NOT reap (soft-deleted)
   - Row D: status='pending_payment', stripe_payment_id=NULL,  deleted_at=NULL, created_at = now() - interval '5 minutes'   → must NOT reap (too fresh)
4. SELECT public.reap_stale_pending_bookings()  → assert returns 1
5. SELECT id, status, cancelled_at FROM bookings WHERE ... → assert:
   - Row A status='cancelled' AND cancelled_at IS NOT NULL
   - Rows B, C, D unchanged (still 'pending_payment', cancelled_at IS NULL)
6. Second call: SELECT public.reap_stale_pending_bookings() → assert returns 0 (idempotency)
```

This is the **load-bearing test** — it pins the predicate shape against real Postgres semantics, the way the existing `route.test.ts` pins it against a mock. If the developer's WHERE clause has a logic bug (`OR` vs `AND`, wrong column name, wrong interval unit), this test catches it.

**Seeding caveat:** `created_at` has a `DEFAULT now()` and is `NOT NULL`. The seed must use explicit `INSERT INTO bookings (..., created_at) VALUES (..., now() - interval 'N minutes')` — don't rely on the default.

**Auth caveat:** the function is `SECURITY DEFINER` so RLS is bypassed. The seed rows can have any user_id; `auth.uid()` isn't checked inside `reap_stale_pending_bookings`. But the seed user_id must point at a real `profiles` row (FK constraint).

### 7.2 Layer 2 — Permissions test (Vitest, local Supabase)

**Path:** `src/__tests__/security/reap-stale-pending-bookings-permissions.test.ts` (or co-locate near other RLS / permissions tests if a `security/` dir exists; check repo at implementation time).

**What it asserts:**

```
1. Create a regular authenticated user.
2. Sign in as that user (Supabase client with their JWT).
3. await supabase.rpc('reap_stale_pending_bookings')
4. Assert: result.error is not null
5. Assert: result.error.code === '42501' (insufficient_privilege)
   OR result.error.message contains 'permission denied for function'

6. Create an anon client (no auth).
7. await anonSupabase.rpc('reap_stale_pending_bookings')
8. Assert: result.error is not null AND PostgREST returns 4xx
```

The Postgres error code for a denied function execution is `42501`. PostgREST surfaces this as an HTTP 403/404 depending on version, with the error code preserved in the error body.

**Why this test matters:** the permissions matrix in Section 2 is a hard security boundary. If a future migration accidentally grants `EXECUTE TO authenticated`, this test fails. Without it, the regression would be invisible until exploited.

### 7.3 Layer 3 — Schedule registration smoke test (local Supabase, one-off)

Single SQL assertion, runnable manually or as part of `supabase test`:

```sql
SELECT jobname, schedule, command
  FROM cron.job
 WHERE jobname = 'reap-stale-pending-bookings';
```

Assert:
- One row.
- `schedule = '*/15 * * * *'`.
- `command` contains `'reap_stale_pending_bookings'` (substring match — exact string match is brittle because pg_cron may normalise whitespace).
- `active = true`.

This doesn't need to be a CI gate (CI's `supabase start` already proves the migration parses). It's a manual smoke-test the operator runs once on prod after `supabase db push`, captured in the PR description's "Post-merge verification" section.

### 7.4 What we are NOT testing

- The `cron.job_run_details` row count after a tick. Reason: we can't deterministically force pg_cron to fire mid-test in <15 min. The function unit test (Layer 1) already covers "the SQL works"; the pg_cron piece is "is it scheduled?" which Layer 3 covers.
- Race conditions vs the Stripe webhook (Section 8.4 below). Reason: the safety net is the `stripe_payment_id IS NULL` predicate, and Layer 1 already asserts that.

---

## 8. Adversarial review — what could go wrong

### 8.1 Re-running the migration → double-schedule

**Concern:** If the migration is applied twice (idempotency check), would we end up with two `cron.job` rows both firing every 15 min?

**Resolution:** The DO/EXCEPTION block (Section 3.3) calls `cron.unschedule('reap-stale-pending-bookings')` before `cron.schedule(...)`. If a previous run scheduled the job, it gets unscheduled and re-scheduled — net effect is one job. If no previous run, the EXCEPTION handler swallows the "job not found" error and we proceed to schedule. The pattern is verbatim from `20260514070757` (proven on the daily-notifications migration).

**Edge case the developer must NOT do:** don't call `cron.schedule(...)` first and `cron.unschedule(...)` after. Order matters.

### 8.2 pg_cron extension not installed

**Concern:** Local Supabase fresh start, or some other Postgres deployment, where `pg_cron` isn't installed.

**Resolution:** `CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;` at the top of the migration. Supabase cloud projects have pg_cron pre-installed (it's part of the default extension set on managed Postgres). The `IF NOT EXISTS` makes it a no-op there. For fresh local environments, it installs.

**Failure mode to flag:** if `pg_cron` is not in the project's available extensions at all (e.g. a non-Supabase Postgres being used), the migration fails at `CREATE EXTENSION`. That's the correct failure — there's no graceful degradation possible for "I don't have a scheduler."

### 8.3 Locking under concurrent invocation

**Concern:** What if two reaper ticks fire simultaneously (e.g. manual probe + scheduled tick), or if a long-running `book_event_paid` transaction holds locks on the same rows?

**Index used by the WHERE clause:** `idx_bookings_status` (single-column index on `status`, created in `20260402000006:27`). The filter `status = 'pending_payment'` is highly selective in the steady state (most bookings are `confirmed` or `cancelled`; pending_payment is a transient 30-min state for paid events only — a tiny fraction of all rows). Postgres will index-scan the small set, then apply the other three predicates as a filter step.

**Concurrent-write semantics:**
- The reaper's UPDATE takes row-level exclusive locks on the rows it matches.
- `book_event_paid` (`20260422000002`) takes a row-level lock on the *event* row (`FOR UPDATE` on `events`), not on any specific booking row. The reaper isn't operating on event rows. No deadlock pathway.
- If two reaper invocations race, the second one will block on the row locks held by the first, then see the rows are no longer `pending_payment` (the first one cancelled them) and update zero rows. Idempotent.

**Conclusion:** no row-locking concern. The UPDATE set is small and short-lived. Worst case under absurd concurrency: a few millisecond stall on the second invocation. No data integrity risk.

### 8.4 Race vs Stripe webhook mid-flight

**Concern:** A user pays for an event at 35:01 after starting checkout. The reaper tick fires at 35:00 just as Stripe's `checkout.session.completed` webhook handler is mid-UPDATE on the booking row.

**Sequence A — reaper wins the race (cancels first, webhook arrives second):**
1. Reaper SELECT-FOR-UPDATE-FILTER matches the row (predicates all true at 35:00).
2. Reaper UPDATE sets `status='cancelled'`, `cancelled_at=now()`.
3. Webhook handler's UPDATE then sets `status='confirmed'`, `stripe_payment_id='pi_x'`.
4. End state: status='confirmed', stripe_payment_id='pi_x', cancelled_at=<timestamp>.

This is a weird-but-recoverable state. Admin views the booking, sees `cancelled_at` set on a `confirmed` row, knows the reaper-vs-webhook race fired. The user has a valid `confirmed` booking; the rogue `cancelled_at` is harmless metadata.

**Sequence B — webhook wins the race (sets stripe_payment_id first, reaper arrives second):**
1. Webhook UPDATE sets `stripe_payment_id='pi_x'`, `status='confirmed'`.
2. Reaper UPDATE evaluates predicates: `status='confirmed'` (fails first predicate), `stripe_payment_id IS NULL` (also fails). No match.
3. End state: status='confirmed', stripe_payment_id='pi_x'. Clean.

**Conclusion:** the `stripe_payment_id IS NULL` predicate is the safety net. The race window is narrow (only between the predicates being checked and the UPDATE being committed, within a single statement), and even the worst-case end state (Sequence A) is recoverable cosmetic noise, not data loss.

**A defensive optional improvement** (not blocking — leave for a follow-up): in the function body, change the WHERE clause to also include `cancelled_at IS NULL` so the reaper never touches a row that's already been cancelled or marked cancelled. The current Vercel route doesn't have this and hasn't shown problems; mirroring its behaviour is correct for the swap.

### 8.5 What if `pending_payment` is removed from the enum later

**Concern:** A future migration drops `pending_payment` from `booking_status` (e.g. P2-7c replaces it with two enum values).

**Mitigation:** The reaper function references the enum value as a string literal `'pending_payment'`. If the value is dropped, the function call fails at runtime with `invalid input value for enum booking_status: "pending_payment"`. This shows up loudly in `cron.job_run_details.return_message` — exactly the failure mode we want.

If/when `pending_payment` is renamed or split, the agent making that change must update this function in the same migration. Worth flagging in the migration's docstring: "Touches the `pending_payment` enum value — see migration 20260422000001."

### 8.6 What if `cancelled_at` column is renamed

Same as 8.5 — the function literal references survive only the schema they were written against. The function's docstring should call out: "Predicate set + UPDATE column set must stay in sync with the Vercel manual-probe route at `src/app/api/admin/cron/reap-stale-bookings/route.ts`. If you change one, change both."

---

## 9. Rollout and rollback

### 9.1 Apply step

Per memory note `project_migration_apply_step.md`, CI applies the migration to local Supabase only. Production needs a manual push.

**PR description's "Post-merge" section must include verbatim:**

```bash
supabase db push --include-all --linked
```

After the push, verify the schedule landed:

```sql
SELECT jobname, schedule, command, active
  FROM cron.job
 WHERE jobname = 'reap-stale-pending-bookings';
```

Expect: 1 row, `schedule = '*/15 * * * *'`, `active = true`.

Also verify a tick fires (wait up to 15 min):

```sql
SELECT runid, status, return_message, start_time, end_time
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'reap-stale-pending-bookings')
 ORDER BY start_time DESC
 LIMIT 5;
```

Expect: most recent row has `status = 'succeeded'`, `return_message` is the integer row count (often `0`).

### 9.2 Rollback

If the pg_cron schedule misbehaves and we need to revert:

```sql
-- Operator-runnable (Supabase SQL editor, as postgres):
SELECT cron.unschedule('reap-stale-pending-bookings');
```

This stops the scheduled ticks immediately. The function `public.reap_stale_pending_bookings()` remains defined (the manual-probe route doesn't depend on it, so leaving it is fine). To fully revert to Vercel cron:

1. `SELECT cron.unschedule('reap-stale-pending-bookings');`
2. Restore the `"crons"` array in `vercel.json` (one git revert of the relevant commit).
3. Redeploy Vercel to pick up the restored cron entry.

To drop the function as well:

```sql
DROP FUNCTION IF EXISTS public.reap_stale_pending_bookings();
```

The function is unreferenced once `cron.unschedule` is called and the Vercel route is unchanged (the route's UPDATE is inline, not an RPC call).

### 9.3 Coexistence period — between merge and prod apply

**The risk:** PR is merged. `vercel.json` no longer has the cron entry. The new migration is in the repo but `supabase db push` hasn't run yet. Result: **no reaper at all** for some window (potentially hours, if the operator doesn't push immediately).

**Mitigation options the developer must choose between:**

- **Option A (recommended):** Push the migration to prod *before* merging. Sequence: branch → migration committed → `supabase db push --include-all --linked` against prod from the branch → verify pg_cron tick fires → THEN merge the PR including the `vercel.json` removal. This keeps a reaper running continuously. Brief window of double-firing (pg_cron every 15 min PLUS Vercel cron once at 03:00 UTC) is harmless — the second firing finds no `pending_payment` rows older than 35 min that haven't already been cancelled, and updates zero rows.
- **Option B:** Merge the PR, *then* `supabase db push`. Brief reaper outage between merge and push. Roza-style scenarios already cap the impact (a `pending_payment` row blocks rebooking, but no data is lost). Acceptable if the push happens within an hour of merge.

**Mitesh's call.** Option A is safer; Option B is the default workflow. Either is defensible. The PR description should state which path was taken so a reviewer can sanity-check.

---

## 10. Open questions for the user

Short list. The user is in auto mode and these are decisions worth surfacing now rather than a backend-developer asking mid-implementation.

1. **Test placement preference.** Vitest integration test (`src/__tests__/integration/...`) vs pgTAP-style SQL test (`supabase/tests/...`)? No precedent in the repo for SQL-side tests; Vitest is the established pattern. **Architect's default if no answer: Vitest.**
2. **Rollout sequence.** Option A (push before merge — recommended) vs Option B (merge then push). **Architect's default if no answer: Option B**, since it matches the standard workflow and the worst-case outage is bounded.
3. **Service-role GRANT.** Grant `EXECUTE` to `service_role` now (per Section 2) to make the manual-probe route a 1-line swap later? Or leave it out and grant only when the swap is actually made? **Architect's default if no answer: grant it now** — `service_role` is operator-privileged and the grant is reversible.

Nothing else is blocking. All other choices are defensible defaults.

---

## HANDOVER

- **Agent:** architect
- **Task:** System-design spec for moving `reap-stale-bookings` from Vercel cron to pg_cron
- **Files changed:** `SYSTEM-DESIGN-REAPER-PG-CRON.md` (created); a one-line cross-reference appended to `SYSTEM-DESIGN.md` (planned addition — see Section 11 in this file as a note for the developer)
- **Migrations planned:** 1 — `supabase/migrations/<timestamp>_reaper_pgcron_schedule.sql` (NOT yet created; backend-developer creates via `supabase migration new reaper_pgcron_schedule`)
- **Tests added:** none (architect doesn't write tests); 3 test layers spec'd in Section 7 — Vitest unit, Vitest permissions, manual SQL smoke
- **Next agent:** `backend-developer` to implement the migration, update the Vercel route docstring, remove the `vercel.json` cron entry, and write the Vitest tests
- **Risks / open questions:**
  - Section 10 lists 3 open questions; all have defensible architect defaults so backend-developer can proceed without blocking
  - Coexistence-period gap (Section 9.3) — operator must choose Option A or B at push time
  - Operator-runbook reminder: `supabase db push --include-all --linked` post-merge is mandatory per `project_migration_apply_step.md`
  - No new RLS policies introduced — function is `SECURITY DEFINER` with explicit `REVOKE` + selective `GRANT`
