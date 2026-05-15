// Coverage for migration `20260515095343_reaper_pgcron_schedule.sql`,
// which moves the orphan-`pending_payment` reaper from Vercel cron to
// pg_cron. The migration installs:
//   1. `public.reap_stale_pending_bookings()` — SECURITY DEFINER fn,
//      returns integer count of rows reaped.
//   2. A pg_cron schedule `'reap-stale-pending-bookings'` calling that
//      function every 15 minutes.
//
// ── Layers (mirrors the pattern of migration-w1-demographics.test.ts
//    and migration-w2-w3-taxonomy.test.ts in this same directory) ──────────
//
// Layer 1 — Migration-text static assertions. Run without a DB. Catch
// refactor mistakes in the .sql file itself: predicate shape drift, a
// dropped REVOKE/GRANT line, an unschedule-without-EXCEPTION-guard
// regression, a search_path attribute lost, a `pg_net` extension snuck
// in by mistake, etc. These are the load-bearing assertions for CI —
// the route tests cover the manual-probe surface; this file covers the
// migration that drives the scheduled surface.
//
// Layer 2 — Vercel-route ↔ SQL-function predicate-shape cross-check.
// The reaper now has two implementations of the same WHERE clause: the
// inline Supabase chain in route.ts (`.eq('status', 'pending_payment')
// .is('stripe_payment_id', null).is('deleted_at', null).lt('created_at',
// cutoff)`) and the SQL function's `WHERE … AND … AND … AND` block. If
// one drifts, we have two paths to the same effect that no longer agree.
// Layer 2 runs static-text checks against both files to keep them
// aligned.
//
// Layer 3 — Skipped DB-integration cases. Per the established repo
// convention (search the dir for `TODO(W4-docker)`): each critical
// behavioural assertion is encoded as `it.skip(...)` with a
// `TODO(reaper-docker)` marker and the body of what the test should do
// once Docker / `supabase start` is available. Unskip and run against a
// fresh `supabase db reset` to execute. The skipped layer covers:
//   - The function's WHERE-clause semantics: reap A, NOT B, NOT C, NOT D
//     (the four cases from spec Section 7.1).
//   - Idempotency: a second call returns 0.
//   - Permissions: anon and authenticated calls both fail with
//     permission-denied; service_role succeeds.
//
// The skipped layer is the spec's Layer 1 + Layer 2 behavioural pins —
// they live here as `it.skip` with full setup instructions rather than
// running flakily in CI (no Docker on the build machine; spinning up
// `supabase start` mid-CI also exceeds reasonable Vitest test budgets).
// Layer 3 of the spec — the `cron.job` registration smoke — is a
// manual SQL probe documented in the PR description's "Post-merge
// verification" section, not a CI test.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Paths ───────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_FILENAME = '20260515095343_reaper_pgcron_schedule.sql'
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, MIGRATION_FILENAME)
const ROUTE_PATH = resolve(
  __dirname,
  '../../../../src/app/api/admin/cron/reap-stale-bookings/route.ts',
)
const VERCEL_JSON_PATH = resolve(__dirname, '../../../../vercel.json')

function loadFile(p: string): string {
  return readFileSync(p, 'utf-8')
}

// ════════════════════════════════════════════════════════════════════════════
// Layer 1 — Migration text invariants
// ════════════════════════════════════════════════════════════════════════════

describe('reaper migration — extension + function declaration', () => {
  const sql = loadFile(MIGRATION_PATH)

  it('creates pg_cron with IF NOT EXISTS (idempotent on Supabase cloud + fresh local)', () => {
    // Supabase managed Postgres has pg_cron pre-installed, so this is
    // a no-op there. The IF NOT EXISTS keeps the migration runnable
    // against a fresh local stack.
    expect(sql).toMatch(
      /CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions/,
    )
  })

  it('does NOT also create pg_net (this job is pure SQL, no HTTP)', () => {
    // The daily-notifications migration creates pg_net because it
    // POSTs to an Edge Function. The reaper does not — leaving pg_net
    // out is a deliberate signal of "this is the simple path."
    //
    // Strip SQL line comments before grepping — the migration's own
    // docstring legitimately references "CREATE EXTENSION pg_net" in
    // explaining why it's NOT being created. We only want to flag
    // executable statements.
    const stmts = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(stmts).not.toMatch(/CREATE EXTENSION[^\n]*pg_net/i)
    expect(stmts).not.toMatch(/\bnet\.http_post\b/i)
  })

  it('declares public.reap_stale_pending_bookings() RETURNS integer', () => {
    // Return type is `integer` (not setof, not table) so the count
    // lands cleanly in cron.job_run_details.return_message. Argument
    // list is empty — the 35-minute cutoff is a compile-time constant
    // inside the function body, not a parameter.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.reap_stale_pending_bookings\(\)\s*\n?\s*RETURNS integer/,
    )
  })

  it('declares the function as LANGUAGE plpgsql SECURITY DEFINER', () => {
    // SECURITY DEFINER is what lets the function bypass RLS on bookings
    // (same trust boundary as the Vercel route's service_role client).
    // plpgsql is required for the DECLARE/INTO pattern.
    expect(sql).toMatch(/LANGUAGE plpgsql SECURITY DEFINER/)
  })

  it('sets search_path = public, pg_catalog on the function', () => {
    // Supabase SECURITY DEFINER best practice — prevents a hijacked
    // search_path resolving `bookings` to a user-shadowed table.
    // Without this, a malicious user could in principle create a
    // `bookings` table in a schema they own and prefix it onto the
    // search path. Belt-and-braces — the function owner is `postgres`,
    // not `authenticated`, so the practical attack surface is small,
    // but the rule applies uniformly.
    expect(sql).toMatch(/SET search_path = public,\s*pg_catalog/)
  })

  it('does NOT alter the function owner (default postgres is correct)', () => {
    // pg_cron runs scheduled commands as the role that called
    // cron.schedule (postgres in this migration), and SECURITY DEFINER
    // means UPDATE bypasses RLS as `postgres`. Any ALTER FUNCTION
    // OWNER TO ... would be a regression.
    expect(sql).not.toMatch(/ALTER FUNCTION public\.reap_stale_pending_bookings/)
  })

  it('return type is NOT SETOF or TABLE — count only, no row IDs leaked into cron.job_run_details', () => {
    // INVARIANT: the function returns a scalar integer, NOT a row set.
    // Spec Section 1.2 is explicit — returning `SETOF bookings` or
    // `TABLE(id uuid, ...)` would leak booking IDs (PII-adjacent) into
    // `cron.job_run_details.return_message` on every 15-min tick. The
    // return-type contract is a privacy property as well as a shape one.
    //
    // Pinning ABSENCE assertions because the positive test
    // (RETURNS integer) doesn't tell us a future PR couldn't change it
    // to `RETURNS SETOF integer` and still pass the existing assertion's
    // substring match.
    expect(sql).not.toMatch(/RETURNS\s+SETOF\b/i)
    expect(sql).not.toMatch(/RETURNS\s+TABLE\s*\(/i)
  })

  it('return type does NOT match SETOF on the reaper function specifically (regex anchor check)', () => {
    // Stronger version of the above — anchor to the reaper function
    // declaration specifically so a SETOF on some other function added
    // later doesn't trip this.
    expect(sql).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.reap_stale_pending_bookings\(\)[\s\S]*?RETURNS\s+(SETOF|TABLE)\b/i,
    )
  })
})

describe('reaper migration — function body and WHERE clause', () => {
  const sql = loadFile(MIGRATION_PATH)

  // The function body's WHERE clause is the load-bearing safety net.
  // Each predicate exists for a documented reason; if any one is
  // weakened or removed, the reaper either misses orphans (under-reaps)
  // or touches rows that shouldn't be touched (over-reaps, the more
  // dangerous direction). Pin each individually so a failure cleanly
  // names the lost predicate.

  it('UPDATE sets BOTH status = cancelled AND cancelled_at = now()', () => {
    // cancelled_at is the canonical "when was this cancelled" column
    // (added in 20260422000003). Dropping it from the SET clause would
    // produce confirmed-vs-cancelled audit drift — admin views read
    // cancelled_at, not just status.
    expect(sql).toMatch(/SET status\s*=\s*'cancelled'/)
    expect(sql).toMatch(/cancelled_at\s*=\s*now\(\)/)
  })

  it('predicate: status = pending_payment', () => {
    expect(sql).toMatch(/WHERE status\s*=\s*'pending_payment'/)
  })

  it('predicate: stripe_payment_id IS NULL (paid-bookings safety net)', () => {
    // This is the predicate that guarantees we never touch a booking
    // that actually paid. The Stripe webhook is the source of truth
    // for paid bookings — it writes stripe_payment_id on
    // checkout.session.completed. If this predicate is lost, the
    // reaper could cancel paid bookings whose webhook hasn't landed
    // yet during a Stripe-side delay. Test the EXACT canonical column
    // name to catch typos / renames.
    expect(sql).toMatch(/AND stripe_payment_id\s+IS NULL/)
  })

  it('predicate: deleted_at IS NULL (skip already-soft-deleted)', () => {
    expect(sql).toMatch(/AND deleted_at\s+IS NULL/)
  })

  it('predicate: created_at < now() - interval 35 minutes', () => {
    // 35 minutes is byte-identical to the Vercel route's cutoff
    // (route.ts:88, `Date.now() - 35 * 60 * 1000`). If this drifts
    // off the route, the two implementations no longer agree.
    expect(sql).toMatch(
      /AND created_at\s*<\s*now\(\)\s*-\s*interval\s*'35 minutes'/,
    )
  })

  it('uses a CTE UPDATE … RETURNING id wrapped in SELECT count(*) (single atomic statement)', () => {
    // The CTE pattern is what makes this a single atomic statement.
    // A SELECT-FOR-UPDATE-then-UPDATE-in-a-loop pattern would widen
    // the race window vs the Stripe webhook. Pin the shape so a
    // future "refactor" doesn't quietly split it.
    expect(sql).toMatch(/WITH reaped AS \(/)
    expect(sql).toMatch(/RETURNING id/)
    expect(sql).toMatch(/SELECT count\(\*\) INTO v_reaped FROM reaped/)
  })

  it('returns the row count via RETURN v_reaped', () => {
    // The return value lands in cron.job_run_details.return_message,
    // giving free observability without pg_net instrumentation.
    expect(sql).toMatch(/RETURN v_reaped/)
  })
})

describe('reaper migration — permissions matrix', () => {
  const sql = loadFile(MIGRATION_PATH)

  // Permissions are the hard security boundary. Each REVOKE/GRANT is
  // an explicit posture choice (see migration docstring for rationale).

  it('REVOKES EXECUTE on the function FROM PUBLIC', () => {
    // Standard Supabase posture — explicit grants only. Without this,
    // every role on the DB (including anon) could execute the function.
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.reap_stale_pending_bookings\(\) FROM PUBLIC/,
    )
  })

  it('GRANTS EXECUTE on the function TO service_role', () => {
    // Per spec Section 10 decision 3 — grant now so a future swap of
    // the route's inline UPDATE for an `admin.rpc(...)` call is a 1-
    // line change. Also useful for ad-hoc DBA invocations during
    // incidents.
    expect(sql).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.reap_stale_pending_bookings\(\) TO\s+service_role/,
    )
  })

  it('does NOT grant EXECUTE to authenticated or anon (security boundary)', () => {
    // An authenticated user must never be able to force-cancel
    // pending_payment rows — that would let any logged-in member bulk-
    // cancel paid-event seat holds. Pin the absence so a future PR
    // adding a wider grant fails CI loudly.
    expect(sql).not.toMatch(
      /GRANT[^\n]*reap_stale_pending_bookings[^\n]*\bTO\b[^\n]*authenticated/i,
    )
    expect(sql).not.toMatch(
      /GRANT[^\n]*reap_stale_pending_bookings[^\n]*\bTO\b[^\n]*anon\b/i,
    )
  })
})

describe('reaper migration — cron schedule', () => {
  const sql = loadFile(MIGRATION_PATH)

  it('unschedules any prior job before scheduling (idempotency)', () => {
    // The DO/EXCEPTION block calls cron.unschedule first; the EXCEPTION
    // handler swallows the "job not found" error from a fresh run.
    // Without this, re-running the migration would error on the second
    // schedule attempt (or, worse, double-schedule).
    expect(sql).toMatch(
      /DO \$\$\s*BEGIN\s*PERFORM cron\.unschedule\('reap-stale-pending-bookings'\)\s*;\s*EXCEPTION WHEN OTHERS THEN/,
    )
  })

  it('order: unschedule BEFORE schedule (not the other way around)', () => {
    // Reverse order would unschedule the freshly-installed job. The
    // architect's spec explicitly calls this out as a footgun.
    const unschedIdx = sql.indexOf("cron.unschedule('reap-stale-pending-bookings')")
    const schedIdx = sql.indexOf("cron.schedule(\n  'reap-stale-pending-bookings'")
    // Use a fallback indexOf for the schedule call in case of formatting
    // drift (still single-line, multi-line, etc).
    const schedFallback = sql.indexOf("cron.schedule(")
    const actualSchedIdx = schedIdx > -1 ? schedIdx : schedFallback
    expect(unschedIdx).toBeGreaterThan(-1)
    expect(actualSchedIdx).toBeGreaterThan(-1)
    expect(unschedIdx).toBeLessThan(actualSchedIdx)
  })

  it('schedules with job name reap-stale-pending-bookings, cadence */15 * * * *', () => {
    // Pin both — name is what `cron.unschedule` keys off (must match
    // EXACTLY across the unschedule + schedule calls), cadence is
    // what the spec promises operators.
    expect(sql).toMatch(
      /SELECT cron\.schedule\([\s\S]*?'reap-stale-pending-bookings',\s*'\*\/15 \* \* \* \*'/,
    )
  })

  it('schedule command body calls public.reap_stale_pending_bookings() (dollar-quoted)', () => {
    // Dollar-quoting ($$ … $$) so the inner SELECT isn't re-escaped.
    // Mirrors the daily-notifications migration convention.
    expect(sql).toMatch(/\$\$\s*SELECT public\.reap_stale_pending_bookings\(\);\s*\$\$/)
  })

  it('unschedule guard uses EXCEPTION WHEN OTHERS THEN NULL (not RAISE or unhandled)', () => {
    // INVARIANT: re-running the migration on a fresh DB must not error.
    // The EXCEPTION block specifically must swallow with NULL — a stray
    // RAISE or empty block here would either fail re-runs (no-job
    // case) or silently mask real errors.
    //
    // Existing test asserts the DO/EXCEPTION shape; this one pins the
    // NULL body specifically so a future "let's log the exception
    // instead" refactor that changes NULL to RAISE NOTICE doesn't slip
    // through with the same regex.
    expect(sql).toMatch(
      /PERFORM cron\.unschedule\('reap-stale-pending-bookings'\)\s*;\s*EXCEPTION WHEN OTHERS THEN\s*--[^\n]*\n\s*NULL;/,
    )
  })

  it('cron.schedule(...) is called EXACTLY ONCE (defence against duplicate registration)', () => {
    // INVARIANT: only one schedule registration per migration. Two
    // SELECT cron.schedule(...) statements with the same jobname would
    // fail at the second call (pg_cron unique-job constraint), but if
    // they had different names — say a copy-paste typo creating a
    // 'reap-stale-pending-bookings-v2' — both would land and fire in
    // parallel every 15 min. The migration's docstring promises one
    // schedule; pin it.
    //
    // Strip line comments before counting — the docstring legitimately
    // says "cron.schedule" in prose.
    const stmts = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    const matches = stmts.match(/\bcron\.schedule\s*\(/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('cron.unschedule(...) is called EXACTLY ONCE for the reaper jobname', () => {
    // INVARIANT: one unschedule per migration, matching the one
    // schedule. A second unschedule would either be a copy-paste bug or
    // an attempt to "clean up" some other job — either is suspect.
    const stmts = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    const matches =
      stmts.match(/cron\.unschedule\(\s*'reap-stale-pending-bookings'/g) ?? []
    expect(matches).toHaveLength(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 2 — Vercel route ↔ SQL function predicate-shape cross-check
// ════════════════════════════════════════════════════════════════════════════

describe('reaper — Vercel route + SQL function predicate alignment', () => {
  // The migration docstring promises: "Predicate set + UPDATE column
  // set must stay in sync with the Vercel manual-probe route." If a
  // future PR weakens one and forgets the other, we end up with two
  // paths to the same effect that don't agree — exactly the regression
  // the architect's Section 8.6 warns about. These checks force a
  // failure here when that happens, rather than as a UX regression
  // surfaced months later.

  const migrationSql = loadFile(MIGRATION_PATH)
  const routeSrc = loadFile(ROUTE_PATH)

  it("route still filters .eq('status', 'pending_payment') — matches SQL fn predicate 1", () => {
    expect(routeSrc).toMatch(/\.eq\(\s*['"]status['"]\s*,\s*['"]pending_payment['"]\s*\)/)
    expect(migrationSql).toMatch(/WHERE status\s*=\s*'pending_payment'/)
  })

  it("route still filters .is('stripe_payment_id', null) — matches SQL fn predicate 2", () => {
    expect(routeSrc).toMatch(/\.is\(\s*['"]stripe_payment_id['"]\s*,\s*null\s*\)/)
    expect(migrationSql).toMatch(/AND stripe_payment_id\s+IS NULL/)
  })

  it("route still filters .is('deleted_at', null) — matches SQL fn predicate 3", () => {
    expect(routeSrc).toMatch(/\.is\(\s*['"]deleted_at['"]\s*,\s*null\s*\)/)
    expect(migrationSql).toMatch(/AND deleted_at\s+IS NULL/)
  })

  it("route still filters .lt('created_at', cutoff) — matches SQL fn predicate 4", () => {
    expect(routeSrc).toMatch(/\.lt\(\s*['"]created_at['"]\s*,\s*cutoff\s*\)/)
    expect(migrationSql).toMatch(/created_at\s*<\s*now\(\)\s*-\s*interval\s*'35 minutes'/)
  })

  it('route cutoff is exactly 35 minutes — matches SQL fn cutoff', () => {
    // The route declares `const cutoff = new Date(Date.now() - 35 * 60 * 1000).toISOString()`.
    // The SQL function uses `now() - interval '35 minutes'`. Pin both
    // ends so a future "let's relax the cutoff to 10 minutes" PR has
    // to update both, not just one.
    expect(routeSrc).toMatch(/35\s*\*\s*60\s*\*\s*1000/)
    expect(migrationSql).toMatch(/interval\s*'35 minutes'/)
  })

  it('route still sets BOTH status = cancelled AND cancelled_at — matches SQL fn UPDATE columns', () => {
    expect(routeSrc).toMatch(/status:\s*['"]cancelled['"]/)
    expect(routeSrc).toMatch(/cancelled_at:/)
    expect(migrationSql).toMatch(/SET status\s*=\s*'cancelled'/)
    expect(migrationSql).toMatch(/cancelled_at\s*=\s*now\(\)/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Paired-state assertions — route docstring + vercel.json
//
// These pin invariants ACROSS files. Each is a "if you change one, you must
// change the other" coupling: if a future PR renames the migration but
// forgets to update the route docstring, or removes the migration but
// leaves the vercel.json `"crons"` array in place, the failure surfaces
// here in CI rather than in production silence.
// ════════════════════════════════════════════════════════════════════════════

describe('reaper — route docstring references the pg_cron migration', () => {
  const routeSrc = loadFile(ROUTE_PATH)

  it("docstring cross-references the migration filename '20260515095343_reaper_pgcron_schedule.sql'", () => {
    // INVARIANT: the route's docstring names the exact migration that
    // installs the scheduled surface. A future migration rename or
    // squash that forgets to update this docstring leaves a reader
    // chasing a non-existent file during an incident. Pin the literal
    // filename so the failure is loud and immediate.
    expect(routeSrc).toContain(MIGRATION_FILENAME)
  })

  it("docstring explicitly says the route is NOT scheduled by Vercel cron any more", () => {
    // INVARIANT: the role of this route has changed. The docstring must
    // make that explicit — "manual probe" not "scheduled tick" — so a
    // future maintainer reading the file understands the inversion
    // without spelunking the migration history.
    expect(routeSrc).toMatch(/NOT scheduled by Vercel cron/i)
  })

  it("docstring references the SECURITY DEFINER function 'public.reap_stale_pending_bookings'", () => {
    // INVARIANT: the route docstring names the SQL function it parallels.
    // If a future rename of the function (e.g. to
    // `reap_orphan_pending_bookings`) drops this reference, the docstring
    // goes stale silently — failing here forces both to move together.
    expect(routeSrc).toContain('reap_stale_pending_bookings')
  })
})

describe('reaper — vercel.json no longer schedules the route', () => {
  const vercelJson = loadFile(VERCEL_JSON_PATH)

  // Parse once and reuse — JSON parsing failure here is itself a
  // regression worth surfacing.
  const parsed = JSON.parse(vercelJson) as Record<string, unknown>

  it('vercel.json does NOT contain a "crons" key (paired with pg_cron migration)', () => {
    // INVARIANT: the scheduled surface for this job is pg_cron, not
    // Vercel cron. If a future PR re-adds a `"crons"` array entry
    // pointing at /api/admin/cron/reap-stale-bookings, the result is
    // double-firing (every 15 min from pg_cron PLUS once a day from
    // Vercel). Harmless on the data side (idempotent reap) but
    // confusing in `cron.job_run_details` and Sentry breadcrumbs.
    //
    // Test on the parsed object — substring matching on the JSON text
    // would false-positive on a comment-like field, even though JSON
    // doesn't support comments.
    expect(parsed).not.toHaveProperty('crons')
  })

  it('vercel.json still pins region lhr1 (sanity — only crons was supposed to change)', () => {
    // INVARIANT: this PR's vercel.json change is "remove crons, keep
    // everything else". The regions pin is non-cron config that must
    // survive. If a future PR rewrites vercel.json entirely and
    // forgets the LHR pin, requests from London users hit a US-East
    // region by default.
    expect(parsed).toHaveProperty('regions')
    expect(parsed.regions).toEqual(['lhr1'])
  })

  it('vercel.json textual sanity — no stray reference to the reaper route', () => {
    // INVARIANT: belt-and-braces — even if someone reintroduces a
    // crons-like field under a different key, a path reference to the
    // reaper route inside vercel.json is now a smell.
    expect(vercelJson).not.toContain('reap-stale-bookings')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 3 — Skipped DB-integration cases (TODO(reaper-docker))
//
// These are the spec's load-bearing behavioural assertions
// (Section 7.1 / 7.2). They're SKIPPED here because Docker / Docker
// Desktop is not available in the build environment, so a local
// Supabase stack can't be brought up inside Vitest. Unskip once
// `supabase start` is reachable on the host and run against a fresh
// `supabase db reset`. Each `it.skip(...)` body documents what the
// test should do; the names are written so failures cleanly identify
// the regression.
//
// Pattern mirrors `migration-w1-demographics.test.ts` and
// `migration-w2-w3-taxonomy.test.ts` in this same directory.
// ════════════════════════════════════════════════════════════════════════════

describe('DB integration — function behaviour (TODO(reaper-docker))', () => {
  // Seed four booking rows owned by a test user and assert the
  // function reaps exactly the one row that matches all four
  // predicates. See spec Section 7.1 for the row matrix.

  it.skip('reaps Row A (pending_payment, no stripe id, not deleted, 40 min old)', async () => {
    // TODO(reaper-docker): unskip once a local Supabase stack is
    // available.
    //
    // Setup (use the admin client to bypass RLS for seeding):
    //   1. INSERT a profile row to use as bookings.user_id FK target.
    //      (Either INSERT INTO auth.users then INSERT INTO profiles
    //      manually, or reuse an existing test fixture user.)
    //   2. INSERT INTO public.bookings with:
    //        status='pending_payment', stripe_payment_id=NULL,
    //        deleted_at=NULL, created_at=now() - interval '40 minutes'.
    //      MUST set created_at explicitly — the column has DEFAULT
    //      now() and the seed would otherwise be too fresh to reap.
    //   3. Call: await admin.rpc('reap_stale_pending_bookings')
    //   4. Assert: result.data === 1 (one row reaped).
    //   5. SELECT status, cancelled_at FROM bookings WHERE id = rowA.
    //   6. Assert: status === 'cancelled', cancelled_at IS NOT NULL.
  })

  it.skip('does NOT reap Row B (has stripe_payment_id — paid booking)', async () => {
    // TODO(reaper-docker): seed a booking with stripe_payment_id='pi_x'
    // (any non-NULL value), all other predicates matching. After
    // calling reap_stale_pending_bookings, Row B's status must still
    // be 'pending_payment'. This is the predicate that guarantees we
    // never cancel a paid booking whose webhook hasn't landed yet.
  })

  it.skip('does NOT reap Row C (deleted_at is set — soft-deleted)', async () => {
    // TODO(reaper-docker): seed a booking with deleted_at=now(), all
    // other predicates matching. Row C's status must still be
    // 'pending_payment' after reaping. Soft-deleted rows are
    // intentionally excluded — they're "tombstoned" already and
    // re-cancelling them would just churn cancelled_at.
  })

  it.skip('does NOT reap Row D (created_at = 5 min ago — too fresh)', async () => {
    // TODO(reaper-docker): seed a booking with created_at = now() -
    // interval '5 minutes', all other predicates matching. Row D
    // must survive — the 35-min cutoff exists so users with a slow
    // Stripe Checkout session aren't yanked mid-flow.
  })

  it.skip('idempotency — a second call returns 0', async () => {
    // TODO(reaper-docker): after the four-row seed and first reap
    // call (which returns 1), call reap_stale_pending_bookings a
    // second time. Assert: result.data === 0. No rows match the
    // predicates on the second pass — Row A is already cancelled.
    // Critical for safe re-entrance; pg_cron must be able to fire
    // every 15 minutes without ever erroring on "already reaped".
  })
})

describe('DB integration — permissions (TODO(reaper-docker))', () => {
  // The hard security boundary from Section 2 of the spec. Without
  // these tests, a future migration accidentally granting
  // `EXECUTE TO authenticated` would silently expose the force-cancel
  // primitive to every logged-in member.

  it.skip('anon client → permission-denied error from supabase.rpc', async () => {
    // TODO(reaper-docker):
    //   1. Construct an anon client (createClient with NEXT_PUBLIC_*
    //      anon key, no auth session).
    //   2. await anon.rpc('reap_stale_pending_bookings')
    //   3. Assert: result.error is non-null.
    //   4. Assert: PostgREST surfaces this as 4xx — the error.code
    //      should be '42501' (insufficient_privilege) OR the message
    //      should contain 'permission denied for function'.
    //   5. The query must NOT silently return 0 — that would mean
    //      anon could execute the function (a regression). The
    //      distinction is "error code 42501" vs "data: 0, error: null".
  })

  it.skip('authenticated non-admin user → permission-denied error from supabase.rpc', async () => {
    // TODO(reaper-docker): seed a regular member profile (role !=
    // 'admin'). Sign in as that user (real Supabase JWT). Then:
    //   await member.rpc('reap_stale_pending_bookings')
    // Assert: result.error.code === '42501' OR message contains
    // 'permission denied'. Just like the anon test — must NOT
    // silently succeed. Granting service_role only (not
    // authenticated) is the security boundary.
  })

  it.skip('service_role client → success (RPC returns the row count)', async () => {
    // TODO(reaper-docker): construct an admin client (createAdminClient
    // — service_role key). Run:
    //   await admin.rpc('reap_stale_pending_bookings')
    // Assert: result.error is null, result.data is a number (0 if
    // nothing to reap, otherwise the count). Proves the GRANT TO
    // service_role line is actually wired and the function executes.
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Operator smoke (manual, post-`supabase db push`)
//
// NOT a CI test. The operator runs these SQL probes by hand after
// applying the migration to prod to confirm the schedule landed and
// is firing. Documented here for cross-reference; the canonical copy
// lives in the PR description's "Post-merge verification" section.
//
//   SELECT jobname, schedule, command, active
//     FROM cron.job
//    WHERE jobname = 'reap-stale-pending-bookings';
//   -- Expect: 1 row, schedule = '*/15 * * * *', active = true.
//
//   SELECT runid, status, return_message, start_time, end_time
//     FROM cron.job_run_details
//    WHERE jobid = (SELECT jobid FROM cron.job
//                    WHERE jobname = 'reap-stale-pending-bookings')
//    ORDER BY start_time DESC
//    LIMIT 5;
//   -- Expect (after up to 15 min): most recent row status =
//   -- 'succeeded', return_message = the integer row count (usually
//   -- 0 on a healthy prod).
// ════════════════════════════════════════════════════════════════════════════
