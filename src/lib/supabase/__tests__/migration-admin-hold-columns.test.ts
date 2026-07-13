// Coverage for migration
// `20260713000001_add_bookings_admin_hold_columns.sql` — adds
// `bookings.is_admin_hold` / `bookings.admin_hold_expires_at` plus the two
// CHECK constraints that are the safety net for the "every UPDATE that
// moves a hold row off pending_payment MUST clear both columns in the
// SAME statement" requirement (SYSTEM-DESIGN-admin-waitlist-promotion-
// payment.md §2.2 / §2.3).
//
// ── Layers (mirrors reap-stale-pending-bookings.test.ts /
//    migration-admin-get-user-phones.test.ts in this same directory) ────────
//
// Layer 1 — Migration-text static assertions. Run without a DB. These are
// the load-bearing CI assertions: they catch a refactor that silently
// drops a CHECK, weakens its expression, or loses the idempotency guard —
// long before anyone notices in a live database.
//
// Layer 3 — Skipped DB-integration cases. No Docker / `supabase start` is
// reachable in this build environment (confirmed by running `supabase
// start` directly: "Cannot connect to the Docker daemon" — same
// constraint the backend-developer's environment hit). Each behavioural
// assertion is encoded as `it.skip(...)` with a `TODO(admin-hold-docker)`
// marker and full setup instructions. Unskip once `supabase start` is
// reachable and run against a fresh `supabase db reset`.
//
// These CHECK constraints are the ONLY thing standing between "a future
// call site forgets to clear is_admin_hold" and silent state corruption
// (the OLD reaper would then wrongly skip an ordinary abandoned checkout,
// or a stale hold flag would resurface on an unrelated later booking
// lifecycle — see spec §2.3's worked example). Proving they fire against
// a REAL Postgres, not just that the .sql text contains the word CHECK,
// is the single most valuable DB-integration case in this whole feature —
// prioritise unskipping this file first if Docker ever becomes available.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_FILENAME = '20260713000001_add_bookings_admin_hold_columns.sql'
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, MIGRATION_FILENAME)

const sql = readFileSync(MIGRATION_PATH, 'utf-8')

// Strip `-- ...` line comments before scanning for "absence" assertions —
// the migration's own header prose legitimately discusses DROP/TRUNCATE/
// DELETE and quotes CHECK expressions while explaining them.
const executableSql = sql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')

// ════════════════════════════════════════════════════════════════════════════
// Layer 1 — Migration text invariants
// ════════════════════════════════════════════════════════════════════════════

describe('admin-hold-columns migration — column declarations', () => {
  it('adds is_admin_hold boolean NOT NULL DEFAULT false, idempotently (IF NOT EXISTS)', () => {
    // NOT NULL DEFAULT false is what makes this purely additive — every
    // pre-existing row gets a well-defined, safe value with zero
    // behavioural change until the new RPC starts setting it true.
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS is_admin_hold boolean NOT NULL DEFAULT false/,
    )
  })

  it('adds admin_hold_expires_at as a NULLABLE timestamptz (no default, no NOT NULL)', () => {
    // INVARIANT: this column must stay nullable. NULL is a meaningful,
    // permanent state (spec §2.1) — "no automated revert" — not just an
    // absence-of-value placeholder. A future "let's add NOT NULL DEFAULT
    // now()" edit would silently break the Amy/Yasemin no-deadline case.
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS admin_hold_expires_at timestamptz/,
    )
    // Pin the absence of NOT NULL specifically on this column's
    // declaration line (not the is_admin_hold line above it).
    const line = sql
      .split('\n')
      .find((l) => l.includes('admin_hold_expires_at timestamptz'))
    expect(line, 'declaration line not found').toBeTruthy()
    expect(line!).not.toMatch(/NOT NULL/)
  })

  it('both columns are declared in a SINGLE ALTER TABLE statement', () => {
    // Two separate ALTER TABLE statements would still be correct SQL, but
    // a single statement is what the migration promises ("purely
    // additive... zero behavioural change") and is cheaper (one table
    // rewrite pass, not two) — pin the shape.
    expect(sql).toMatch(
      /ALTER TABLE public\.bookings\s*\n\s*ADD COLUMN IF NOT EXISTS is_admin_hold[\s\S]*?ADD COLUMN IF NOT EXISTS admin_hold_expires_at timestamptz;/,
    )
  })

  it('documents both columns via COMMENT ON COLUMN', () => {
    expect(sql).toMatch(/COMMENT ON COLUMN public\.bookings\.is_admin_hold IS/)
    expect(sql).toMatch(
      /COMMENT ON COLUMN public\.bookings\.admin_hold_expires_at IS/,
    )
  })

  it("is_admin_hold's comment states the MUST-clear-together contract", () => {
    // INVARIANT (documentation-as-contract): a future maintainer reading
    // `\d+ bookings` in psql should see this rule without needing to find
    // this spec doc. Loose match on the key phrase, not the whole prose,
    // so minor copy-editing doesn't break the test.
    expect(sql).toMatch(/MUST be cleared back to false/)
  })
})

describe('admin-hold-columns migration — CHECK constraints', () => {
  it('chk_bookings_admin_hold_expiry_requires_flag: CHECK (is_admin_hold = true OR admin_hold_expires_at IS NULL)', () => {
    // A deadline only makes sense on a row that IS a hold. This is the
    // "you can't set admin_hold_expires_at on an ordinary booking" rail.
    expect(sql).toMatch(
      /ADD CONSTRAINT chk_bookings_admin_hold_expiry_requires_flag\s*\n\s*CHECK \(is_admin_hold = true OR admin_hold_expires_at IS NULL\)/,
    )
  })

  it("chk_bookings_admin_hold_requires_pending_payment: CHECK (is_admin_hold = false OR status = 'pending_payment')", () => {
    // The load-bearing one (spec §2.2): forces every UPDATE that moves a
    // hold row's status away from pending_payment to ALSO clear
    // is_admin_hold in the same statement, or the write fails loudly
    // (23514) instead of leaving stale state.
    expect(sql).toMatch(
      /ADD CONSTRAINT chk_bookings_admin_hold_requires_pending_payment\s*\n\s*CHECK \(is_admin_hold = false OR status = 'pending_payment'\)/,
    )
  })

  it('both constraints are guarded with DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL (re-runnable)', () => {
    // Matches the established idempotency pattern (20260517000001) for
    // named constraints — ADD CONSTRAINT has no IF NOT EXISTS form in
    // Postgres, so this DO-block is the only way to make re-running the
    // migration safe.
    const guardedCount = (
      executableSql.match(
        /DO \$\$ BEGIN\s*\n\s*ALTER TABLE public\.bookings\s*\n\s*ADD CONSTRAINT chk_bookings_admin_hold_\w+\s*\n\s*CHECK \([^)]*\);\s*\n\s*EXCEPTION WHEN duplicate_object THEN NULL;\s*\n\s*END \$\$;/g,
      ) ?? []
    ).length
    expect(guardedCount).toBe(2)
  })

  it('exactly two CHECK constraints are added (no accidental third/duplicate)', () => {
    const matches = executableSql.match(/ADD CONSTRAINT chk_bookings_admin_hold_/g) ?? []
    expect(matches).toHaveLength(2)
  })
})

describe('admin-hold-columns migration — safety rails', () => {
  it('contains no destructive DDL (DROP/TRUNCATE/DELETE)', () => {
    expect(executableSql).not.toMatch(/\bDROP TABLE\b/i)
    expect(executableSql).not.toMatch(/\bTRUNCATE\b/i)
    expect(executableSql).not.toMatch(/\bDELETE FROM\b/i)
    expect(executableSql).not.toMatch(/\bDROP COLUMN\b/i)
  })

  it('does not disable or alter RLS on public.bookings', () => {
    // Both columns inherit the table's existing RLS posture (no anon
    // SELECT policy on bookings at all) — this migration must not touch
    // ROW LEVEL SECURITY in any way.
    expect(executableSql).not.toMatch(/ROW LEVEL SECURITY/i)
    expect(executableSql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i)
  })

  it('does not create a new index (documented decision — demo scale)', () => {
    expect(executableSql).not.toMatch(/CREATE (UNIQUE )?INDEX/i)
  })

  it('does not touch any GRANT/REVOKE (column-level ACLs unaffected)', () => {
    // Both new columns inherit the table's row-level RLS; there is no
    // column-level GRANT/REVOKE story here (that machinery is reserved
    // for the profiles anon-visibility posture per CLAUDE.md). A stray
    // GRANT/REVOKE in this migration would be scope creep worth flagging.
    expect(executableSql).not.toMatch(/\bGRANT\b/)
    expect(executableSql).not.toMatch(/\bREVOKE\b/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 3 — Skipped DB-integration cases (TODO(admin-hold-docker))
// ════════════════════════════════════════════════════════════════════════════

describe('DB integration — CHECK constraint enforcement (TODO(admin-hold-docker))', () => {
  // No Docker in this build environment — `supabase start` fails with
  // "Cannot connect to the Docker daemon at unix:///var/run/docker.sock".
  // Unskip once a local Supabase stack is reachable and run against a
  // fresh `supabase db reset`. Each body documents the exact seed +
  // assertion so this can be executed verbatim.

  it.skip('rejects is_admin_hold=true with status != pending_payment (23514)', async () => {
    // TODO(admin-hold-docker):
    //   1. Seed a profile + a confirmed booking (status='confirmed') for
    //      a real event via the admin client (bypasses RLS).
    //   2. Attempt: admin.from('bookings').update({ is_admin_hold: true })
    //      .eq('id', bookingId)
    //   3. Assert: error is non-null, error.code === '23514' (check
    //      violation), error.message mentions
    //      'chk_bookings_admin_hold_requires_pending_payment'.
    //   4. Repeat for status='waitlisted' and status='cancelled' — all
    //      three must be rejected. This is THE regression test for "5
    //      call sites must clear both columns" — if any call site is
    //      ever missed, this constraint is what turns a silent data-
    //      integrity bug into a loud, immediate write failure.
  })

  it.skip('rejects admin_hold_expires_at set with is_admin_hold=false (23514)', async () => {
    // TODO(admin-hold-docker):
    //   1. Seed a waitlisted booking (is_admin_hold defaults false).
    //   2. Attempt: admin.from('bookings')
    //        .update({ admin_hold_expires_at: new Date(Date.now() + 3600_000).toISOString() })
    //        .eq('id', bookingId)
    //      (is_admin_hold NOT set to true in the same statement.)
    //   3. Assert: error.code === '23514',
    //      error.message mentions 'chk_bookings_admin_hold_expiry_requires_flag'.
  })

  it.skip('accepts is_admin_hold=true + status=pending_payment + a future admin_hold_expires_at', async () => {
    // TODO(admin-hold-docker): the valid "systemic slice" shape (a
    // promotion WITH a computed 4h deadline, once that's wired up).
    //   1. Seed a waitlisted booking on a paid event.
    //   2. UPDATE ... SET status='pending_payment', is_admin_hold=true,
    //      admin_hold_expires_at = now() + interval '4 hours'
    //      WHERE id = bookingId (single statement — both CHECKs must be
    //      satisfied simultaneously).
    //   3. Assert: error is null, row's three columns read back exactly
    //      as written.
  })

  it.skip('accepts is_admin_hold=true + status=pending_payment + admin_hold_expires_at=NULL (Amy/Yasemin shape)', async () => {
    // TODO(admin-hold-docker): the shape THIS PR actually produces today
    // (holdExpiresAt hardcoded null — spec §8.1 step 6). Same as above
    // but admin_hold_expires_at stays NULL. Must succeed — NULL always
    // satisfies chk_bookings_admin_hold_expiry_requires_flag regardless
    // of is_admin_hold's value.
  })

  it.skip('new rows default is_admin_hold=false and admin_hold_expires_at=NULL when omitted from INSERT', async () => {
    // TODO(admin-hold-docker): INSERT a booking row (e.g. via book_event
    // RPC, or a direct admin insert for a test fixture) WITHOUT
    // specifying either column. SELECT them back. Assert
    // is_admin_hold === false, admin_hold_expires_at === null. Proves the
    // "purely additive, zero behavioural change to existing rows" claim
    // in the migration header for BOTH pre-existing AND newly-created
    // ordinary bookings.
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Operator smoke (manual, post-`supabase db push`) — NOT a CI test.
// ════════════════════════════════════════════════════════════════════════════
//
//   SELECT column_name, data_type, is_nullable, column_default
//     FROM information_schema.columns
//    WHERE table_name = 'bookings'
//      AND column_name IN ('is_admin_hold', 'admin_hold_expires_at');
//   -- Expect: is_admin_hold | boolean | NO | false
//   --         admin_hold_expires_at | timestamp with time zone | YES | (null)
//
//   SELECT conname, pg_get_constraintdef(oid)
//     FROM pg_constraint
//    WHERE conrelid = 'public.bookings'::regclass
//      AND conname LIKE 'chk_bookings_admin_hold%';
//   -- Expect: 2 rows, defs matching the CHECK expressions pinned above.
