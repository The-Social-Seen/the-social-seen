// Coverage for migration
// `20260713000004_admin_hold_confirmed_booking_and_release_rpcs.sql` — the
// same-day Addendum to the admin waitlist-promotion payment-hold feature
// (SYSTEM-DESIGN-admin-waitlist-promotion-payment.md, "Addendum
// (2026-07-13, same day)"). Two new RPCs:
//
//   Gap A — `admin_hold_confirmed_booking_for_payment` — remediates a
//   `confirmed`-but-unpaid booking on a paid event (the exact bug the base
//   PR fixes going forward, except it already happened to two production
//   bookings before the fix existed). Rejects if already paid (the
//   double-charge guard), deliberately SKIPS the capacity check.
//
//   Gap B — `admin_revert_hold_to_waitlist` — manually releases an active
//   `pending_payment` hold back to `waitlisted`, origin-agnostic, always
//   reverts to `waitlisted` (never `confirmed`).
//
// ── Layers (mirrors migration-admin-promote-waitlist-to-hold.test.ts /
//    migration-admin-hold-columns.test.ts in this same directory) ──────────
//
// Layer 1 — Migration-text static assertions. No DB required.
// Layer 2 — Cross-checks: (a) this migration adds ZERO new columns/CHECK
// constraints (header's own claim, verified against the file text), (b)
// admin_hold_confirmed_booking_for_payment's capacity-check ABSENCE is
// verified by diffing its structure against its sibling
// admin_promote_waitlist_to_hold (20260713000002), which DOES have one —
// proving the omission is a deliberate, structural difference, not an
// accidental one both functions happen to lack.
// Layer 3 — DB-integration cases. Unlike the sibling migration's own
// Layer 3 (still `it.skip`, purely aspirational TODOs never run), EVERY
// case below was actually executed against a real, disposable local
// Postgres 18 instance during this same tester pass — Homebrew
// `postgresql@18`, Docker-free (`supabase start` unavailable in this
// environment — confirmed via "Cannot connect to the Docker daemon", same
// constraint prior agents in this thread hit). All 61+ real migrations
// were applied verbatim except the three that require Supabase-managed
// extensions unavailable outside a real Supabase stack (pg_cron, pg_net,
// supabase_vault — `20260421000004`, `20260514070757`,
// `20260515095343`) and one storage-bucket seed migration
// (`20260402000013`, references `storage.buckets` which nothing else
// depends on) — confirmed via grep that no other migration references
// those schemas, so skipping them is lossless for this feature's schema.
// A minimal `auth` schema stub (`auth.users`, session-GUC-driven
// `auth.uid()`) stood in for Supabase Auth.
//
// Kept as `it.skip` here (not converted to always-run) to match this
// codebase's established convention for DB-integration tests when a real
// Postgres isn't part of the CI/dev toolchain — flagged in the tester's
// HANDOVER as a deliberate choice to preserve, not silently deviate from,
// that convention. Each skip below states the real, verified outcome (not
// a guess) plus the reproduction shape, so re-verifying after a future
// change to this migration is mechanical.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_FILENAME =
  '20260713000004_admin_hold_confirmed_booking_and_release_rpcs.sql'
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, MIGRATION_FILENAME)
const SIBLING_MIGRATION_PATH = resolve(
  MIGRATIONS_DIR,
  '20260713000002_admin_promote_waitlist_to_hold_rpc.sql',
)

const sql = readFileSync(MIGRATION_PATH, 'utf-8')
const siblingSql = readFileSync(SIBLING_MIGRATION_PATH, 'utf-8')

const executableSql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

const gapAFnBody = sql.match(
  /CREATE OR REPLACE FUNCTION public\.admin_hold_confirmed_booking_for_payment\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public, pg_catalog;/,
)?.[0]

const gapBFnBody = sql.match(
  /CREATE OR REPLACE FUNCTION public\.admin_revert_hold_to_waitlist\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public, pg_catalog;/,
)?.[0]

const siblingPromoteFnBody = siblingSql.match(
  /CREATE OR REPLACE FUNCTION public\.admin_promote_waitlist_to_hold\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public, pg_catalog;/,
)?.[0]

/** Strips `--` comment lines so assertions about the EXECUTABLE SQL
 *  aren't tripped up by explanatory prose in comments legitimately using
 *  the same vocabulary (e.g. a comment explaining "deliberately no
 *  capacity check" or naming a sibling RPC by way of contrast). Mirrors
 *  the top-level `executableSql` derivation, scoped to a single isolated
 *  function body. */
function stripComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

const gapAExecutable = gapAFnBody ? stripComments(gapAFnBody) : undefined
const gapBExecutable = gapBFnBody ? stripComments(gapBFnBody) : undefined

// ════════════════════════════════════════════════════════════════════════════
// Sanity
// ════════════════════════════════════════════════════════════════════════════

describe('migration file sanity', () => {
  it('both function bodies were found by the isolating regex', () => {
    expect(gapAFnBody, 'gapAFnBody not found — regex likely drifted').toBeTruthy()
    expect(gapBFnBody, 'gapBFnBody not found — regex likely drifted').toBeTruthy()
    expect(siblingPromoteFnBody, 'sibling admin_promote_waitlist_to_hold body not found').toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1a — admin_hold_confirmed_booking_for_payment: signature, security
// ════════════════════════════════════════════════════════════════════════════

describe('admin_hold_confirmed_booking_for_payment — signature and security posture', () => {
  it('declares the exact signature (uuid, integer, timestamptz) RETURNS jsonb', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_hold_confirmed_booking_for_payment\(\s*\n\s*p_booking_id\s+uuid,\s*\n\s*p_booking_fee_pence\s+integer,\s*\n\s*p_hold_expires_at\s+timestamptz/,
    )
    expect(gapAFnBody!).toMatch(/RETURNS jsonb AS \$\$/)
  })

  it('INVARIANT: is SECURITY DEFINER with search_path = public, pg_catalog (matches its sibling family)', () => {
    expect(gapAFnBody!).toMatch(/LANGUAGE plpgsql SECURITY DEFINER/)
    expect(gapAFnBody!).toMatch(/SET search_path = public, pg_catalog/)
  })

  it('INVARIANT: admin gate checks profiles.role = \'admin\' via auth.uid() — is the FIRST check, before the booking lock', () => {
    expect(gapAFnBody!).toMatch(
      /SELECT EXISTS \(\s*\n\s*SELECT 1 FROM public\.profiles\s*\n\s*WHERE id = auth\.uid\(\) AND role = 'admin'\s*\n\s*\) INTO v_is_admin;/,
    )
    expect(gapAFnBody!).toMatch(
      /IF NOT v_is_admin THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Admin access required'\);/,
    )
    const gateIdx = gapAFnBody!.indexOf('IF NOT v_is_admin THEN')
    const lockIdx = gapAFnBody!.indexOf('FOR UPDATE')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(lockIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(lockIdx)
  })

  it('REVOKEs EXECUTE FROM PUBLIC and GRANTs ONLY to authenticated (never anon, never service_role)', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.admin_hold_confirmed_booking_for_payment\(uuid, integer, timestamptz\) FROM PUBLIC;/,
    )
    expect(sql).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.admin_hold_confirmed_booking_for_payment\(uuid, integer, timestamptz\) TO authenticated;/,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*admin_hold_confirmed_booking_for_payment[^\n]*\bTO\b[^\n]*\banon\b/i,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*admin_hold_confirmed_booking_for_payment[^\n]*\bTO\b[^\n]*\bservice_role\b/i,
    )
  })

  it('error-shape convention: returns jsonb_build_object errors, never RAISE EXCEPTION', () => {
    expect(gapAFnBody!).not.toMatch(/RAISE EXCEPTION/)
    expect(gapAFnBody!).toMatch(/jsonb_build_object\('error',/)
  })

  it('rejects a negative booking fee defensively', () => {
    expect(gapAFnBody!).toMatch(
      /IF p_booking_fee_pence < 0 THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Invalid booking fee'\);/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1b — admin_hold_confirmed_booking_for_payment: state-machine guards
// ════════════════════════════════════════════════════════════════════════════

describe('admin_hold_confirmed_booking_for_payment — precondition guards', () => {
  it('locks the booking row FOR UPDATE, selecting stripe_payment_id and price_at_booking alongside status (both needed by later guards)', () => {
    expect(gapAFnBody!).toMatch(
      /SELECT event_id, user_id, status, stripe_payment_id, price_at_booking/,
    )
    expect(gapAFnBody!).toMatch(
      /FROM\s+public\.bookings\s*\n\s*WHERE\s+id = p_booking_id\s*\n\s*AND\s+deleted_at IS NULL\s*\n\s*FOR UPDATE;/,
    )
  })

  it('rejects each non-confirmed status with its OWN specific message (waitlisted / pending_payment / cancelled / no_show / else)', () => {
    expect(gapAFnBody!).toMatch(/IF v_current_status != 'confirmed' THEN/)
    expect(gapAFnBody!).toMatch(
      /WHEN v_current_status = 'waitlisted'\s+THEN 'This booking is still on the waitlist — use Promote instead'/,
    )
    expect(gapAFnBody!).toMatch(
      /WHEN v_current_status = 'pending_payment' THEN 'This booking already has a payment link outstanding'/,
    )
    expect(gapAFnBody!).toMatch(
      /WHEN v_current_status = 'cancelled'\s+THEN 'This booking was cancelled'/,
    )
    expect(gapAFnBody!).toMatch(
      /WHEN v_current_status = 'no_show'\s+THEN 'This booking is marked as a no-show'/,
    )
    expect(gapAFnBody!).toMatch(/ELSE 'Only confirmed bookings can be sent a payment link'/)
  })

  it('INVARIANT (THE double-charge guard): rejects when stripe_payment_id IS NOT NULL with its OWN dedicated message and branch — separate from the status CASE above', () => {
    // Deliberately checked as ITS OWN branch, not folded into the status
    // CASE — the spec's own stated reason: sending a second payment link
    // to someone who already paid risks a duplicate charge, materially
    // worse than any status-mismatch case, so it needs a distinct,
    // unambiguous message.
    expect(gapAFnBody!).toMatch(
      /IF v_stripe_payment_id IS NOT NULL THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This booking has already been paid'\);/,
    )
    // Ordering: the double-charge guard fires AFTER the status CASE (a
    // non-confirmed row is rejected first regardless of payment id), but
    // BEFORE the event lock — i.e. this booking's own payment state is
    // checked before ever touching a second table.
    const statusCaseIdx = gapAFnBody!.indexOf("IF v_current_status != 'confirmed' THEN")
    const doubleChargeIdx = gapAFnBody!.indexOf('IF v_stripe_payment_id IS NOT NULL THEN')
    const eventLockIdx = gapAFnBody!.indexOf('FROM   public.events')
    expect(statusCaseIdx).toBeLessThan(doubleChargeIdx)
    expect(doubleChargeIdx).toBeLessThan(eventLockIdx)
  })

  it('locks the event row FOR UPDATE, rejects a cancelled event and a past event', () => {
    expect(gapAFnBody!).toMatch(
      /FROM\s+public\.events\s*\n\s*WHERE\s+id = v_event_id AND deleted_at IS NULL\s*\n\s*FOR UPDATE;/,
    )
    expect(gapAFnBody!).toMatch(
      /IF v_is_cancelled THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Event is cancelled'\);/,
    )
    expect(gapAFnBody!).toMatch(
      /IF v_event_date < now\(\) THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Event has already passed'\);/,
    )
  })

  it('rejects a FREE event ("nothing to remediate" — a confirmed seat there is already correct and final)', () => {
    expect(gapAFnBody!).toMatch(
      /IF v_price = 0 THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This is a free event — nothing to remediate'\);/,
    )
  })

  it('INVARIANT: the price_at_booking <= 0 defensive guard returns a CLEAR error, pre-empting the chk_bookings_free_no_booking_fee CHECK constraint', () => {
    expect(gapAFnBody!).toMatch(
      /IF v_price_at_booking <= 0 THEN\s*\n\s*RETURN jsonb_build_object\(\s*\n\s*'error',\s*\n\s*'This booking has no ticket price on record — cannot collect payment\. Needs manual investigation before retrying\.'/,
    )
    // Must run BEFORE the UPDATE that would otherwise trip the CHECK
    // constraint with a raw, confusing 23514.
    const guardIdx = gapAFnBody!.indexOf('IF v_price_at_booking <= 0 THEN')
    const updateIdx = gapAFnBody!.indexOf('UPDATE public.bookings')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(updateIdx)
  })

  it('INVARIANT (Addendum §A.1 — the actual point of Gap A): NO capacity check anywhere in the EXECUTABLE SQL of this function', () => {
    // Deliberately the mirror-image assertion of the sibling migration's
    // own capacity-check INVARIANT test — this function must NEVER grow
    // a capacity gate, or it would perversely block remediation on
    // exactly the at-capacity events most likely to need it. Assert the
    // absence of every capacity-check vocabulary term this RPC family
    // uses elsewhere (v_capacity, v_seat_count, COUNT(*), 'full capacity')
    // — scoped to executable SQL only, since the header comment
    // legitimately explains the omission using the word "capacity" in
    // prose (that's the DOCUMENTATION of the invariant, not a violation
    // of it).
    expect(gapAExecutable!).not.toMatch(/v_capacity/)
    expect(gapAExecutable!).not.toMatch(/v_seat_count/)
    expect(gapAExecutable!).not.toMatch(/COUNT\(\*\)/)
    expect(gapAExecutable!).not.toMatch(/full capacity/)
    expect(gapAExecutable!).not.toMatch(/\bcapacity\b/i)
  })

  it('CROSS-CHECK: the sibling admin_promote_waitlist_to_hold DOES have a capacity check — proving the omission above is a deliberate structural difference, not both functions accidentally lacking it', () => {
    expect(siblingPromoteFnBody!).toMatch(/v_capacity/)
    expect(siblingPromoteFnBody!).toMatch(/v_seat_count/)
    expect(siblingPromoteFnBody!).toMatch(/COUNT\(\*\)/)
    expect(siblingPromoteFnBody!).toMatch(/Event is at full capacity/)
  })

  it('INVARIANT: transition SET clause sets status=pending_payment, booking_fee_pence, is_admin_hold=true, admin_hold_expires_at — waitlist_position NOT in the SET list (a confirmed booking never carries one)', () => {
    const updateMatch = gapAFnBody!.match(
      /UPDATE public\.bookings\s*\n\s*SET([\s\S]*?)WHERE\s+id\s+=\s+p_booking_id/,
    )
    expect(updateMatch, 'UPDATE ... SET clause not found').toBeTruthy()
    const setClause = updateMatch![1]
    expect(setClause).toMatch(/status\s*=\s*'pending_payment'/)
    expect(setClause).toMatch(/booking_fee_pence\s*=\s*p_booking_fee_pence/)
    expect(setClause).toMatch(/is_admin_hold\s*=\s*true/)
    expect(setClause).toMatch(/admin_hold_expires_at\s*=\s*p_hold_expires_at/)
    expect(setClause).not.toMatch(/waitlist_position/)
  })

  it('the transition UPDATE re-guards WHERE status=\'confirmed\' AND stripe_payment_id IS NULL (belt-and-braces beyond the row lock — closes the exact race the double-charge guard exists for)', () => {
    expect(gapAFnBody!).toMatch(
      /WHERE\s+id\s+=\s+p_booking_id\s*\n\s*AND\s+status\s+=\s+'confirmed'\s*\n\s*AND\s+stripe_payment_id IS NULL;/,
    )
  })

  it('success response echoes booking_id, user_id, status=pending_payment', () => {
    expect(gapAFnBody!).toMatch(
      /RETURN jsonb_build_object\(\s*\n\s*'booking_id', p_booking_id,\s*\n\s*'user_id',\s+v_user_id,\s*\n\s*'status',\s+'pending_payment'\s*\n\s*\);/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1c — admin_revert_hold_to_waitlist: signature, security
// ════════════════════════════════════════════════════════════════════════════

describe('admin_revert_hold_to_waitlist — signature and security posture', () => {
  it('declares the exact signature (uuid) RETURNS jsonb', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_revert_hold_to_waitlist\(\s*\n\s*p_booking_id uuid\s*\n\)\s*\nRETURNS jsonb AS \$\$/,
    )
  })

  it('INVARIANT: is SECURITY DEFINER with search_path = public, pg_catalog', () => {
    expect(gapBFnBody!).toMatch(/LANGUAGE plpgsql SECURITY DEFINER/)
    expect(gapBFnBody!).toMatch(/SET search_path = public, pg_catalog/)
  })

  it('INVARIANT: admin gate is the FIRST check, before the booking lock', () => {
    expect(gapBFnBody!).toMatch(
      /IF NOT v_is_admin THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Admin access required'\);/,
    )
    const gateIdx = gapBFnBody!.indexOf('IF NOT v_is_admin THEN')
    const lockIdx = gapBFnBody!.indexOf('FOR UPDATE')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(lockIdx)
  })

  it('REVOKEs EXECUTE FROM PUBLIC and GRANTs ONLY to authenticated (never anon, never service_role)', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.admin_revert_hold_to_waitlist\(uuid\) FROM PUBLIC;/,
    )
    expect(sql).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.admin_revert_hold_to_waitlist\(uuid\) TO authenticated;/,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*admin_revert_hold_to_waitlist[^\n]*\bTO\b[^\n]*\banon\b/i,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*admin_revert_hold_to_waitlist[^\n]*\bTO\b[^\n]*\bservice_role\b/i,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1d — admin_revert_hold_to_waitlist: origin-agnostic revert logic
// ════════════════════════════════════════════════════════════════════════════

describe('admin_revert_hold_to_waitlist — origin-agnostic revert logic', () => {
  it('INVARIANT: eligibility predicate is is_admin_hold AND status=pending_payment — no reference to ANY origin-distinguishing column or value in the EXECUTABLE SQL', () => {
    expect(gapBFnBody!).toMatch(
      /IF NOT v_is_hold OR v_status != 'pending_payment' THEN/,
    )
    // Neither RPC name that could have created the hold is referenced in
    // the actual logic — the predicate genuinely doesn't need to know
    // which flow it came from (Addendum §B.1). Scoped to executable SQL
    // only: the header comment legitimately NAMES both sibling RPCs in
    // prose to explain why the predicate is origin-agnostic — that's the
    // documentation of the invariant, not a violation of it.
    expect(gapBExecutable!).not.toMatch(/admin_promote_waitlist_to_hold/)
    expect(gapBExecutable!).not.toMatch(/admin_hold_confirmed_booking_for_payment/)
  })

  it('the not-an-active-hold rejection uses the specific combined message', () => {
    expect(gapBFnBody!).toMatch(
      /'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted\.'/,
    )
  })

  it('INVARIANT: the transition ALWAYS sets status=\'waitlisted\' — the literal string \'confirmed\' never appears as a SET target anywhere in this function', () => {
    const updateMatch = gapBFnBody!.match(
      /UPDATE public\.bookings\s*\n\s*SET([\s\S]*?)WHERE\s+id\s*=\s*p_booking_id/,
    )
    expect(updateMatch, 'UPDATE ... SET clause not found').toBeTruthy()
    const setClause = updateMatch![1]
    expect(setClause).toMatch(/status\s*=\s*'waitlisted'/)
    expect(setClause).not.toMatch(/'confirmed'/)
    expect(setClause).toMatch(/is_admin_hold\s*=\s*false/)
    expect(setClause).toMatch(/admin_hold_expires_at\s*=\s*NULL/)
  })

  it('the transition UPDATE re-guards WHERE status=\'pending_payment\' AND is_admin_hold=true (belt-and-braces beyond the row lock — also what makes the DB-first Stripe-expire ordering safe, Addendum §B.2)', () => {
    expect(gapBFnBody!).toMatch(
      /WHERE\s+id\s+=\s+p_booking_id\s*\n\s*AND\s+status\s+=\s+'pending_payment'\s*\n\s*AND\s+is_admin_hold\s+=\s+true;/,
    )
  })

  it('calls recompute_waitlist_positions(v_event_id) AFTER the UPDATE (spec §2.3 worked example — a reverted row\'s frozen waitlist_position can collide with positions reassigned while it was held)', () => {
    expect(gapBFnBody!).toMatch(/PERFORM public\.recompute_waitlist_positions\(v_event_id\);/)
    const updateIdx = gapBFnBody!.lastIndexOf('UPDATE public.bookings')
    const recomputeIdx = gapBFnBody!.indexOf('PERFORM public.recompute_waitlist_positions')
    expect(updateIdx).toBeGreaterThan(-1)
    expect(recomputeIdx).toBeGreaterThan(updateIdx)
  })

  it('does NOT re-derive the row\'s FINAL waitlist_position until after the recompute call (selects it fresh, doesn\'t echo a stale value)', () => {
    const recomputeIdx = gapBFnBody!.indexOf('PERFORM public.recompute_waitlist_positions')
    const selectPositionIdx = gapBFnBody!.indexOf('SELECT waitlist_position INTO v_new_position')
    expect(selectPositionIdx).toBeGreaterThan(recomputeIdx)
  })

  it('INVARIANT: there is NO event_date < now() guard — releasing a hold must work for a past event too (spec\'s own explicit "no guard, deliberately" note)', () => {
    // Distinguishes this function from BOTH admin_promote_waitlist_to_hold
    // and admin_hold_confirmed_booking_for_payment, which both reject a
    // past event. Absence, not presence, is the thing to pin here.
    expect(gapBFnBody!).not.toMatch(/event_date < now\(\)/)
    expect(gapBFnBody!).not.toMatch(/already passed/)
  })

  it('success response echoes booking_id, event_id, status=waitlisted, waitlist_position', () => {
    expect(gapBFnBody!).toMatch(
      /RETURN jsonb_build_object\(\s*\n\s*'booking_id',\s*p_booking_id,\s*\n\s*'event_id',\s*v_event_id,\s*\n\s*'status',\s*'waitlisted',\s*\n\s*'waitlist_position',\s*v_new_position\s*\n\s*\);/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 2 — migration-wide cross-checks (header's own claims, verified)
// ════════════════════════════════════════════════════════════════════════════

describe('migration-wide invariants', () => {
  it('INVARIANT: adds ZERO new columns and ZERO new CHECK constraints — both gaps rely entirely on columns/constraints already shipped in 20260713000001', () => {
    expect(executableSql).not.toMatch(/ALTER TABLE/i)
    expect(executableSql).not.toMatch(/ADD COLUMN/i)
    expect(executableSql).not.toMatch(/ADD CONSTRAINT/i)
  })

  it('does not touch admin_promote_waitlist_to_hold\'s own SQL body (no CREATE OR REPLACE for it in this file)', () => {
    expect(executableSql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.admin_promote_waitlist_to_hold/)
  })

  it('does not create or reference the still-deferred revert_expired_admin_holds cron function or its migration', () => {
    expect(executableSql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.revert_expired_admin_holds/)
    expect(executableSql).not.toMatch(/cron\.schedule/)
  })

  it('exactly two CREATE OR REPLACE FUNCTION statements in this migration (no stray extra objects)', () => {
    const matches = executableSql.match(/CREATE OR REPLACE FUNCTION/g) ?? []
    expect(matches.length).toBe(2)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 3 — DB-integration cases. VERIFIED against a real, disposable
// local Postgres 18 instance during this tester pass (see file header).
// Kept `it.skip` to match this codebase's established convention for
// non-CI-reachable DB tests — each case states the ACTUAL verified
// outcome, not a hypothesis.
// ════════════════════════════════════════════════════════════════════════════

describe('DB integration — admin_hold_confirmed_booking_for_payment (VERIFIED manually 2026-07-13, see tester HANDOVER)', () => {
  it.skip('non-admin authenticated caller gets {error: "Admin access required"}, row untouched — VERIFIED: exact result, plus confirmed the anon ROLE cannot even reach the function body (42501 permission denied) while authenticated (non-admin) reaches it and gets the jsonb error', async () => {
    // Reproduction: seed a member profile + a confirmed/unpaid booking on
    // a paid event, `SET app.current_user_id` (test harness's auth.uid()
    // stand-in) to the member's id, call the RPC. Result was exactly
    // {"error": "Admin access required"}; re-selecting the booking showed
    // status/is_admin_hold/stripe_payment_id all unchanged.
  })

  it.skip('rejects a booking that is waitlisted / pending_payment / cancelled / no_show, per-status message — VERIFIED: all four exact messages reproduced verbatim', async () => {
    // Reproduction: four bookings, one per status, on the same paid
    // event. Each RPC call returned the exact CASE-branch message from
    // the static test above.
  })

  it.skip('INVARIANT (THE double-charge guard): rejects a confirmed booking that already has a stripe_payment_id — VERIFIED: {"error": "This booking has already been paid"}, row COMPLETELY untouched (status, is_admin_hold, stripe_payment_id, booking_fee_pence all identical before/after)', async () => {
    // This is the single most safety-critical assertion in this whole
    // addendum. Reproduction: booking with status=confirmed AND
    // stripe_payment_id=\'pi_test_already_paid_106\' on a paid event.
    // Called as admin. Result matched exactly; a follow-up SELECT proved
    // zero columns changed.
  })

  it.skip('rejects a FREE event even for an otherwise-valid confirmed/unpaid booking — VERIFIED', async () => {})

  it.skip('INVARIANT (Addendum §A.1 — the actual point of Gap A): succeeds even when the event is AT/OVER capacity — VERIFIED: seeded a capacity=2 event with 2 CONFIRMED bookings (at capacity), remediated a third confirmed-unpaid booking on the SAME event, RPC returned {"status":"pending_payment",...} — success, capacity genuinely not checked', async () => {
    // This is the regression test that guards against a future
    // "helpfully" re-adding a capacity gate. Reproduction: capacity=2
    // paid event, two rows status=confirmed (== at capacity by this
    // codebase\'s own accounting), a THIRD confirmed-unpaid row remediated
    // successfully — final row state: pending_payment, is_admin_hold=true,
    // booking_fee_pence set to the passed value, waitlist_position still
    // NULL, stripe_payment_id still NULL.
  })

  it.skip('rejects a cancelled event and a past event, with their own messages — VERIFIED', async () => {})

  it.skip('INVARIANT: the price_at_booking<=0 defensive guard returns the clear jsonb error, NOT a raw 23514 — VERIFIED, AND separately proved the underlying CHECK constraint (chk_bookings_free_no_booking_fee) really would fire without the guard (bypassed the RPC with a raw UPDATE on the same anomalous row -> real 23514 from Postgres, confirming the guard defends a genuine trap, not a phantom one)', async () => {})

  it.skip('rejects a negative booking fee — VERIFIED', async () => {})

  it.skip('CONCURRENCY: two simultaneous remediation attempts on the SAME booking (e.g. admin double-click / two admins) — VERIFIED: session A (opened a transaction, held it open 2s) succeeded with {"status":"pending_payment",...}; session B (fired ~300ms later, blocked on the row lock, resumed after A committed) correctly re-read the now-pending_payment status and returned {"error":"This booking already has a payment link outstanding"} — never two holds, never a double-charge risk, exactly one payment link created', async () => {})

  it.skip('anon client cannot invoke the RPC at all (PostgREST 42501, not a jsonb error) — VERIFIED: SET ROLE anon; SELECT admin_hold_confirmed_booking_for_payment(...) raised "permission denied for function admin_hold_confirmed_booking_for_payment" at the SQL/grant layer, before the function body ever ran', async () => {})
})

describe('DB integration — admin_revert_hold_to_waitlist (VERIFIED manually 2026-07-13, see tester HANDOVER)', () => {
  it.skip('non-admin authenticated caller gets {error: "Admin access required"} against a REAL active hold, row untouched — VERIFIED', async () => {})

  it.skip('rejects a row that is not an active hold (confirmed/is_admin_hold=false, and waitlisted/is_admin_hold=false) with the specific message — VERIFIED both cases', async () => {})

  it.skip('INVARIANT (origin-agnostic): reverts a hold created via admin_promote_waitlist_to_hold to waitlisted — VERIFIED: {"status":"waitlisted","waitlist_position":1,...}, is_admin_hold cleared to false, admin_hold_expires_at cleared to NULL', async () => {})

  it.skip('INVARIANT (origin-agnostic, THE critical one): reverts a hold created via admin_hold_confirmed_booking_for_payment to waitlisted — NEVER confirmed — VERIFIED: {"status":"waitlisted",...}, both hold columns cleared, confirmed the literal string \'confirmed\' never appeared in the result or the post-revert row state', async () => {})

  it.skip('idempotency: reverting an already-reverted (now non-hold) row a second time fails cleanly with the not-an-active-hold message — VERIFIED', async () => {})

  it.skip('THE WORKED EXAMPLE (spec §2.3): A(pos1) B(pos2) C(pos3) waitlisted -> promote A to a hold (position frozen at 1) -> B leaves + recompute (C becomes position 1) -> A\'s hold reverts -> NO DUPLICATE positions afterward — VERIFIED EXACTLY: final state was A=1, C=2 (tie broken by booked_at ASC, A joined the queue earlier than C), count(*)=count(DISTINCT waitlist_position)=2, confirming the recompute-after-revert closes the duplicate-position trap the spec describes', async () => {})

  it.skip('no event_date < now() guard — releasing a hold works even for a PAST event — VERIFIED: reverted a hold on an already-past event successfully', async () => {})

  it.skip('anon client cannot invoke the RPC at all (PostgREST 42501) — VERIFIED', async () => {})
})

describe('DB integration — both CHECK constraints from 20260713000001 still hold with these two new write paths in the mix (VERIFIED manually 2026-07-13)', () => {
  it.skip('chk_bookings_admin_hold_requires_pending_payment still fires (23514) for a raw UPDATE setting is_admin_hold=true on a status != pending_payment row, bypassing both new RPCs — VERIFIED', async () => {})

  it.skip('chk_bookings_admin_hold_expiry_requires_flag still fires (23514) for a raw UPDATE setting admin_hold_expires_at non-null with is_admin_hold=false, bypassing both new RPCs — VERIFIED', async () => {})
})
