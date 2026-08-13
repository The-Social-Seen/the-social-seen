// Coverage for migration
// `20260813154909_correct_verified_stranded_comp_bookings.sql` — "Migration
// 2" in the design doc's terminology, the actual correction for bookings
// identified by the audit-only Migration 1
// (`20260813131020_backfill_stranded_comp_bookings_zero_totals.sql`) and
// individually approved by the site owner (2 individually Stripe-verified,
// 11 approved on pattern-match strength — documented honestly in the
// migration's own header, not overstated as 13 individual Stripe lookups).
// Full design: docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §5.10′.
//
// ── A real bug this file was written against ─────────────────────────────
// The first hand-tested draft of this migration re-queried the safety
// signal AFTER the UPDATE loop ran, to build its "flag ids that didn't
// match" warning. That's wrong: a row corrected in the first loop now has
// price_at_booking=0, so it no longer matches its own `price_at_booking >
// 0` predicate — producing a false "no longer matches, needs re-review"
// warning for the exact rows that were just successfully corrected. Fixed
// by capturing the matched-id set BEFORE any UPDATE runs (`v_matched_ids`)
// and comparing against that captured set, not a live re-query. This test
// file pins that the fix is present.
//
// Layer 1 — Migration-text static assertions. No DB required.
// Layer 3 — DB-integration: DELIBERATELY NOT DUPLICATED HERE. Hand-verified
// against a real local Postgres 18 instance (no Docker/local Supabase
// reachable in this build environment) with all 13 real booking ids
// seeded under synthetic emails — first run correctly corrected all 13
// with zero false warnings, second run correctly reported "0 of 13
// corrected" with no spurious re-warnings for the already-fixed rows.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_FILENAME =
  '20260813154909_correct_verified_stranded_comp_bookings.sql'
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, MIGRATION_FILENAME)

const sql = readFileSync(MIGRATION_PATH, 'utf-8')

const executableSql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

const doBlockMatch = sql.match(/DO \$\$([\s\S]*?)END \$\$;/)
const doBlock = doBlockMatch?.[1]

describe('migration file sanity', () => {
  it('the DO $$ ... $$ block was found by the isolating regex', () => {
    expect(doBlock, 'doBlock not found — regex likely drifted').toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// The 13 verified ids — exactly these, no more, no less
// ════════════════════════════════════════════════════════════════════════════

const VERIFIED_IDS = [
  'e0b5ddbf-4343-4209-a98a-248f4de1e3f5', // rish_jain@hotmail.com — individually Stripe-verified
  'bfd3e832-c3ad-4ce8-a3b5-64a132e3b1fd',
  '950f34c2-54f9-4219-a965-159968181abf',
  'c3d57263-1f3d-43ef-9300-e62e7fc6c61a',
  '02ea486a-05f0-491c-83ad-4ec16e6388de',
  'e9433994-5069-479b-ba51-a8d247921c63',
  '7e8eeeaa-e9f3-4c2e-85e4-c6bc2be20de3',
  '848bb4e8-6ffa-4bf7-99ab-dd66f0c83817',
  '84bb36ed-176b-4d64-8117-3bd7af161731',
  '9d0a8b92-8580-4426-867f-0d14ffcd1615',
  '5b0dae84-6a09-41fc-a22d-34e68e94d935',
  '9147b781-c821-4ba9-8d43-f09e417d3796',
  'd9e81307-39d7-4438-9a90-639da215509e',
]

describe('verified id list — exactly the 13 approved Rooftop Party bookings', () => {
  it.each(VERIFIED_IDS)('contains %s', (id) => {
    expect(doBlock!).toContain(id)
  })

  it('contains exactly 13 uuid-shaped array entries in v_verified_ids (no accidental extras or omissions)', () => {
    const arrayMatch = doBlock!.match(
      /v_verified_ids CONSTANT uuid\[\] := ARRAY\[([\s\S]*?)\];/,
    )
    expect(arrayMatch, 'v_verified_ids array literal not found').toBeTruthy()
    const entries = arrayMatch![1].match(/'[0-9a-f-]{36}'::uuid/g) ?? []
    expect(entries).toHaveLength(13)
  })

  it('does NOT contain the excluded £250 Peak District Hiking booking (7c518da0-608f-41bd-a8f8-284876f5443f) — different event, much older, not yet confirmed as a legitimate self-comp', () => {
    expect(doBlock!).not.toContain('7c518da0-608f-41bd-a8f8-284876f5443f')
  })

  it("the migration's own header documents the exclusion of the £250 booking, not just silently omits it", () => {
    expect(sql).toMatch(/DELIBERATELY EXCLUDED/)
    expect(sql).toContain('7c518da0-608f-41bd-a8f8-284876f5443f')
  })

  it('the header documents which ids were individually Stripe-verified vs. approved on pattern-match strength (honest audit trail, not overstated)', () => {
    expect(sql).toMatch(/individually verified/i)
    expect(sql).toMatch(/pattern match|approved by the site owner/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Re-validation safety signal — identical to Migration 1's §5.1 + §5.3
// ════════════════════════════════════════════════════════════════════════════

describe('re-validation signal at write time — same 5 conditions + 2 exclusions as Migration 1', () => {
  it("status = 'confirmed'", () => {
    expect(doBlock!).toMatch(/b\.status = 'confirmed'/)
  })
  it('stripe_payment_id IS NULL', () => {
    expect(doBlock!).toMatch(/b\.stripe_payment_id IS NULL/)
  })
  it('stripe_fee_pence = 0', () => {
    expect(doBlock!).toMatch(/b\.stripe_fee_pence = 0/)
  })
  it('price_at_booking > 0 — also the idempotency guard', () => {
    expect(doBlock!).toMatch(/b\.price_at_booking > 0/)
  })
  it('stripe_checkout_session_id IS NOT NULL', () => {
    expect(doBlock!).toMatch(/b\.stripe_checkout_session_id IS NOT NULL/)
  })
  it('deleted_at IS NULL (booking not soft-deleted)', () => {
    expect(doBlock!).toMatch(/b\.deleted_at IS NULL/)
  })
  it('refunded_amount_pence = 0 (no refund activity)', () => {
    expect(doBlock!).toMatch(/b\.refunded_amount_pence = 0/)
  })
  it('stripe_refund_id IS NULL', () => {
    expect(doBlock!).toMatch(/b\.stripe_refund_id IS NULL/)
  })
  it('event not soft-deleted', () => {
    expect(doBlock!).toMatch(/e\.deleted_at IS NULL/)
  })
  it('the re-validation query filters by b.id = ANY(v_verified_ids) — scoped to exactly the hardcoded list, not signal-based across all events', () => {
    expect(doBlock!).toMatch(/b\.id = ANY\(v_verified_ids\)/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// The false-warning-on-corrected-rows bug and its fix
// ════════════════════════════════════════════════════════════════════════════

describe('warning loop compares against a PRE-mutation captured set, not a post-UPDATE re-query (the bug found during hand-testing)', () => {
  it('declares a v_matched_ids array to capture matches before mutation', () => {
    expect(doBlock!).toMatch(/v_matched_ids\s+uuid\[\]\s*:=\s*ARRAY\[\]::uuid\[\]/)
  })

  it('appends to v_matched_ids INSIDE the same loop that performs the UPDATE, before the UPDATE statement (capture-then-mutate ordering)', () => {
    const loopMatch = doBlock!.match(
      /FOR r IN[\s\S]*?LOOP([\s\S]*?)END LOOP;/,
    )
    expect(loopMatch).toBeTruthy()
    const firstLoopBody = loopMatch![1]
    const appendIndex = firstLoopBody.indexOf('array_append(v_matched_ids')
    const updateIndex = firstLoopBody.indexOf('UPDATE public.bookings')
    expect(appendIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(-1)
    expect(appendIndex).toBeLessThan(updateIndex)
  })

  it('the warning loop checks membership against v_matched_ids, NOT a fresh SELECT re-querying public.bookings for the safety signal a second time', () => {
    // Isolate the SECOND "FOR r IN ... LOOP ... END LOOP" block (the
    // warning loop) — split on "END LOOP;" so this doesn't accidentally
    // match starting from the FIRST loop's "FOR r IN".
    const loopBodies = doBlock!.split('END LOOP;')
    expect(loopBodies.length).toBeGreaterThanOrEqual(2)
    const warningLoopSetup = loopBodies[1]
    expect(warningLoopSetup).toContain('RAISE WARNING')
    expect(warningLoopSetup).toMatch(/NOT \(v\.id = ANY\(v_matched_ids\)\)/)
    // Must NOT contain a second full re-statement of all 9 safety-signal
    // conditions (status/stripe_payment_id/stripe_fee_pence/etc.) inside
    // this specific loop — that would mean it's re-querying live state
    // instead of using the captured set.
    expect(warningLoopSetup).not.toMatch(/b\.status = 'confirmed'/)
  })

  it('the warning loop additionally requires price_at_booking > 0 on the CURRENT row state, so an id already at £0 (corrected this run or a prior run) is never re-warned about', () => {
    const loopBodies = doBlock!.split('END LOOP;')
    const warningLoopSetup = loopBodies[1]
    expect(warningLoopSetup).toMatch(/b\.price_at_booking > 0/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// The UPDATE itself — scoped, minimal, CHECK-constraint-safe
// ════════════════════════════════════════════════════════════════════════════

describe('the correction UPDATE — only the two money columns, nothing else', () => {
  it('sets price_at_booking = 0 and booking_fee_pence = 0 together in the same statement (CHECK-constraint-safe — chk_bookings_free_no_booking_fee)', () => {
    expect(doBlock!).toMatch(
      /UPDATE public\.bookings\s+SET\s+price_at_booking = 0, booking_fee_pence = 0/,
    )
  })

  it('does not write status, stripe_payment_id, waitlist_position, is_admin_hold, or any other column', () => {
    const updateMatch = doBlock!.match(/UPDATE public\.bookings\s+SET\s+([^\n]+)/)
    expect(updateMatch).toBeTruthy()
    const setClause = updateMatch![1]
    expect(setClause).not.toMatch(/status\s*=/)
    expect(setClause).not.toMatch(/stripe_payment_id/)
    expect(setClause).not.toMatch(/waitlist_position/)
    expect(setClause).not.toMatch(/is_admin_hold/)
  })

  it('scopes the UPDATE by id = r.id (one row at a time, from the captured matched loop) not a blanket WHERE', () => {
    expect(doBlock!).toMatch(/WHERE\s+id = r\.id;/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// No destructive statements anywhere in the file
// ════════════════════════════════════════════════════════════════════════════

describe('no destructive statements', () => {
  it('contains no DROP, TRUNCATE, or DELETE statement', () => {
    expect(executableSql).not.toMatch(/\bDROP\s+(TABLE|VIEW|FUNCTION)/i)
    expect(executableSql).not.toMatch(/\bTRUNCATE\b/i)
    expect(executableSql).not.toMatch(/\bDELETE\s+FROM\b/i)
  })

  it('contains exactly one UPDATE statement (the single, scoped price/fee correction)', () => {
    const updateMatches = executableSql.match(/\bUPDATE\s+\S+/gi) ?? []
    expect(updateMatches).toHaveLength(1)
  })
})
