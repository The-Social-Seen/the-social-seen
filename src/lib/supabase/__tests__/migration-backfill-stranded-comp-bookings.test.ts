// Coverage for migration
// `20260813131020_backfill_stranded_comp_bookings_zero_totals.sql` — the
// one-time, auditable, AUDIT-ONLY diagnostic for bookings potentially
// stranded by the checkout.session.completed comp-detection bug fixed
// alongside this migration in `src/app/api/stripe/webhook/route.ts`. Full
// design: docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §5.1-§5.3 (the
// still-current candidate signal) and §5.4′-§5.11′ (why this migration is
// audit-only and what happens next).
//
// ── REVISION HISTORY ────────────────────────────────────────────────────
// This migration originally paired Phase A (audit/log) with a Phase B
// (automatic UPDATE zeroing price_at_booking/booking_fee_pence for every
// matched row). Phase B was BLOCKED in code review (see the design doc's
// "Addendum"): the 5-condition signal is not uniquely diagnostic of a
// genuine £0 comp — it is indistinguishable, from DB signals alone, from a
// row produced by the still-open, unpatched Exploit A in
// docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md (any member
// can PATCH their own booking's status to 'confirmed' via a direct
// authenticated REST call). Phase B and its trailing verify-SELECT have
// been deleted from the migration entirely. This test file has been
// updated to match: the old Phase-B-pinning describe blocks ("Layer 1c" —
// the UPDATE's SET clause, "Layer 1f" — CHECK-constraint-on-the-UPDATE,
// "Layer 1g" — Phase-A-precedes-Phase-B pre-image capture, "Layer 1i" — the
// trailing verify-SELECT) have been removed and replaced with a "no write"
// describe block asserting the migration's new core safety property: no
// UPDATE statement targets public.bookings anywhere in this file. The
// `confidence` tag has been renamed `temporal_context` throughout, with
// assertions updated for its reworded (explicitly-not-a-safety-signal)
// text.
//
// ── Layers (mirrors migration-admin-hold-columns.test.ts /
//    migration-admin-hold-confirmed-booking-and-release.test.ts in this
//    same directory) ───────────────────────────────────────────────────────
//
// Layer 1 — Migration-text static assertions. No DB required. These pin
// the load-bearing shape of the migration: the exact 5-condition WHERE
// clause (§5.1), both additional exclusions being present AND flagged (not
// silently dropped, §5.3), the migration containing NO write statement of
// any kind against public.bookings (§5.4′ — the entire point of this
// revision), and the idempotency guard being the WHERE clause itself
// (§5.8′, now trivial since nothing is ever written).
//
// Layer 3 — DB-integration cases: DELIBERATELY NOT DUPLICATED HERE, same
// reasoning as before this revision (no Docker/local Supabase reachable in
// this build environment; the backend-developer hand-verified the temp
// table mechanics against a real local Postgres instance — see the
// migration file's own "── Prep:" header comment). What this file adds:
// exhaustive static-text coverage of the WHERE-clause conditions, the
// exclusion flagging, the temporal-context annotation wording, and —
// load-bearing for this revision — the absence of any write statement.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_FILENAME =
  '20260813131020_backfill_stranded_comp_bookings_zero_totals.sql'
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, MIGRATION_FILENAME)

const sql = readFileSync(MIGRATION_PATH, 'utf-8')

// Strip `-- ...` line comments before scanning for "absence" assertions —
// the migration's own header prose legitimately discusses DROP/TRUNCATE/
// DELETE/UPDATE (explaining why none of them appear, and what Phase B used
// to look like before it was deleted), and names both exclusions while
// explaining them.
const executableSql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

// The DO $$ ... $$ block body, isolated so assertions about statement
// ordering/content aren't confused by header prose, which legitimately
// repeats the same WHERE-clause vocabulary while explaining the design.
const doBlockMatch = sql.match(/DO \$\$([\s\S]*?)END \$\$;/)
const doBlock = doBlockMatch?.[1]

describe('migration file sanity', () => {
  it('the DO $$ ... $$ block was found by the isolating regex', () => {
    expect(doBlock, 'doBlock not found — regex likely drifted').toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1a — the 5-condition candidate signal (§5.1), present verbatim,
// UNCHANGED by the audit-only revision
// ════════════════════════════════════════════════════════════════════════════

describe('candidate signal — the 5 base conditions from §5.1 are present (unchanged by the audit-only revision)', () => {
  it("status = 'confirmed'", () => {
    expect(doBlock!).toMatch(/b\.status = 'confirmed'/)
  })

  it('stripe_payment_id IS NULL', () => {
    expect(doBlock!).toMatch(/b\.stripe_payment_id IS NULL/)
  })

  it('stripe_fee_pence = 0', () => {
    expect(doBlock!).toMatch(/b\.stripe_fee_pence = 0/)
  })

  it('price_at_booking > 0 (also the idempotency guard — see the idempotency describe block below)', () => {
    expect(doBlock!).toMatch(/b\.price_at_booking > 0/)
  })

  it('stripe_checkout_session_id IS NOT NULL — the condition that discriminates this bug from the unrelated 2026-07-13 promoteFromWaitlist bug class', () => {
    expect(doBlock!).toMatch(/b\.stripe_checkout_session_id IS NOT NULL/)
  })

  it('deleted_at IS NULL on the booking row itself', () => {
    expect(doBlock!).toMatch(/b\.deleted_at IS NULL/)
  })

  it('all 6 base conditions appear in the SAME WHERE clause that builds the candidate temp table (not scattered/duplicated elsewhere with drift risk)', () => {
    const tempTableMatch = doBlock!.match(
      /CREATE TEMP TABLE _backfill_comp_candidates[\s\S]*?FROM public\.bookings b[\s\S]*?WHERE([\s\S]*?);/,
    )
    expect(tempTableMatch, 'candidate temp-table WHERE clause not found').toBeTruthy()
    const whereClause = tempTableMatch![1]
    expect(whereClause).toMatch(/b\.status = 'confirmed'/)
    expect(whereClause).toMatch(/b\.stripe_payment_id IS NULL/)
    expect(whereClause).toMatch(/b\.stripe_fee_pence = 0/)
    expect(whereClause).toMatch(/b\.price_at_booking > 0/)
    expect(whereClause).toMatch(/b\.stripe_checkout_session_id IS NOT NULL/)
    expect(whereClause).toMatch(/b\.deleted_at IS NULL/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1b — the 2 additional exclusions (§5.3): present, AND flagged not
// silently dropped, UNCHANGED by the audit-only revision
// ════════════════════════════════════════════════════════════════════════════

describe('additional exclusions (§5.3) — present in the candidate set AND separately flagged, not silently dropped', () => {
  it('refund-activity exclusion (refunded_amount_pence = 0 AND stripe_refund_id IS NULL) is part of the candidate temp table WHERE clause', () => {
    const tempTableMatch = doBlock!.match(
      /CREATE TEMP TABLE _backfill_comp_candidates[\s\S]*?WHERE([\s\S]*?);/,
    )
    const whereClause = tempTableMatch![1]
    expect(whereClause).toMatch(/b\.refunded_amount_pence = 0/)
    expect(whereClause).toMatch(/b\.stripe_refund_id IS NULL/)
  })

  it('soft-deleted-event exclusion (e.deleted_at IS NULL) is part of the candidate temp table WHERE clause', () => {
    const tempTableMatch = doBlock!.match(
      /CREATE TEMP TABLE _backfill_comp_candidates[\s\S]*?WHERE([\s\S]*?);/,
    )
    const whereClause = tempTableMatch![1]
    expect(whereClause).toMatch(/e\.deleted_at IS NULL/)
  })

  it('INVARIANT: rows tripping either exclusion are NOT silently dropped — a dedicated SKIPPED-flagging query exists, scanning the SAME 6 base conditions but the INVERSE of the exclusions', () => {
    // This is the load-bearing safety property from §5.3/§5.6 Phase A
    // part 1: exclusion != silence. A row that matches the base signal but
    // fails an exclusion must be individually named in the run's NOTICE
    // output with its reason, not just vanish from the candidate set with
    // no trace.
    const skippedQueryMatch = doBlock!.match(
      /FOR r IN\s*\n\s*SELECT[\s\S]*?exclusion_reason\s*\n\s*FROM public\.bookings b[\s\S]*?WHERE([\s\S]*?)ORDER BY b\.created_at\s*\n\s*LOOP\s*\n\s*RAISE NOTICE 'SKIPPED/,
    )
    expect(skippedQueryMatch, 'SKIPPED-flagging FOR loop not found').toBeTruthy()
    const skippedWhere = skippedQueryMatch![1]
    // Same 6 base conditions.
    expect(skippedWhere).toMatch(/b\.status = 'confirmed'/)
    expect(skippedWhere).toMatch(/b\.stripe_payment_id IS NULL/)
    expect(skippedWhere).toMatch(/b\.stripe_fee_pence = 0/)
    expect(skippedWhere).toMatch(/b\.price_at_booking > 0/)
    expect(skippedWhere).toMatch(/b\.stripe_checkout_session_id IS NOT NULL/)
    expect(skippedWhere).toMatch(/b\.deleted_at IS NULL/)
    // INVERSE of the exclusions — an OR, not an AND, since this loop
    // exists specifically to catch rows failing AT LEAST ONE exclusion.
    expect(skippedWhere).toMatch(
      /b\.refunded_amount_pence > 0\s*\n\s*OR b\.stripe_refund_id IS NOT NULL\s*\n\s*OR e\.deleted_at IS NOT NULL/,
    )
  })

  it('the SKIPPED reason text is computed per-exclusion (a reader can tell WHICH exclusion fired, not just that "something" excluded the row)', () => {
    expect(doBlock!).toMatch(
      /WHEN b\.refunded_amount_pence > 0 OR b\.stripe_refund_id IS NOT NULL\s*\n\s*THEN 'refund activity already recorded on this booking/,
    )
    expect(doBlock!).toMatch(
      /WHEN e\.deleted_at IS NOT NULL\s*\n\s*THEN 'event is soft-deleted/,
    )
  })

  it("the SKIPPED RAISE NOTICE includes id, email, and event_slug — enough for a human to look the row up without re-querying", () => {
    expect(doBlock!).toMatch(
      /RAISE NOTICE 'SKIPPED \(manual review\) booking % \(%, event %\): %',\s*\n\s*r\.id, r\.email, r\.event_slug, r\.exclusion_reason;/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1c (REPLACED) — no write statement of any kind. This is the core
// safety property this revision exists to guarantee: the migration must
// NEVER write to public.bookings (or any table). This replaces the old
// "Layer 1c" (which pinned Phase B's SET clause), "Layer 1f" (CHECK-
// constraint-safety-on-the-UPDATE), and "Layer 1g" (Phase-A-precedes-
// Phase-B pre-image capture) — all of which described code that no longer
// exists in this file.
// ════════════════════════════════════════════════════════════════════════════

describe('no write statement (§5.4′) — the migration is audit-only, by construction cannot mutate public.bookings', () => {
  it('INVARIANT: no UPDATE statement targets public.bookings anywhere in this migration — the entire point of the code-review-driven rewrite (see the Addendum in the design doc: auto-correcting on this signal risked silently laundering a fraudulently self-confirmed unpaid booking into looking like a legitimate £0 comp)', () => {
    expect(executableSql).not.toMatch(/UPDATE\s+public\.bookings/i)
  })

  it('INVARIANT: no UPDATE statement appears anywhere in this migration at all, against any table — stronger than the public.bookings-specific check above, and the direct textual evidence that Phase B was deleted in its entirety, not merely re-scoped', () => {
    const updateStatements = executableSql.match(/\bUPDATE\s+\S+/gi) ?? []
    expect(updateStatements).toHaveLength(0)
  })

  it('no INSERT or DELETE statement appears anywhere either — the migration is pure SELECT + RAISE NOTICE (CREATE TEMP TABLE ... AS SELECT is the only "write", and it writes only to a session-local, ON-COMMIT-DROP temp relation, never to a real table)', () => {
    expect(executableSql).not.toMatch(/\bINSERT\s+INTO\b/i)
    expect(executableSql).not.toMatch(/\bDELETE\s+FROM\b/i)
  })

  it('the migration performs no writes to public.bookings — confirmed both by the header\'s explicit claim and by the absence of any UPDATE/INSERT/DELETE statement in the executable SQL', () => {
    expect(sql).toMatch(
      /No UPDATE, INSERT, or DELETE statement targets\s*\n-- public\.bookings \(or any table\) anywhere below\./,
    )
  })

  it('NEVER contains DROP, TRUNCATE, or a bare DELETE against any user-data table (safety rule — CLAUDE.md / social-seen-safety-SKILL.md)', () => {
    expect(executableSql).not.toMatch(/\bDROP TABLE\b/i)
    expect(executableSql).not.toMatch(/\bTRUNCATE\b/i)
    expect(executableSql).not.toMatch(/\bDELETE FROM public\./i)
    // DROP TABLE is legitimately absent even for the temp table — it uses
    // ON COMMIT DROP instead of an explicit DROP TABLE statement.
    expect(executableSql).toMatch(/ON COMMIT DROP/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1d — idempotency (§5.8′): trivially idempotent now that nothing is
// ever written; the self-excluding WHERE clause is retained anyway as the
// documented mechanism for whenever Migration 2 (the separate, human-
// verified correction) eventually exists
// ════════════════════════════════════════════════════════════════════════════

describe('idempotency (§5.8′)', () => {
  it('price_at_booking > 0 is one of the candidate conditions — retained from the original signal design even though this migration never writes, so the signal stays consistent with whatever later performs the actual correction', () => {
    const tempTableMatch = doBlock!.match(
      /CREATE TEMP TABLE _backfill_comp_candidates[\s\S]*?WHERE([\s\S]*?);/,
    )
    expect(tempTableMatch![1]).toMatch(/b\.price_at_booking > 0/)
  })

  it('no IF NOT EXISTS / ON CONFLICT / other idempotency marker is needed or present — this migration never writes to a real table, so re-running it (e.g. via `supabase db reset`) simply re-prints the same NOTICE output against whatever data is present', () => {
    expect(executableSql).not.toMatch(/ON CONFLICT/i)
    expect(executableSql).not.toMatch(/IF NOT EXISTS/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1e — temporal context tagging (§5.4′): renamed from `confidence`,
// reworded to stop implying safety/trust, still informational-only (never
// a WHERE-clause filter — that part of the original design was already
// correct and is unchanged)
// ════════════════════════════════════════════════════════════════════════════

describe('temporal context tagging (§5.4′) — renamed from `confidence`, reworded to explicitly NOT be a safety signal', () => {
  it('v_fix_cutoff is declared as a CONSTANT timestamptz matching the documented code-merge time', () => {
    expect(doBlock!).toMatch(
      /v_fix_cutoff CONSTANT timestamptz := '2026-08-13T09:23:48\+01:00';/,
    )
  })

  it('the CASE expression produces a column named `temporal_context`, NOT `confidence` — the rename is load-bearing per §5.4′ (stop readers pattern-matching on "confidence" as a scored trust metric)', () => {
    expect(doBlock!).toMatch(/END AS temporal_context/)
    expect(doBlock!).not.toMatch(/AS confidence\b/)
  })

  it("neither tier's text uses the words 'high' or 'medium' as a confidence tier label — the two-tier confidence framing was itself part of what the code reviewer objected to, not just the word 'confidence'", () => {
    // The reworded text is prose ("context: created after/before..."), not
    // a labelled tier. Guard against a regression back to 'high'/'medium'
    // tier labels specifically inside the temporal_context CASE expression.
    const caseMatch = doBlock!.match(
      /CASE\s*\n\s*WHEN b\.created_at >= v_fix_cutoff\s*\n\s*THEN([\s\S]*?)ELSE([\s\S]*?)END AS temporal_context/,
    )
    expect(caseMatch, 'temporal_context CASE expression not found').toBeTruthy()
    const [, thenBranch, elseBranch] = caseMatch!
    expect(thenBranch).not.toMatch(/'high\b/i)
    expect(elseBranch).not.toMatch(/'medium\b/i)
  })

  it("the post-cutoff branch explicitly disclaims itself as a verification/safety signal ('Do not treat this tag as verification — check Stripe directly.') — this is the specific sentence the rewrite added to stop a human trusting the tag the way Phase B implicitly did", () => {
    expect(doBlock!).toMatch(
      /Do not treat this tag as verification — check Stripe directly\./,
    )
  })

  it("the post-cutoff branch also explains WHY the cutoff doesn't rule the exploit out for this row (the vulnerability predates the fix's existence, so a pre-cutoff exploit attempt remains possible on any row regardless of when the fix eventually merged)", () => {
    expect(doBlock!).toMatch(
      /the vulnerability has been reachable for the entire lifetime of the bookings table/,
    )
  })

  it("the pre-cutoff branch draws no additional inference beyond the raw fact of being pre-cutoff ('no additional inference beyond that') — it does not claim elevated risk or exploit likelihood, just the timestamp fact", () => {
    expect(doBlock!).toMatch(/no additional inference beyond that\./)
  })

  it('INVARIANT: temporal_context is informational only — it lives in the SELECT list of the candidate temp table, never in a WHERE clause, so it cannot possibly exclude (or, now that there is no write, "correct") a row differently based on its value', () => {
    const selectListMatch = doBlock!.match(
      /CREATE TEMP TABLE _backfill_comp_candidates ON COMMIT DROP AS\s*\n\s*SELECT([\s\S]*?)FROM public\.bookings b/,
    )
    expect(selectListMatch, 'candidate SELECT list not found').toBeTruthy()
    expect(selectListMatch![1]).toMatch(/CASE/)
    expect(selectListMatch![1]).toMatch(/AS temporal_context/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1f — closing summary notice (§5.4′): replaces the old "Backfill
// corrected % booking(s)" GET DIAGNOSTICS notice with an audit-only count
// ════════════════════════════════════════════════════════════════════════════

describe('closing summary notice — reflects the audit-only, zero-write outcome', () => {
  it("the closing RAISE NOTICE reports the candidate count and explicitly states '0 corrected — audit-only migration', pointing to §5.10′ for the correction step", () => {
    expect(doBlock!).toMatch(
      /RAISE NOTICE 'Backfill audit found % candidate\(s\) for manual review \(0 corrected — audit-only migration, see docs\/SYSTEM-DESIGN-webhook-comp-detection-fix\.md §5\.10′ for the correction step\)',\s*\n\s*v_candidate_count;/,
    )
  })

  it('the candidate count is computed by incrementing v_candidate_count inside the CANDIDATE loop, NOT via GET DIAGNOSTICS ROW_COUNT — there is no UPDATE left to diagnose', () => {
    expect(doBlock!).not.toMatch(/GET DIAGNOSTICS/)
    expect(doBlock!).toMatch(/v_candidate_count integer := 0;/)
    expect(doBlock!).toMatch(/v_candidate_count := v_candidate_count \+ 1;/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1g — scope (§5.1): all events, not hardcoded to the known 13 rows.
// UNCHANGED by the audit-only revision.
// ════════════════════════════════════════════════════════════════════════════

describe('scope — signal-based, not id-based (per the brief\'s explicit instruction not to hardcode known ids)', () => {
  it('no hardcoded booking/event UUID or id literal appears anywhere in the executable SQL', () => {
    // A crude but effective guard: the known incident's actual row ids are
    // never quoted as literals in the WHERE/SELECT logic — the migration
    // is a pure signal-based scan across ALL events. This doesn't prove a
    // UUID could never accidentally appear, but the migration source is
    // short and fully under this test's control, so a plain regex for a
    // UUID-shaped literal is a reasonable trip-wire.
    const uuidLiteral = /'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/i
    expect(executableSql).not.toMatch(uuidLiteral)
  })

  it('no WHERE clause restricts to a single event_id or event slug', () => {
    expect(executableSql).not.toMatch(/event_id\s*=\s*'/)
    expect(executableSql).not.toMatch(/e\.slug\s*=\s*'/)
    expect(executableSql).not.toMatch(/e2\.slug\s*=\s*'/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1h (REPLACED, was "Layer 1i") — no trailing operator verify-SELECT.
// The old verify-SELECT existed to confirm Phase B's write took effect
// ("should return 0 after correction"); with no Phase B, it has no
// before/after to compare and was deleted per §5.4′.
// ════════════════════════════════════════════════════════════════════════════

describe('no trailing operator verify-SELECT (§5.4′) — removed because there is no write to confirm', () => {
  it('there is no executable SQL statement after the DO $$ ... $$ block — only trailing comments pointing to §5.10′', () => {
    const afterDoBlock = sql.slice(sql.lastIndexOf('END $$;') + 'END $$;'.length)
    const afterDoBlockExecutable = afterDoBlock
      .split('\n')
      .filter((line) => !line.trim().startsWith('--') && line.trim() !== '')
      .join('\n')
      .trim()
    expect(afterDoBlockExecutable).toBe('')
  })

  it('the trailing comment explains why the verify-SELECT was removed and points to §5.10′ for the operator workflow that follows', () => {
    const afterDoBlock = sql.slice(sql.lastIndexOf('END $$;'))
    expect(afterDoBlock).toMatch(/No verify-SELECT here/)
    expect(afterDoBlock).toMatch(/there is no write for a before\/after comparison/)
    expect(afterDoBlock).toMatch(/§5\.10′/)
  })
})
