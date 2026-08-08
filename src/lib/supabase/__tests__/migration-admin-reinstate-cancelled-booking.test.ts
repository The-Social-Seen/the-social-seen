// Coverage for migration
// `20260808000003_admin_reinstate_cancelled_booking_rpcs.sql` — "Gap C" in
// the admin waitlist-promotion / payment-remediation lineage
// (SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md). Two new RPCs:
//
//   `admin_reinstate_cancelled_booking_for_payment` — reinstates an
//   eligible reaped `cancelled` booking (§1.5's six-condition + two
//   cross-row eligibility predicate, safety-critical: this is what
//   prevents an admin from accidentally reinstating a booking for a
//   member who deleted their account, or one that was cancelled as part
//   of an event cancellation) to `pending_payment` for a fresh payment
//   link, WITH a capacity re-check (unlike Gap A, which deliberately skips
//   it — this origin IS a new admission, the seat was genuinely released).
//
//   `admin_release_reinstated_hold_to_cancelled` — the mandatory manual
//   release path for this origin, reverting to `cancelled` (never
//   `waitlisted` — this booking was never on the waitlist this cycle).
//
// Plus a one-line hardening guard (`AND cancelled_at IS NULL`) added to
// the EXISTING `admin_revert_hold_to_waitlist` (Gap B) via CREATE OR
// REPLACE, making the two release RPCs mutually exclusive by construction.
//
// ── Layers (mirrors migration-admin-hold-confirmed-booking-and-release.test.ts
//    / migration-admin-promote-waitlist-to-hold.test.ts in this same directory) ──
//
// Layer 1 — Migration-text static assertions. No DB required. Always run
// in CI.
//
// Layer 2 — Cross-checks: this migration's CREATE OR REPLACE of
// admin_revert_hold_to_waitlist diverges from its ORIGINAL shipped body
// (20260713000004) by exactly the one intended guard clause, nothing
// else.
//
// Layer 3 — DB-integration cases. No Docker in this build environment
// (`docker` is not installed in this sandbox at all, not merely
// unreachable — confirmed via `which docker` returning nothing;
// `supabase start` was not attempted since the CLI itself needs Docker),
// so these are NOT part of the CI/dev toolchain and are kept `it.skip` —
// matching this codebase's established convention for DB-integration
// tests when a real Postgres isn't reachable (see
// migration-admin-promote-waitlist-to-hold.test.ts in this same
// directory).
//
// Each case below WAS run once, manually, in an ad hoc, disposable local
// Postgres 18 instance (Homebrew `postgresql@18`) during this development
// pass, moments before this file was written: all 63 real migration files
// were applied to a scratch database verbatim, with ONLY the
// pg_cron/pg_net/supabase_vault scheduling tail truncated from 4 files
// (20260421000004, 20260514070757, 20260515095343, 20260808000002 — each
// truncated at its own `CREATE EXTENSION IF NOT EXISTS pg_cron` line,
// preserving every function definition above that line) and ONE
// storage-bucket seed migration skipped entirely (20260402000013 —
// references `storage.buckets`/`storage.objects`, which nothing in this
// feature's schema depends on, confirmed by grep). A minimal `auth` schema
// stub (`auth.users`, a session-GUC-driven `auth.uid()` reading
// `app.current_user_id`) stood in for Supabase Auth; `anon`/
// `authenticated`/`service_role` roles were created to match the
// GRANT/REVOKE statements.
//
// IMPORTANT HONESTY NOTE: this manual run is NOT re-runnable or
// independently re-verifiable from this repo — no harness script for that
// scratch-DB setup was committed (out of this tester's scope; flagged in
// the HANDOVER for the backend-developer/reviewer to decide whether it's
// worth productionising into `supabase start`-independent CI coverage).
// The outcomes described in each skip below are recorded as documentation
// of the ONE-TIME observed/reported behaviour during this pass — not as
// settled, reproducible proof, and not as something CI or a future
// reviewer can currently re-run to confirm. Treat every "reported"
// annotation below the same way you'd treat a manual tester's notes:
// useful evidence, but pending a real re-runnable harness before being
// relied on as a guarantee. (Separately, code review independently
// confirmed the underlying RPC SQL implements the claimed guards by
// reading the migration text directly — that static confirmation is real
// and captured in Layers 1–2 above, which DO run in CI.)

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_FILENAME = '20260808000003_admin_reinstate_cancelled_booking_rpcs.sql'
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, MIGRATION_FILENAME)
const ORIGINAL_REVERT_MIGRATION_PATH = resolve(
  MIGRATIONS_DIR,
  '20260713000004_admin_hold_confirmed_booking_and_release_rpcs.sql',
)

const sql = readFileSync(MIGRATION_PATH, 'utf-8')
const originalRevertSql = readFileSync(ORIGINAL_REVERT_MIGRATION_PATH, 'utf-8')

const executableSql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

function stripComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

const reinstateFnBody = sql.match(
  /CREATE OR REPLACE FUNCTION public\.admin_reinstate_cancelled_booking_for_payment\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public, pg_catalog;/,
)?.[0]

const releaseFnBody = sql.match(
  /CREATE OR REPLACE FUNCTION public\.admin_release_reinstated_hold_to_cancelled\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public, pg_catalog;/,
)?.[0]

const hardenedRevertFnBody = sql.match(
  /CREATE OR REPLACE FUNCTION public\.admin_revert_hold_to_waitlist\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public, pg_catalog;/,
)?.[0]

const originalRevertFnBody = originalRevertSql.match(
  /CREATE OR REPLACE FUNCTION public\.admin_revert_hold_to_waitlist\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public, pg_catalog;/,
)?.[0]

const releaseExecutable = releaseFnBody ? stripComments(releaseFnBody) : undefined

// ════════════════════════════════════════════════════════════════════════════
// Sanity
// ════════════════════════════════════════════════════════════════════════════

describe('migration file sanity', () => {
  it('all three function bodies were found by the isolating regexes', () => {
    expect(reinstateFnBody, 'reinstateFnBody not found — regex likely drifted').toBeTruthy()
    expect(releaseFnBody, 'releaseFnBody not found — regex likely drifted').toBeTruthy()
    expect(hardenedRevertFnBody, 'hardenedRevertFnBody not found — regex likely drifted').toBeTruthy()
    expect(originalRevertFnBody, 'originalRevertFnBody (20260713000004) not found').toBeTruthy()
  })

  it('header states plainly: zero new columns, zero new enum values, zero RLS changes', () => {
    expect(sql).toMatch(/Zero new columns\. Zero new enum values\. Zero RLS policy changes\./)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1a — admin_reinstate_cancelled_booking_for_payment: signature, security
// ════════════════════════════════════════════════════════════════════════════

describe('admin_reinstate_cancelled_booking_for_payment — signature and security posture', () => {
  it('declares the exact signature (uuid, integer, timestamptz) RETURNS jsonb', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_reinstate_cancelled_booking_for_payment\(\s*\n\s*p_booking_id\s+uuid,\s*\n\s*p_booking_fee_pence\s+integer,\s*\n\s*p_hold_expires_at\s+timestamptz/,
    )
    expect(reinstateFnBody!).toMatch(/RETURNS jsonb AS \$\$/)
  })

  it('INVARIANT: is SECURITY DEFINER with search_path = public, pg_catalog', () => {
    expect(reinstateFnBody!).toMatch(/LANGUAGE plpgsql SECURITY DEFINER/)
    expect(reinstateFnBody!).toMatch(/SET search_path = public, pg_catalog/)
  })

  it('INVARIANT: admin gate checks profiles.role = \'admin\' via auth.uid() — is the FIRST check, before the booking lock', () => {
    expect(reinstateFnBody!).toMatch(
      /SELECT EXISTS \(\s*\n\s*SELECT 1 FROM public\.profiles WHERE id = auth\.uid\(\) AND role = 'admin'\s*\n\s*\) INTO v_is_admin;/,
    )
    expect(reinstateFnBody!).toMatch(
      /IF NOT v_is_admin THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Admin access required'\);/,
    )
    const gateIdx = reinstateFnBody!.indexOf('IF NOT v_is_admin THEN')
    const lockIdx = reinstateFnBody!.indexOf('FOR UPDATE')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(lockIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(lockIdx)
  })

  it('REVOKEs EXECUTE FROM PUBLIC and GRANTs ONLY to authenticated (never anon, never service_role)', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.admin_reinstate_cancelled_booking_for_payment\(uuid, integer, timestamptz\) FROM PUBLIC;/,
    )
    expect(sql).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.admin_reinstate_cancelled_booking_for_payment\(uuid, integer, timestamptz\) TO authenticated;/,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*admin_reinstate_cancelled_booking_for_payment[^\n]*\bTO\b[^\n]*\banon\b/i,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*admin_reinstate_cancelled_booking_for_payment[^\n]*\bTO\b[^\n]*\bservice_role\b/i,
    )
  })

  it('error-shape convention: returns jsonb_build_object errors, never RAISE EXCEPTION', () => {
    expect(reinstateFnBody!).not.toMatch(/RAISE EXCEPTION/)
    expect(reinstateFnBody!).toMatch(/jsonb_build_object\('error',/)
  })

  it('rejects a negative booking fee defensively', () => {
    expect(reinstateFnBody!).toMatch(
      /IF p_booking_fee_pence < 0 THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Invalid booking fee'\);/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1b — the eligibility predicate (§1.5) — every branch, in order
// ════════════════════════════════════════════════════════════════════════════

describe('admin_reinstate_cancelled_booking_for_payment — eligibility predicate (§1.5)', () => {
  it('locks the booking row FOR UPDATE, selecting every column the predicate needs', () => {
    expect(reinstateFnBody!).toMatch(
      /SELECT event_id, user_id, status, cancelled_at, cancellation_reason,\s*\n\s*stripe_payment_id, refunded_amount_pence, is_admin_hold, price_at_booking/,
    )
    expect(reinstateFnBody!).toMatch(
      /FROM\s+public\.bookings\s*\n\s*WHERE\s+id = p_booking_id AND deleted_at IS NULL\s*\n\s*FOR UPDATE;/,
    )
  })

  it('rejects a non-cancelled status', () => {
    expect(reinstateFnBody!).toMatch(
      /IF v_current_status != 'cancelled' THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Only cancelled bookings can be reinstated'\);/,
    )
  })

  it('INVARIANT: rejects cancelled_at IS NULL (excludes createPaidCheckout/abandonPendingCheckout rollback shape — never actually a reap)', () => {
    expect(reinstateFnBody!).toMatch(
      /IF v_cancelled_at IS NULL THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This booking was not cancelled by the automatic payment timeout — cannot reinstate'\);/,
    )
  })

  it('INVARIANT: rejects cancellation_reason IS NOT NULL (excludes cancelEventAndRefundBookings — the event-cancellation origin, always sets a reason)', () => {
    expect(reinstateFnBody!).toMatch(
      /IF v_cancellation_reason IS NOT NULL THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This booking was cancelled as part of an event cancellation — cannot reinstate'\);/,
    )
  })

  it('rejects stripe_payment_id IS NOT NULL (never reinstate around an existing payment record)', () => {
    expect(reinstateFnBody!).toMatch(
      /IF v_stripe_payment_id IS NOT NULL THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This booking has a payment record — cannot reinstate'\);/,
    )
  })

  it('rejects refunded_amount_pence > 0', () => {
    expect(reinstateFnBody!).toMatch(
      /IF v_refunded_pence > 0 THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This booking was refunded — cannot reinstate'\);/,
    )
  })

  it('rejects is_admin_hold = true (belt-and-braces — structurally unreachable on a cancelled row per chk_bookings_admin_hold_requires_pending_payment, checked explicitly anyway)', () => {
    expect(reinstateFnBody!).toMatch(
      /IF v_is_admin_hold THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This booking is already an active hold'\);/,
    )
  })

  it('rejects a free-event-shaped booking (price_at_booking IS NULL OR <= 0)', () => {
    expect(reinstateFnBody!).toMatch(
      /IF v_price_at_booking IS NULL OR v_price_at_booking <= 0 THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This is a free-event booking — reinstate by re-booking directly, not via this tool'\);/,
    )
  })

  it('INVARIANT (§1.4): rejects when another active (non-cancelled) booking exists for the same member+event', () => {
    expect(reinstateFnBody!).toMatch(
      /SELECT EXISTS \(\s*\n\s*SELECT 1 FROM public\.bookings\s*\n\s*WHERE event_id = v_event_id AND user_id = v_user_id\s*\n\s*AND id != p_booking_id AND status != 'cancelled' AND deleted_at IS NULL\s*\n\s*\) INTO v_other_active;/,
    )
    expect(reinstateFnBody!).toMatch(
      /IF v_other_active THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This member already has an active booking for this event'\);/,
    )
  })

  it('INVARIANT (§1.3 — THE finding, the single most important check in this migration): rejects when the owning profile is soft-deleted', () => {
    expect(reinstateFnBody!).toMatch(
      /SELECT deleted_at, status INTO v_profile_deleted_at, v_profile_status\s*\n\s*FROM public\.profiles WHERE id = v_user_id;/,
    )
    expect(reinstateFnBody!).toMatch(
      /IF v_profile_deleted_at IS NOT NULL THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This member''s account has been deleted — cannot reinstate'\);/,
    )
  })

  it('INVARIANT: rejects a suspended/banned member (profiles.status != \'active\') — the guard added after the design doc was written, confirmed present in the CURRENT file', () => {
    expect(reinstateFnBody!).toMatch(
      /IF v_profile_status != 'active' THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This member''s account is suspended or banned — cannot reinstate'\);/,
    )
  })

  it('ordering: profile checks (deleted_at, status) run AFTER the other-active-booking check but BEFORE the event lock', () => {
    const otherActiveIdx = reinstateFnBody!.indexOf('IF v_other_active THEN')
    const profileDeletedIdx = reinstateFnBody!.indexOf("IF v_profile_deleted_at IS NOT NULL THEN")
    const profileStatusIdx = reinstateFnBody!.indexOf("IF v_profile_status != 'active' THEN")
    const eventLockIdx = reinstateFnBody!.indexOf('FROM   public.events')
    expect(otherActiveIdx).toBeLessThan(profileDeletedIdx)
    expect(profileDeletedIdx).toBeLessThan(profileStatusIdx)
    expect(profileStatusIdx).toBeLessThan(eventLockIdx)
  })

  it('locks the event row FOR UPDATE, rejects a cancelled event, a past event, and a NOW-free event (price=0)', () => {
    expect(reinstateFnBody!).toMatch(
      /FROM\s+public\.events\s*\n\s*WHERE\s+id = v_event_id AND deleted_at IS NULL\s*\n\s*FOR UPDATE;/,
    )
    expect(reinstateFnBody!).toMatch(
      /IF v_is_cancelled_event THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Event is cancelled'\);/,
    )
    expect(reinstateFnBody!).toMatch(
      /IF v_event_date < now\(\) THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Event has already passed'\);/,
    )
    expect(reinstateFnBody!).toMatch(
      /IF v_price = 0 THEN\s*\n\s*RETURN jsonb_build_object\('error', 'This is now a free event — reinstate by re-booking directly, not via this tool'\);/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1c — capacity re-check (§2) — the structural MIRROR of Gap A's own
// deliberate absence, proven by cross-referencing that this RPC DOES have
// what admin_hold_confirmed_booking_for_payment deliberately lacks.
// ════════════════════════════════════════════════════════════════════════════

describe('admin_reinstate_cancelled_booking_for_payment — capacity re-check (§2, unlike Gap A)', () => {
  it("INVARIANT: capacity check counts status IN ('confirmed', 'pending_payment') — same convention as admin_promote_waitlist_to_hold and event_with_stats", () => {
    expect(reinstateFnBody!).toMatch(
      /WHERE event_id = v_event_id AND status IN \('confirmed', 'pending_payment'\) AND deleted_at IS NULL;/,
    )
  })

  it('capacity check is skipped entirely when v_capacity IS NULL (unlimited-capacity events)', () => {
    expect(reinstateFnBody!).toMatch(/IF v_capacity IS NOT NULL THEN/)
  })

  it("rejects when seat_count >= capacity — 'Event is at full capacity — cannot reinstate'", () => {
    expect(reinstateFnBody!).toMatch(
      /IF v_seat_count >= v_capacity THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Event is at full capacity — cannot reinstate'\);/,
    )
  })

  it('the capacity SELECT happens AFTER the event FOR UPDATE lock (closes the TOCTOU race — same mechanism as admin_promote_waitlist_to_hold)', () => {
    const eventLockIdx = reinstateFnBody!.indexOf(
      'FOR UPDATE;',
      reinstateFnBody!.indexOf('FROM   public.events'),
    )
    const capacitySelectIdx = reinstateFnBody!.indexOf('SELECT COUNT(*)')
    expect(eventLockIdx).toBeGreaterThan(-1)
    expect(capacitySelectIdx).toBeGreaterThan(-1)
    expect(eventLockIdx).toBeLessThan(capacitySelectIdx)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1d — state transition (§3) — cancelled_at/cancellation_reason MUST
// be preserved, not cleared (the origin-marker mechanism)
// ════════════════════════════════════════════════════════════════════════════

describe('admin_reinstate_cancelled_booking_for_payment — state transition (§3.1/§3.2)', () => {
  it('INVARIANT: transition SET clause sets status/booking_fee_pence/is_admin_hold/admin_hold_expires_at — cancelled_at and cancellation_reason are NOT in the SET list (deliberately preserved)', () => {
    const updateMatch = reinstateFnBody!.match(
      /UPDATE public\.bookings\s*\n\s*SET([\s\S]*?)WHERE\s+id\s*=\s*p_booking_id/,
    )
    expect(updateMatch, 'UPDATE ... SET clause not found').toBeTruthy()
    const setClause = updateMatch![1]
    expect(setClause).toMatch(/status\s*=\s*'pending_payment'/)
    expect(setClause).toMatch(/booking_fee_pence\s*=\s*p_booking_fee_pence/)
    expect(setClause).toMatch(/is_admin_hold\s*=\s*true/)
    expect(setClause).toMatch(/admin_hold_expires_at\s*=\s*p_hold_expires_at/)
    expect(setClause).not.toMatch(/cancelled_at/)
    expect(setClause).not.toMatch(/cancellation_reason/)
  })

  it('the transition UPDATE re-guards WHERE status = \'cancelled\' (belt-and-braces beyond the row lock)', () => {
    expect(reinstateFnBody!).toMatch(
      /WHERE\s+id\s*=\s*p_booking_id AND status\s*=\s*'cancelled';/,
    )
  })

  it("success response echoes booking_id, user_id, status='pending_payment'", () => {
    expect(reinstateFnBody!).toMatch(
      /RETURN jsonb_build_object\('booking_id', p_booking_id, 'user_id', v_user_id, 'status', 'pending_payment'\);/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1e — admin_release_reinstated_hold_to_cancelled: signature, security,
// eligibility, transition
// ════════════════════════════════════════════════════════════════════════════

describe('admin_release_reinstated_hold_to_cancelled — signature, security, and revert-to-cancelled logic', () => {
  it('declares the exact signature (uuid) RETURNS jsonb', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_release_reinstated_hold_to_cancelled\(\s*\n\s*p_booking_id uuid\s*\n\)\s*\nRETURNS jsonb AS \$\$/,
    )
  })

  it('INVARIANT: is SECURITY DEFINER with search_path = public, pg_catalog', () => {
    expect(releaseFnBody!).toMatch(/LANGUAGE plpgsql SECURITY DEFINER/)
    expect(releaseFnBody!).toMatch(/SET search_path = public, pg_catalog/)
  })

  it('INVARIANT: admin gate is the FIRST check, before the booking lock', () => {
    expect(releaseFnBody!).toMatch(
      /IF NOT v_is_admin THEN\s*\n\s*RETURN jsonb_build_object\('error', 'Admin access required'\);/,
    )
    const gateIdx = releaseFnBody!.indexOf('IF NOT v_is_admin THEN')
    const lockIdx = releaseFnBody!.indexOf('FOR UPDATE')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(lockIdx)
  })

  it('REVOKEs EXECUTE FROM PUBLIC and GRANTs ONLY to authenticated', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.admin_release_reinstated_hold_to_cancelled\(uuid\) FROM PUBLIC;/,
    )
    expect(sql).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.admin_release_reinstated_hold_to_cancelled\(uuid\) TO authenticated;/,
    )
    expect(executableSql).not.toMatch(
      /GRANT[^\n]*admin_release_reinstated_hold_to_cancelled[^\n]*\bTO\b[^\n]*\banon\b/i,
    )
  })

  it("INVARIANT (positive mirror of admin_revert_hold_to_waitlist's hardening): eligibility guard REQUIRES cancelled_at IS NOT NULL — this RPC can ONLY ever touch a reinstated-cancelled-origin hold", () => {
    expect(releaseFnBody!).toMatch(
      /IF NOT v_is_hold OR v_status != 'pending_payment' OR v_cancelled_at IS NULL THEN/,
    )
    expect(releaseFnBody!).toMatch(
      /'This booking is not an active reinstatement hold — it may have already been paid, cancelled, or released\.'/,
    )
  })

  it("INVARIANT: the transition ALWAYS sets status='cancelled' — never 'waitlisted' or 'confirmed' — and clears both hold columns", () => {
    const updateMatch = releaseFnBody!.match(
      /UPDATE public\.bookings\s*\n\s*SET([\s\S]*?)WHERE\s+id\s*=\s*p_booking_id/,
    )
    expect(updateMatch, 'UPDATE ... SET clause not found').toBeTruthy()
    const setClause = updateMatch![1]
    expect(setClause).toMatch(/status\s*=\s*'cancelled'/)
    expect(setClause).not.toMatch(/'waitlisted'/)
    expect(setClause).not.toMatch(/'confirmed'/)
    expect(setClause).toMatch(/is_admin_hold\s*=\s*false/)
    expect(setClause).toMatch(/admin_hold_expires_at\s*=\s*NULL/)
    // cancelled_at is NOT touched by this release either (design doc
    // §4.2 — already correctly non-NULL from the original reap). Scoped
    // to the EXECUTABLE portion of the SET clause only — the raw
    // setClause capture legitimately includes a trailing `-- cancelled_at
    // untouched...` prose comment explaining this very invariant, which
    // would otherwise falsely trip a naive `.not.toMatch(/cancelled_at/)`
    // on the comment text itself.
    const setClauseExecutable = stripComments(setClause)
    expect(setClauseExecutable).not.toMatch(/cancelled_at/)
  })

  it('does NOT call recompute_waitlist_positions (design doc §4.2 — this booking was never on the waitlist this cycle, no live entry to renumber)', () => {
    expect(releaseExecutable!).not.toMatch(/recompute_waitlist_positions/)
  })

  it("success response echoes booking_id, status='cancelled'", () => {
    expect(releaseFnBody!).toMatch(
      /RETURN jsonb_build_object\('booking_id', p_booking_id, 'status', 'cancelled'\);/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 2 — admin_revert_hold_to_waitlist hardening: diverges from its
// ORIGINAL shipped body (20260713000004) by exactly the one guard clause
// ════════════════════════════════════════════════════════════════════════════

describe('admin_revert_hold_to_waitlist — hardening divergence is EXACTLY one added clause', () => {
  it('INVARIANT: the new guard adds "v_cancelled_at IS NOT NULL" to the eligibility check (mutual-exclusivity with admin_release_reinstated_hold_to_cancelled)', () => {
    expect(hardenedRevertFnBody!).toMatch(
      /IF NOT v_is_hold OR v_status != 'pending_payment' OR v_cancelled_at IS NOT NULL THEN/,
    )
  })

  it('now also selects cancelled_at alongside the pre-existing columns (needed by the new guard)', () => {
    expect(hardenedRevertFnBody!).toMatch(
      /SELECT event_id, status, is_admin_hold, cancelled_at\s*\n\s*INTO\s+v_event_id, v_status, v_is_hold, v_cancelled_at/,
    )
  })

  it('the ORIGINAL (20260713000004) body did NOT select or reference cancelled_at at all', () => {
    expect(originalRevertFnBody!).not.toMatch(/cancelled_at/)
  })

  it('the divergence is EXACTLY the cancelled_at addition — the rest of the revert-to-waitlisted logic (recompute_waitlist_positions, the SET clause, the re-guard WHERE) is textually unchanged', () => {
    // Normalise whitespace and strip out every cancelled_at-related token
    // from the NEW body, then diff against the OLD body — if anything
    // ELSE changed, this equality fails and flags scope creep in the
    // "hardening" migration beyond what the header claims.
    const normalise = (body: string) =>
      stripComments(body)
        .replace(/\s+/g, ' ')
        .trim()

    const oldNorm = normalise(originalRevertFnBody!)
    const newNorm = normalise(hardenedRevertFnBody!)

    const newWithoutCancelledAt = newNorm
      .replace(/,\s*cancelled_at/, '') // SELECT list
      .replace(/,\s*v_cancelled_at/, '') // INTO list
      .replace(/\s*OR v_cancelled_at IS NOT NULL/, '') // guard clause
      .replace(/v_cancelled_at\s+timestamptz;\s*/, '') // DECLARE line
      .replace(/\s+/g, ' ')
      .trim()

    const oldWithoutDeclareGap = oldNorm.replace(/\s+/g, ' ').trim()

    expect(newWithoutCancelledAt).toBe(oldWithoutDeclareGap)
  })

  it('CROSS-CHECK: the hardened guard is textually a no-op for the two ORIGINAL hold origins — neither admin_promote_waitlist_to_hold nor admin_hold_confirmed_booking_for_payment ever sets cancelled_at in their own transitions', () => {
    // Read both sibling creation RPCs' migration files fresh and confirm
    // their own UPDATE SET clauses never touch cancelled_at — the
    // structural reason the new guard is provably a no-op for them.
    const promoteSql = readFileSync(
      resolve(MIGRATIONS_DIR, '20260713000002_admin_promote_waitlist_to_hold_rpc.sql'),
      'utf-8',
    )
    const remediationSql = readFileSync(
      resolve(MIGRATIONS_DIR, '20260713000004_admin_hold_confirmed_booking_and_release_rpcs.sql'),
      'utf-8',
    )
    const promoteFnBody = promoteSql.match(
      /CREATE OR REPLACE FUNCTION public\.admin_promote_waitlist_to_hold\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public, pg_catalog;/,
    )?.[0]
    const remediationFnBody = remediationSql.match(
      /CREATE OR REPLACE FUNCTION public\.admin_hold_confirmed_booking_for_payment\([\s\S]*?\$\$ LANGUAGE plpgsql SECURITY DEFINER\s*\n\s*SET search_path = public, pg_catalog;/,
    )?.[0]
    expect(promoteFnBody).toBeTruthy()
    expect(remediationFnBody).toBeTruthy()

    const promoteUpdateSet = promoteFnBody!.match(
      /UPDATE public\.bookings\s*\n\s*SET([\s\S]*?)WHERE/,
    )?.[1]
    const remediationUpdateSet = remediationFnBody!.match(
      /UPDATE public\.bookings\s*\n\s*SET([\s\S]*?)WHERE/,
    )?.[1]
    expect(promoteUpdateSet).not.toMatch(/cancelled_at/)
    expect(remediationUpdateSet).not.toMatch(/cancelled_at/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 2b — migration-wide invariants
// ════════════════════════════════════════════════════════════════════════════

describe('migration-wide invariants', () => {
  it('INVARIANT: adds ZERO new columns and ZERO new CHECK constraints — reuses is_admin_hold/admin_hold_expires_at from 20260713000001', () => {
    expect(executableSql).not.toMatch(/ALTER TABLE/i)
    expect(executableSql).not.toMatch(/ADD COLUMN/i)
    expect(executableSql).not.toMatch(/ADD CONSTRAINT/i)
  })

  it('exactly three CREATE OR REPLACE FUNCTION statements in this migration', () => {
    const matches = executableSql.match(/CREATE OR REPLACE FUNCTION/g) ?? []
    expect(matches.length).toBe(3)
  })

  it('does not create or reference the still-deferred revert_expired_admin_holds cron function or its migration (design doc §6)', () => {
    expect(executableSql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.revert_expired_admin_holds/)
    expect(executableSql).not.toMatch(/cron\.schedule/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 3 — DB-integration cases. Reportedly run once, manually, against an
// ad hoc, disposable local Postgres 18 instance during this development
// pass (see file header for the full harness description and the honesty
// note — NOT re-verified in CI, no committed re-runnable harness). Kept
// `it.skip` to match this codebase's established convention for
// non-CI-reachable DB tests.
// ════════════════════════════════════════════════════════════════════════════

describe('DB integration — admin_reinstate_cancelled_booking_for_payment (reported result of a one-time manual run — see file header)', () => {
  it.skip('THE safety-critical case (design doc §1.3): a cancelled/pending_payment-shaped booking owned by a SOFT-DELETED profile is rejected — REPORTED (one-time manual run, not re-verified in CI): {"error": "This member\'s account has been deleted — cannot reinstate"}, row completely untouched (re-selected: status still \'cancelled\', is_admin_hold still false, booking_fee_pence unchanged)', async () => {
    // Reproduction: profiles row with deleted_at = now() - interval '2
    // days' (simulating deleteMyAccount's soft-delete), a bookings row
    // owned by that profile with status='cancelled', cancelled_at = now()
    // - interval '1 hour', cancellation_reason=NULL, stripe_payment_id=
    // NULL, refunded_amount_pence=0, is_admin_hold=false,
    // price_at_booking=5000, on a paid (price=5000, capacity=2), future,
    // non-cancelled event. Called
    // admin_reinstate_cancelled_booking_for_payment(bookingId, 195, NULL)
    // as a real admin session (SET app.current_user_id to the admin's
    // uuid, profiles.role='admin'). Result matched exactly.
  })

  it.skip('the newly-added suspended/banned guard: a cancelled/pending_payment-shaped booking owned by a profile with status=\'suspended\' is rejected — REPORTED (one-time manual run, not re-verified in CI): {"error": "This member\'s account is suspended or banned — cannot reinstate"}', async () => {
    // Reproduction: identical booking shape to the deleted-profile case
    // above, but owning profile has deleted_at=NULL, status='suspended'.
    // Result matched exactly.
  })

  it.skip('non-admin authenticated caller gets {error: "Admin access required"}, row untouched — REPORTED (one-time manual run, not re-verified in CI)', async () => {
    // Reproduction: SET app.current_user_id to a profile with role=
    // 'member', called the RPC against an otherwise fully-eligible
    // booking. Result: {"error": "Admin access required"}.
  })

  it.skip('booking not found (random uuid) — REPORTED (one-time manual run, not re-verified in CI): {"error": "Booking not found"}', async () => {})

  it.skip('rejects status != cancelled (tried with a confirmed row) — REPORTED (one-time manual run, not re-verified in CI): {"error": "Only cancelled bookings can be reinstated"}', async () => {})

  it.skip('rejects cancellation_reason IS NOT NULL (event-cancellation-origin shape) — REPORTED (one-time manual run, not re-verified in CI): {"error": "This booking was cancelled as part of an event cancellation — cannot reinstate"}, row left cancelled', async () => {})

  it.skip('rejects stripe_payment_id IS NOT NULL — REPORTED (one-time manual run, not re-verified in CI): {"error": "This booking has a payment record — cannot reinstate"}', async () => {})

  it.skip('rejects refunded_amount_pence > 0 (with refunded_at + stripe_refund_id set, satisfying chk_bookings_refund_consistency) — REPORTED (one-time manual run, not re-verified in CI): {"error": "This booking was refunded — cannot reinstate"}', async () => {})

  it.skip('rejects cancelled_at IS NULL (the createPaidCheckout/abandonPendingCheckout rollback shape) — REPORTED (one-time manual run, not re-verified in CI): {"error": "This booking was not cancelled by the automatic payment timeout — cannot reinstate"}', async () => {})

  it.skip('rejects a free-event-shaped booking (price_at_booking=0) — REPORTED (one-time manual run, not re-verified in CI): {"error": "This is a free-event booking — reinstate by re-booking directly, not via this tool"}', async () => {})

  it.skip('rejects is_admin_hold=true on a cancelled row — REPORTED (one-time manual run, not re-verified in CI) structurally unreachable: attempted a raw INSERT of status=cancelled + is_admin_hold=true and it was independently rejected by chk_bookings_admin_hold_requires_pending_payment (23514) BEFORE this RPC branch could even be exercised — suggesting the RPC guard is belt-and-braces, not dead code masking a reachable bug', async () => {})

  it.skip('INVARIANT (§1.4): rejects when another active booking exists for the same member+event — REPORTED (one-time manual run, not re-verified in CI): seeded a SECOND confirmed booking for the same user+event, then attempted to reinstate an OLD cancelled row for that same user+event — {"error": "This member already has an active booking for this event"}, old row stayed cancelled', async () => {})

  it.skip('rejects a cancelled event and a past event, with their own messages — REPORTED (one-time manual run, not re-verified in CI) both', async () => {})

  it.skip('rejects a NOW-free event (event.price=0, booking.price_at_booking still >0) — REPORTED (one-time manual run, not re-verified in CI): {"error": "This is now a free event — reinstate by re-booking directly, not via this tool"}', async () => {})

  it.skip('INVARIANT (design doc §2 — the capacity re-check, unlike Gap A): rejects reinstatement when confirmed+pending_payment already fill capacity — REPORTED (one-time manual run, not re-verified in CI): capacity=2 event, one confirmed + one already-reinstated pending_payment booking (2/2), a THIRD cancelled row was rejected with {"error": "Event is at full capacity — cannot reinstate"}', async () => {})

  it.skip('happy path: transitions to pending_payment, is_admin_hold=true, booking_fee_pence=p_booking_fee_pence — AND cancelled_at/cancellation_reason are PRESERVED, not cleared — REPORTED (one-time manual run, not re-verified in CI): re-selected row showed cancelled_at UNCHANGED from its pre-reinstatement value (same timestamp), cancellation_reason still NULL', async () => {})

  it.skip('CONCURRENCY (design doc §2\'s own worked scenario): two simultaneous reinstatement attempts for the LAST capacity slot on the same event — REPORTED (one-time manual run, not re-verified in CI): fired two separate psql connections concurrently (Promise.all-equivalent — two background shell processes) against a capacity=1 event with two eligible cancelled rows; exactly ONE succeeded ({"status":"pending_payment",...}), the OTHER got {"error": "Event is at full capacity — cannot reinstate"}; re-selecting both rows reportedly showed exactly one pending_payment + one still-cancelled, never two pending_payment rows for a capacity=1 event — apparently consistent with the FOR UPDATE lock on the events row serialising the two transactions', async () => {})

  it.skip('the underlying partial unique index (idx_bookings_active) apparently fires a 23505 for the exact bypass scenario the migration\'s own comment describes — REPORTED (one-time manual run, not re-verified in CI): bypassed the RPC\'s own pre-check with a raw UPDATE attempting to flip an old cancelled row to pending_payment while a second active (confirmed) row already existed for the same user+event — reportedly got a "duplicate key value violates unique constraint \\"idx_bookings_active\\"" error — consistent with the TS layer\'s scoped 23505 catch (admin-hold.ts) defending a real trap, not a phantom one, but not independently re-verified here', async () => {})

  it.skip('anon client cannot invoke the RPC at all (PostgREST-equivalent 42501 in this harness — SET ROLE anon; SELECT ...) — NOT independently re-verified this pass (the sibling migration test files already establish this pattern for the identical GRANT/REVOKE shape; this migration\'s GRANT/REVOKE statements were confirmed textually identical in form via Layer 1 above)', async () => {})
})

describe('DB integration — admin_release_reinstated_hold_to_cancelled (reported result of a one-time manual run — see file header)', () => {
  it.skip('non-admin authenticated caller gets {error: "Admin access required"} against an active reinstatement hold, row untouched — REPORTED (one-time manual run, not re-verified in CI)', async () => {})

  it.skip('booking not found — REPORTED (one-time manual run, not re-verified in CI): {"error": "Booking not found"}', async () => {})

  it.skip('rejects a row that is not an active reinstatement hold (still plain cancelled, never reinstated) — REPORTED (one-time manual run, not re-verified in CI): {"error": "This booking is not an active reinstatement hold — it may have already been paid, cancelled, or released."}', async () => {})

  it.skip('happy path: reverts an active reinstatement hold to cancelled, clears is_admin_hold and admin_hold_expires_at, does NOT touch cancelled_at — REPORTED (one-time manual run, not re-verified in CI): {"status":"cancelled",...}, re-selected row showed is_admin_hold=false, admin_hold_expires_at=NULL, cancelled_at UNCHANGED from its original (pre-reinstatement) value', async () => {})

  it.skip('THE MUTUAL-EXCLUSIVITY PAIR, direction 1: admin_revert_hold_to_waitlist (the OLD/Gap-B release RPC) REFUSES to touch a reinstated-cancelled-origin hold — REPORTED (one-time manual run, not re-verified in CI): reinstated a booking, then called admin_revert_hold_to_waitlist on it (the WRONG release RPC) — got {"error": "This booking is not an active payment hold — it may have already been paid, cancelled, or reverted."}, row stayed pending_payment/is_admin_hold=true, completely untouched', async () => {})

  it.skip('THE MUTUAL-EXCLUSIVITY PAIR, direction 2: admin_release_reinstated_hold_to_cancelled (the NEW/Gap-C release RPC) REFUSES to touch a waitlist-promotion-origin hold — REPORTED (one-time manual run, not re-verified in CI): promoted a waitlisted booking to a hold via admin_promote_waitlist_to_hold, then called admin_release_reinstated_hold_to_cancelled on it (the WRONG release RPC) — got {"error": "This booking is not an active reinstatement hold — it may have already been paid, cancelled, or released."}, row stayed pending_payment/is_admin_hold=true, untouched', async () => {})

  it.skip('REGRESSION: admin_revert_hold_to_waitlist STILL correctly releases a genuine waitlist-promotion-origin hold to waitlisted (the hardening guard is a no-op for the case it is supposed to keep working) — REPORTED (one-time manual run, not re-verified in CI): {"status":"waitlisted","waitlist_position":1,...}, is_admin_hold cleared, admin_hold_expires_at cleared', async () => {})
})
