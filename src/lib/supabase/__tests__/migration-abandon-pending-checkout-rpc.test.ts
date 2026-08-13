// Coverage for migration
// `20260812180000_abandon_pending_checkout_rpc.sql` — the new
// `public.abandon_pending_checkout(p_user_id uuid, p_event_id uuid)`
// SECURITY DEFINER RPC.
//
// ── Why this migration exists (round 3 of the same P0 fix) ─────────────────
//
// Round 1: `abandonPendingCheckout` (src/app/events/[slug]/actions.ts)
// trusted a client-spoofable `?from=` URL param for the booking rollback
// status — any member could navigate to
// `/events/<slug>?cancelled=1&from=admin_remediation` and get a real
// `confirmed` ticket with zero payment.
//
// Round 2: fixed by deriving the rollback status from three server-written
// columns (`is_admin_hold`, `cancelled_at`, `waitlist_position`) via a plain
// TS SELECT-then-UPDATE. That fix's OWN trust model was then found
// tamperable via a direct REST `PATCH` of `is_admin_hold`/
// `admin_hold_expires_at` — closed by
// `20260812171530_revoke_bookings_admin_hold_column_write.sql`, which
// REVOKEs UPDATE on those two columns from `authenticated`/`anon`.
//
// Round 3 (this migration): that REVOKE broke Round 2's TS implementation,
// because its UPDATE unconditionally named both revoked columns in its SET
// clause via the user-scoped client, for every call, not just admin-hold
// ones. This migration moves the ENTIRE lookup + branch + write into a
// SECURITY DEFINER RPC (immune to the REVOKE, since it executes as its
// owner) and closes the residual SELECT-then-UPDATE race as a side effect
// (single `FOR UPDATE`-locked transaction instead of two round trips).
//
// See docs/SYSTEM-DESIGN-abandon-checkout-rpc.md for the full spec and
// derivation table (§2.1).
//
// ── Layers (mirrors migration-admin-reinstate-cancelled-booking.test.ts /
//    migration-admin-promote-waitlist-to-hold.test.ts in this same
//    directory) ──────────────────────────────────────────────────────────
//
// Layer 1 — Migration-text static assertions. No DB required. Always run
// in CI. This is the PRIMARY coverage for this migration in this pass —
// Docker is not installed in this sandbox (`which docker` returns nothing),
// so no live-Postgres run (not even a one-time manual one, unlike some
// sibling migration test files in this directory) was performed for this
// specific RPC. Every case below is a static assertion against the
// migration file's literal text.
//
// Layer 2 — Skipped DB-integration cases (`it.skip`), documenting exactly
// what SHOULD be verified once a local Supabase/Postgres stack is reachable
// — matching this codebase's established convention for DB-integration
// tests when a real Postgres isn't reachable.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_FILENAME = '20260812180000_abandon_pending_checkout_rpc.sql'
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, MIGRATION_FILENAME)
const REVOKE_MIGRATION_PATH = resolve(
  MIGRATIONS_DIR,
  '20260812171530_revoke_bookings_admin_hold_column_write.sql',
)

const sql = readFileSync(MIGRATION_PATH, 'utf-8')
const revokeSql = readFileSync(REVOKE_MIGRATION_PATH, 'utf-8')

const executableSql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

// Isolate the function body so assertions can't be satisfied by the long
// prose header (which legitimately quotes/describes the branch logic while
// explaining it).
const fnBody = sql.match(
  /CREATE OR REPLACE FUNCTION public\.abandon_pending_checkout\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public;/,
)?.[0]

// ════════════════════════════════════════════════════════════════════════════
// Sanity
// ════════════════════════════════════════════════════════════════════════════

describe('migration file sanity', () => {
  it('the function body was found by the isolating regex (sanity — every other assertion depends on this)', () => {
    expect(fnBody, 'fnBody not found — regex likely drifted from the file').toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1a — signature and security posture
// ════════════════════════════════════════════════════════════════════════════

describe('abandon_pending_checkout — signature and security posture', () => {
  it('CRITICAL SECURITY INVARIANT: the function signature is EXACTLY (p_user_id uuid, p_event_id uuid) — no from/status/hint/origin parameter exists at all for a caller to manipulate', () => {
    // This is the core property this whole three-round fix converges on:
    // not merely "the value isn't trusted" (round 2's posture) but
    // "the value cannot even be passed in" — there is no surface for a
    // caller-supplied value to influence the rollback decision, full stop.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.abandon_pending_checkout\(\s*\n\s*p_user_id\s+uuid,\s*\n\s*p_event_id\s+uuid\s*\n\)\s*\nRETURNS jsonb AS \$\$/,
    )
    // Belt-and-braces negative check across the WHOLE migration file: no
    // parameter named anything resembling a status/origin/hint appears in
    // the function's parameter list at all.
    const signatureMatch = sql.match(
      /CREATE OR REPLACE FUNCTION public\.abandon_pending_checkout\(([\s\S]*?)\)\s*\nRETURNS/,
    )
    expect(signatureMatch, 'could not isolate the parameter list').toBeTruthy()
    const paramList = signatureMatch![1]
    expect(paramList).not.toMatch(/from/i)
    expect(paramList).not.toMatch(/status/i)
    expect(paramList).not.toMatch(/hint/i)
    expect(paramList).not.toMatch(/origin/i)
    expect(paramList).not.toMatch(/rollback/i)
  })

  it('INVARIANT: is SECURITY DEFINER with SET search_path = public (matches book_event / book_event_paid / claim_waitlist_spot precedent, per docs/SYSTEM-DESIGN-abandon-checkout-rpc.md §3)', () => {
    expect(fnBody!).toMatch(/LANGUAGE plpgsql SECURITY DEFINER/)
    expect(fnBody!).toMatch(/SET search_path = public;/)
    // And specifically NOT the stricter `public, pg_catalog` form used by
    // the admin-hold RPC family — the design doc explicitly calls out
    // that retrofitting search_path hardening here would conflate
    // hardening with the bug fix.
    expect(fnBody!).not.toMatch(/SET search_path = public, pg_catalog/)
  })

  it('REVOKEs EXECUTE FROM PUBLIC and GRANTs ONLY to authenticated (never anon, never service_role)', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.abandon_pending_checkout\(uuid, uuid\) FROM PUBLIC;/,
    )
    expect(sql).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.abandon_pending_checkout\(uuid, uuid\) TO authenticated;/,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*abandon_pending_checkout[^\n]*\bTO\b[^\n]*\banon\b/i,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*abandon_pending_checkout[^\n]*\bTO\b[^\n]*\bservice_role\b/i,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*abandon_pending_checkout[^\n]*\bTO\b[^\n]*\bPUBLIC\b/i,
    )
  })

  it('error-shape convention: returns jsonb_build_object errors, never RAISE EXCEPTION (matches book_event/book_event_paid/claim_waitlist_spot family)', () => {
    expect(fnBody!).not.toMatch(/RAISE EXCEPTION/)
    expect(fnBody!).toMatch(/jsonb_build_object\('error',/)
  })

  it('INVARIANT: checks p_user_id != auth.uid() and rejects with an error BEFORE the row lock (defence in depth, matching every sibling RPC)', () => {
    expect(fnBody!).toMatch(
      /IF p_user_id != auth\.uid\(\) THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Unauthorised'\);/,
    )
    const gateIdx = fnBody!.indexOf('IF p_user_id != auth.uid() THEN')
    const lockIdx = fnBody!.indexOf('FOR UPDATE')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(lockIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(lockIdx)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1b — the row lock and idempotent no-op
// ════════════════════════════════════════════════════════════════════════════

describe('abandon_pending_checkout — row lookup and lock', () => {
  it('INVARIANT: locks the caller\'s own pending_payment row FOR UPDATE, scoped to user_id, event_id, status=pending_payment, deleted_at IS NULL', () => {
    expect(fnBody!).toMatch(
      /SELECT id, is_admin_hold, cancelled_at, waitlist_position\s*\n\s*INTO\s+v_booking_id, v_is_admin_hold, v_cancelled_at, v_waitlist_pos\s*\n\s*FROM\s+public\.bookings\s*\n\s*WHERE\s+user_id\s*=\s*p_user_id\s*\n\s*AND\s+event_id\s*=\s*p_event_id\s*\n\s*AND\s+status\s*=\s*'pending_payment'\s*\n\s*AND\s+deleted_at IS NULL\s*\n\s*FOR UPDATE;/,
    )
  })

  it("INVARIANT: idempotent no-op — v_booking_id IS NULL returns {booking_id: NULL, status: NULL} and skips the branch/UPDATE entirely (no matching row → the function returns immediately)", () => {
    expect(fnBody!).toMatch(
      /IF v_booking_id IS NULL THEN\s*\n\s*RETURN jsonb_build_object\('booking_id', NULL, 'status', NULL\);\s*\n\s*END IF;/,
    )
    const noOpReturnIdx = fnBody!.indexOf("RETURN jsonb_build_object('booking_id', NULL, 'status', NULL);")
    const branchIdx = fnBody!.indexOf('IF v_is_admin_hold THEN')
    expect(noOpReturnIdx).toBeGreaterThan(-1)
    expect(branchIdx).toBeGreaterThan(-1)
    expect(noOpReturnIdx).toBeLessThan(branchIdx)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1c — the 5-way branch, in the correct priority order, keyed ONLY on
// real row columns
// ════════════════════════════════════════════════════════════════════════════

describe('abandon_pending_checkout — 5-way branch logic (docs/SYSTEM-DESIGN-abandon-checkout-rpc.md §2.1)', () => {
  it('CRITICAL SECURITY INVARIANT: every branch condition is keyed on is_admin_hold / cancelled_at / waitlist_position — NONE of the branch conditions reference p_user_id or p_event_id (the only two caller-supplied values) as a decision input', () => {
    const branchBlock = fnBody!.slice(
      fnBody!.indexOf('IF v_is_admin_hold THEN'),
      fnBody!.indexOf('-- cancelled_at:'),
    )
    expect(branchBlock.length).toBeGreaterThan(0)
    // Every conditional in the branch block must reference only the three
    // row-derived locals, not either input parameter.
    const conditionLines = branchBlock
      .split('\n')
      .filter((l) => /^\s*(IF|ELSIF)\s/.test(l))
    expect(conditionLines.length).toBeGreaterThanOrEqual(3)
    for (const line of conditionLines) {
      expect(line).not.toMatch(/p_user_id/)
      expect(line).not.toMatch(/p_event_id/)
    }
  })

  it('branch #1 (highest priority): is_admin_hold AND cancelled_at IS NOT NULL → cancelled (admin_reinstate / Gap C)', () => {
    expect(fnBody!).toMatch(
      /IF v_is_admin_hold THEN[^\n]*\n\s*IF v_cancelled_at IS NOT NULL THEN[^\n]*\n\s*v_rollback_status\s*:=\s*'cancelled';/,
    )
  })

  it('branch #2: is_admin_hold AND cancelled_at IS NULL AND waitlist_position IS NOT NULL → waitlisted (admin_hold / waitlist promo)', () => {
    expect(fnBody!).toMatch(
      /ELSIF v_waitlist_pos IS NOT NULL THEN[^\n]*\n\s*v_rollback_status\s*:=\s*'waitlisted';[^\n]*\n\s*ELSE[^\n]*\n\s*v_rollback_status\s*:=\s*'confirmed';/,
    )
  })

  it("branch #3: is_admin_hold AND cancelled_at IS NULL AND waitlist_position IS NULL → confirmed (admin_remediation / Gap A) — the ELSE of the inner is_admin_hold block", () => {
    // Confirmed via the same match as branch #2 above (the ELSE is
    // adjacent in the source); assert the confirmed assignment exists at
    // all, scoped to the full is_admin_hold/branch block (through the
    // comment preceding the UPDATE), exactly once.
    const branchBlock = fnBody!.slice(
      fnBody!.indexOf('IF v_is_admin_hold THEN'),
      fnBody!.indexOf('-- cancelled_at:'),
    )
    const confirmedMatches = branchBlock.match(/v_rollback_status\s*:=\s*'confirmed';/g) ?? []
    expect(confirmedMatches.length).toBe(1)
  })

  it('branch #4: NOT is_admin_hold AND waitlist_position IS NOT NULL → waitlisted (self-service claim)', () => {
    expect(fnBody!).toMatch(
      /ELSIF v_waitlist_pos IS NOT NULL THEN[^\n]*\n\s*v_rollback_status\s*:=\s*'waitlisted';[^\n]*\n\s*ELSE[^\n]*\n\s*v_rollback_status\s*:=\s*'cancelled';/,
    )
  })

  it("branch #5 / safe default: NOT is_admin_hold AND waitlist_position IS NULL → cancelled (fresh self-service book) — the final ELSE", () => {
    const finalElseIdx = fnBody!.lastIndexOf("v_rollback_status := 'cancelled';")
    expect(finalElseIdx).toBeGreaterThan(-1)
  })

  it('branch ordering: is_admin_hold is checked BEFORE waitlist_position at the top level — an admin-hold row can never fall through to the self-service branches', () => {
    const isAdminHoldIdx = fnBody!.indexOf('IF v_is_admin_hold THEN')
    const outerElsifIdx = fnBody!.indexOf(
      'ELSIF v_waitlist_pos IS NOT NULL THEN',
      fnBody!.indexOf('END IF;', isAdminHoldIdx), // the CLOSING of the inner is_admin_hold IF block
    )
    expect(isAdminHoldIdx).toBeGreaterThan(-1)
    expect(outerElsifIdx).toBeGreaterThan(-1)
    expect(isAdminHoldIdx).toBeLessThan(outerElsifIdx)
  })

  it('within the is_admin_hold branch, cancelled_at is checked BEFORE waitlist_position — admin_reinstate (Gap C) takes priority over admin_hold (waitlist promo) when a row somehow carries both', () => {
    const isAdminHoldIdx = fnBody!.indexOf('IF v_is_admin_hold THEN')
    const cancelledAtCheckIdx = fnBody!.indexOf('IF v_cancelled_at IS NOT NULL THEN', isAdminHoldIdx)
    const innerWaitlistCheckIdx = fnBody!.indexOf('ELSIF v_waitlist_pos IS NOT NULL THEN', isAdminHoldIdx)
    expect(cancelledAtCheckIdx).toBeGreaterThan(-1)
    expect(innerWaitlistCheckIdx).toBeGreaterThan(-1)
    expect(cancelledAtCheckIdx).toBeLessThan(innerWaitlistCheckIdx)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1d — the UPDATE: cancelled_at preservation, hold-column clearing,
// re-guard
// ════════════════════════════════════════════════════════════════════════════

describe('abandon_pending_checkout — the UPDATE (state transition)', () => {
  it('INVARIANT: SET clause always clears is_admin_hold=false and admin_hold_expires_at=NULL — the exact write that would have been rejected under the REVOKE via the user-scoped client, now safe because this RPC is SECURITY DEFINER', () => {
    const updateMatch = fnBody!.match(
      /UPDATE public\.bookings\s*\n\s*SET([\s\S]*?)WHERE\s+id\s*=\s*v_booking_id/,
    )
    expect(updateMatch, 'UPDATE ... SET clause not found').toBeTruthy()
    const setClause = updateMatch![1]
    expect(setClause).toMatch(/status\s*=\s*v_rollback_status/)
    expect(setClause).toMatch(/is_admin_hold\s*=\s*false/)
    expect(setClause).toMatch(/admin_hold_expires_at\s*=\s*NULL/)
  })

  it("INVARIANT: cancelled_at is set to now() ONLY when rolling back to 'cancelled' AND the row doesn't already carry a cancelled_at — an admin_reinstate row's historical cancelled_at is preserved, never overwritten", () => {
    const updateMatch = fnBody!.match(
      /UPDATE public\.bookings\s*\n\s*SET([\s\S]*?)WHERE\s+id\s*=\s*v_booking_id/,
    )
    const setClause = updateMatch![1]
    expect(setClause).toMatch(
      /cancelled_at\s*=\s*CASE\s*\n\s*WHEN v_rollback_status\s*=\s*'cancelled' AND cancelled_at IS NULL\s*\n\s*THEN now\(\)\s*\n\s*ELSE cancelled_at\s*\n\s*END/,
    )
  })

  it("the transition UPDATE re-guards WHERE status = 'pending_payment' (provably redundant under the FOR UPDATE lock per the migration's own §2.2 note, but kept as cheap defence in depth)", () => {
    expect(fnBody!).toMatch(
      /WHERE\s+id\s*=\s*v_booking_id\s*\n\s*AND\s+status\s*=\s*'pending_payment';/,
    )
  })

  it('success response echoes booking_id and the REAL derived status', () => {
    expect(fnBody!).toMatch(
      /RETURN jsonb_build_object\(\s*\n\s*'booking_id',\s*v_booking_id,\s*\n\s*'status',\s*v_rollback_status\s*\n\s*\);/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1e — migration-wide invariants
// ════════════════════════════════════════════════════════════════════════════

describe('migration-wide invariants', () => {
  it('INVARIANT: adds ZERO new columns, ZERO new CHECK constraints, ZERO RLS policy changes — reuses is_admin_hold/cancelled_at/waitlist_position already on public.bookings', () => {
    expect(executableSql).not.toMatch(/ALTER TABLE/i)
    expect(executableSql).not.toMatch(/ADD COLUMN/i)
    expect(executableSql).not.toMatch(/ADD CONSTRAINT/i)
    expect(executableSql).not.toMatch(/CREATE POLICY/i)
    expect(executableSql).not.toMatch(/DROP POLICY/i)
  })

  it('exactly one CREATE OR REPLACE FUNCTION statement in this migration', () => {
    const matches = executableSql.match(/CREATE OR REPLACE FUNCTION/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('does not touch the REVOKE migration\'s statements at all — the two migrations are independent, complementary catalog changes (per docs/SYSTEM-DESIGN-abandon-checkout-rpc.md §6/§7)', () => {
    expect(executableSql).not.toMatch(/REVOKE UPDATE/i)
    expect(executableSql).not.toMatch(/is_admin_hold, admin_hold_expires_at\)\s+ON\s+public\.bookings/i)
  })

  it('cross-check: the REVOKE migration this RPC is designed to be immune to actually exists and targets the two hold columns for authenticated/anon', () => {
    expect(revokeSql).toMatch(
      /REVOKE UPDATE \(is_admin_hold, admin_hold_expires_at\) ON public\.bookings FROM authenticated, anon;/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 2 — Skipped DB-integration cases (no Docker in this sandbox —
// `which docker` returns nothing, matching the established convention in
// this directory for non-CI-reachable DB tests)
// ════════════════════════════════════════════════════════════════════════════

describe('DB integration — abandon_pending_checkout (not run this pass — no Docker/local Postgres reachable; unlike some sibling migration test files in this directory, no one-time manual scratch-DB run was performed for this specific RPC either)', () => {
  it.skip('signature #1 — fresh self-service book_event_paid abandon (is_admin_hold=false, cancelled_at=null, waitlist_position=null) → cancelled, with a freshly-set cancelled_at', async () => {
    // TODO(abandon-checkout-docker): seed a pending_payment booking with
    // is_admin_hold=false, cancelled_at=NULL, waitlist_position=NULL on a
    // paid event. Call abandon_pending_checkout(userId, eventId) as that
    // user. Assert data.status === 'cancelled'. Re-select the row: status
    // = 'cancelled', is_admin_hold=false, admin_hold_expires_at=NULL,
    // cancelled_at freshly set to ~now().
  })

  it.skip('signature #2 — self-service claim_waitlist_spot abandon (is_admin_hold=false, waitlist_position NOT NULL) → waitlisted, cancelled_at left NULL', async () => {
    // TODO(abandon-checkout-docker): same shape but waitlist_position=3.
    // Assert data.status === 'waitlisted'. Re-select: status='waitlisted',
    // is_admin_hold=false, admin_hold_expires_at=NULL, cancelled_at still
    // NULL (never set on this branch).
  })

  it.skip('signature #3 — admin_promote_waitlist_to_hold abandon (is_admin_hold=true, cancelled_at=NULL, waitlist_position NOT NULL) → waitlisted', async () => {
    // TODO(abandon-checkout-docker): seed is_admin_hold=true,
    // cancelled_at=NULL, waitlist_position=5. Assert data.status ===
    // 'waitlisted'. Re-select: is_admin_hold cleared to false,
    // admin_hold_expires_at cleared, cancelled_at still NULL.
  })

  it.skip('signature #4 — admin_hold_confirmed_booking_for_payment (remediation) abandon (is_admin_hold=true, cancelled_at=NULL, waitlist_position=NULL) → confirmed', async () => {
    // TODO(abandon-checkout-docker): seed is_admin_hold=true,
    // cancelled_at=NULL, waitlist_position=NULL. Assert data.status ===
    // 'confirmed'. Re-select: is_admin_hold cleared, cancelled_at still
    // NULL.
  })

  it.skip('signature #5 — admin_reinstate_cancelled_booking_for_payment abandon (is_admin_hold=true, cancelled_at NOT NULL) → cancelled, WITHOUT overwriting the pre-existing cancelled_at', async () => {
    // TODO(abandon-checkout-docker): seed is_admin_hold=true, cancelled_at
    // = a historical timestamp (e.g. now() - interval '2 days'),
    // waitlist_position=NULL. Assert data.status === 'cancelled'.
    // Re-select: cancelled_at UNCHANGED (byte-identical to the seeded
    // value, NOT bumped to now()) — the single most important assertion
    // in this signature, since a naive unconditional `cancelled_at =
    // now()` would silently corrupt the reap-origin audit timestamp.
  })

  it.skip('idempotent no-op: calling twice in a row — second call returns {booking_id: null, status: null} and does not error', async () => {
    // TODO(abandon-checkout-docker): seed a fresh pending_payment booking,
    // call the RPC once (rolls back to cancelled), then call it AGAIN for
    // the same user_id/event_id. Assert the second call's data ===
    // {booking_id: null, status: null} (no matching pending_payment row
    // anymore) and no exception is raised.
  })

  it.skip('no matching row ever existed for this user+event → {booking_id: null, status: null}, no error', async () => {
    // TODO(abandon-checkout-docker): call the RPC with a random valid
    // event id the user never booked. Assert the same no-op shape.
  })

  it.skip('a pending_payment row belonging to a DIFFERENT user is never touched — the SELECT is scoped to user_id = p_user_id and finds nothing', async () => {
    // TODO(abandon-checkout-docker): seed a pending_payment row for user
    // A. Call the RPC as user B for the same event. Assert {booking_id:
    // null, status: null} (the no-op shape — NOT an error, since from
    // user B's perspective there's simply no row to abandon). Re-select
    // user A's row: completely untouched (still pending_payment).
  })

  it.skip('p_user_id != auth.uid() (a caller attempting to pass someone else\'s uuid as p_user_id) is rejected with {error: "Unauthorised"}, before any row lock', async () => {
    // TODO(abandon-checkout-docker): as an authenticated user U, call
    // abandon_pending_checkout(otherUserId, eventId) where otherUserId !=
    // U's own auth.uid(). Assert data.error === 'Unauthorised'. Assert no
    // row belonging to otherUserId or U was touched.
  })

  it.skip('anon client cannot invoke the RPC at all (PostgREST 42501, not a jsonb error — EXECUTE was REVOKEd FROM PUBLIC and never GRANTed to anon)', async () => {
    // TODO(abandon-checkout-docker): construct an anon client (no
    // session), call .rpc('abandon_pending_checkout', {...}). Assert the
    // error is a TRANSPORT-level PostgREST rejection (42501 / "permission
    // denied for function"), not a 200-shaped jsonb {error: ...} response
    // — distinguishing this from the in-body p_user_id!=auth.uid() case
    // above, which DOES reach the function body.
  })

  it.skip("CONCURRENCY (the migration's own stated bonus fix, §2.3): two back-to-back abandon calls for the same row racing under FOR UPDATE — the second sees a consistent post-commit snapshot, never a torn read", async () => {
    // TODO(abandon-checkout-docker): seed one pending_payment row. Fire
    // two concurrent RPC calls (Promise.all across two separate Postgres
    // connections — the realistic reproduction of a double-fired "back"
    // navigation) for the SAME user_id/event_id. Assert: exactly one call
    // sees the real row and performs the rollback (status derived from
    // its true is_admin_hold/cancelled_at/waitlist_position shape); the
    // OTHER call, running after the first commits, sees status no longer
    // 'pending_payment' and gets the {booking_id: null, status: null}
    // no-op — never two conflicting UPDATEs racing on the same row, and
    // never a status flip-flop.
  })

  it.skip('REVOKE + RPC interaction: this RPC successfully clears is_admin_hold/admin_hold_expires_at via its SECURITY DEFINER write even though authenticated/anon have UPDATE on those two columns REVOKEd (the very conflict this migration exists to resolve)', async () => {
    // TODO(abandon-checkout-docker): with BOTH
    // 20260812171530_revoke_bookings_admin_hold_column_write.sql AND this
    // migration applied, seed an is_admin_hold=true row and call the RPC
    // as the owning authenticated user. Assert success (not a 42501/
    // permission-denied error) and that is_admin_hold/
    // admin_hold_expires_at are genuinely cleared on re-select — proving
    // the SECURITY DEFINER execution context is what makes this possible,
    // since the same UPDATE issued directly via the user-scoped client
    // (the OLD, pre-this-migration code path) would be rejected by that
    // REVOKE.
  })
})
