// Static-security coverage for migration
// `20260602000001_admin_get_user_phones_batch.sql` — the batch admin-only
// PII read primitive that the member-mobile-phone feature is built on.
//
// ── Why this is static-text, not live-DB ─────────────────────────────────────
// This mirrors the established pattern in
// `migration-w1-demographics.test.ts` (Layer 1): there is NO local pgTAP /
// Supabase harness on the build machine, so the security-critical idioms are
// asserted by reading the .sql file and regex-matching the load-bearing
// clauses. These run in CI without Docker and catch a refactor that would
// quietly weaken the PII boundary in the migration file itself. The
// equivalent live-DB cases (admin returns data; non-admin → forbidden; anon →
// forbidden) are the `it.skip(... TODO(W4-docker) ...)` cases in
// migration-w1-demographics.test.ts and would extend cleanly to this fn once a
// stack is reachable.
//
// ── INVARIANT this whole file defends ────────────────────────────────────────
// `phone_number` is PII. After Phase-3 hardening it is revoked from BOTH the
// `anon` AND the `authenticated` column GRANT on public.profiles. The ONLY
// sanctioned bulk exposure is this one SECURITY DEFINER function, gated on
// `role = 'admin'`. If any assertion below fails, a member's phone number can
// leak to a non-admin (or anon) caller, OR the admin gate / soft-delete filter
// has been removed. None of those may regress.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_PATH = resolve(
  MIGRATIONS_DIR,
  '20260602000001_admin_get_user_phones_batch.sql',
)

const sql = readFileSync(MIGRATION_PATH, 'utf-8')

// `sql` with `-- …` line comments stripped. The migration's header is a long
// prose block that legitimately quotes the words it forbids (e.g. "no
// DROP/TRUNCATE/DELETE", "no service-role"), so the "absence of destructive
// DDL" assertions must scan the EXECUTABLE statements only — otherwise the
// safety prose trips its own guard. The `'…'` literals in the body (e.g.
// 'admin', 'forbidden') contain no `--`, so this strip leaves them intact.
const executableSql = sql.replace(/--.*$/gm, '')

// The full CREATE OR REPLACE … $$ … $$ body, isolated so gate/filter
// assertions can't be satisfied by text living elsewhere in the file (e.g. a
// header comment that quotes `role = 'admin'`).
const fnBody = sql.match(
  /CREATE OR REPLACE FUNCTION public\.admin_get_user_phones[\s\S]*?\$\$[\s\S]*?\$\$/,
)?.[0]

describe('Migration 20260602000001 — admin_get_user_phones static security', () => {
  // ── Signature / shape ──────────────────────────────────────────────────────

  it('declares the exact signature admin_get_user_phones(target_user_ids uuid[])', () => {
    // The Supabase JS arg key (`target_user_ids`) is the SQL parameter name —
    // a rename here silently breaks `fetchPhoneMap`'s rpc() call shape, which
    // is asserted on the action side. Pin both name and type.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_get_user_phones\(target_user_ids uuid\[\]\)/,
    )
  })

  it('returns TABLE (user_id uuid, phone_number text) — the set-returning merge shape', () => {
    // user_id is the merge key; phone_number is the payload. Switching to a
    // scalar return (like get_my_phone) would change the wire format and break
    // the Map-by-id merge in every consuming action without a TS error.
    expect(sql).toMatch(
      /RETURNS TABLE \(\s*user_id uuid,\s*phone_number text\s*\)/,
    )
  })

  it('is LANGUAGE plpgsql (required for the RAISE EXCEPTION admin gate)', () => {
    expect(fnBody, 'function body not found').toBeTruthy()
    expect(fnBody!).toMatch(/LANGUAGE plpgsql/)
  })

  // ── SECURITY DEFINER + exact search_path (the authorisation boundary) ───────

  it('INVARIANT: is SECURITY DEFINER (the in-body admin gate, not a GRANT, is the boundary)', () => {
    // SECURITY DEFINER is what lets the fn read the column that is revoked from
    // the caller's role. Lose it and either the fn stops returning data, or
    // (worse, if combined with a widened GRANT) the boundary moves. Must stay.
    expect(fnBody!).toMatch(/SECURITY DEFINER/)
  })

  it('INVARIANT: pins SET search_path = public exactly (not the stricter NOR a looser variant)', () => {
    // The spec (§1.2) deliberately uses `public` to match the three siblings;
    // the hardening retrofit will move all four together. Assert the exact
    // string AND that the stricter `public, pg_catalog` form is NOT used here
    // — a one-function divergence fragments the pattern, and a search_path that
    // omits a schema entirely (or trusts the caller's path) is a classic
    // SECURITY DEFINER privilege-escalation vector.
    expect(fnBody!).toMatch(/SET search_path = public\b/)
    expect(fnBody!).not.toMatch(/SET search_path = public, pg_catalog/)
    expect(fnBody!).not.toMatch(/SET search_path = pg_catalog/)
  })

  // ── Admin gate ──────────────────────────────────────────────────────────────

  it('INVARIANT: gates on the CALLER being an admin via auth.uid() (target ids cannot spoof admin-ness)', () => {
    // The EXISTS check keys on auth.uid() — the session's own id — NOT on
    // anything derived from target_user_ids. This is what stops a non-admin
    // passing an admin's id (or any id) to obtain data. Assert the gate is an
    // EXISTS over profiles WHERE id = auth.uid() AND role = 'admin'.
    expect(fnBody!).toMatch(
      /IF NOT EXISTS\s*\([\s\S]*?FROM public\.profiles[\s\S]*?WHERE id = auth\.uid\(\)[\s\S]*?role = 'admin'[\s\S]*?\)\s*THEN/,
    )
  })

  it("INVARIANT: RAISES 'forbidden' for non-admin callers (fail-closed, same string as siblings)", () => {
    // Byte-for-byte the same message as admin_get_user_phone /
    // admin_get_demographics. A non-admin invoker hits this BEFORE any SELECT
    // runs, so no row is ever returned to them.
    expect(fnBody!).toMatch(/RAISE EXCEPTION 'forbidden'/)
    // The RAISE must sit inside the NOT-EXISTS(admin) branch, i.e. the gate
    // fires precisely when the caller is NOT an admin.
    expect(fnBody!).toMatch(
      /IF NOT EXISTS[\s\S]*?role = 'admin'[\s\S]*?THEN\s*RAISE EXCEPTION 'forbidden';/,
    )
  })

  // ── Soft-delete filter ──────────────────────────────────────────────────────

  it("INVARIANT: filters deleted_at IS NULL so a soft-deleted member's PII never resurfaces", () => {
    // A booking can outlive a soft-deleted profile (kept for event history).
    // The fn must NOT return that profile's phone — the filter is what makes a
    // deleted member's id yield no row → merge → null → "—"/empty cell.
    expect(fnBody!).toMatch(/deleted_at IS NULL/)
    // And it must be applied to the profiles read, alongside the id-membership
    // predicate — not in an unrelated clause.
    expect(fnBody!).toMatch(
      /WHERE p\.id = ANY\(target_user_ids\)\s*AND p\.deleted_at IS NULL/,
    )
  })

  // ── GRANT shape — exposed to authenticated (invoke), never to anon ──────────

  it('GRANTs EXECUTE to authenticated (the in-body gate restricts the RESULT to admins)', () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.admin_get_user_phones\(uuid\[\]\) TO authenticated;/,
    )
  })

  it('INVARIANT: never GRANTs EXECUTE on this fn to anon', () => {
    // anon must not even be able to invoke it. (Defence in depth: even if it
    // could, the admin gate would forbid — but anon has no business reaching
    // a PII read path at all.) Scanned against executable SQL so the header's
    // "anon … receive 'forbidden', never data" prose can't false-positive.
    expect(executableSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.admin_get_user_phones[\s\S]*?TO anon/,
    )
  })

  // ── Catalog-only: no GRANT/REVOKE/ALTER on the profiles TABLE ───────────────
  // The migration must add NOTHING to the table-level column GRANTs. phone
  // stays revoked from BOTH anon AND authenticated; the ONLY new exposure is
  // this function. A stray GRANT/REVOKE/ALTER on public.profiles here would
  // mean the migration is doing more than the spec's "catalog-only" promise.

  it('INVARIANT: does NOT re-GRANT column SELECT (phone_number) on profiles to anyone', () => {
    // The whole point of the SECURITY DEFINER indirection is that NO role
    // (not anon, not authenticated) regains a direct column read on phone.
    // Executable-SQL scan: the header discusses phone_number GRANTs in prose.
    expect(executableSql).not.toMatch(/GRANT SELECT \(phone_number\)/)
    expect(executableSql).not.toMatch(
      /GRANT SELECT[\s\S]*?phone_number[\s\S]*?ON public\.profiles/,
    )
  })

  it('INVARIANT: performs no table-level GRANT/REVOKE/ALTER on public.profiles (catalog-only)', () => {
    // The only DDL permitted is CREATE OR REPLACE FUNCTION + GRANT EXECUTE on
    // the function. Any of these on the TABLE would change the data-exposure
    // surface and must be caught. (The header's "NO CHANGE to any table GRANT"
    // prose mentions these verbs, hence the executable-only scan.)
    expect(executableSql).not.toMatch(/GRANT SELECT ON public\.profiles/)
    expect(executableSql).not.toMatch(/REVOKE[\s\S]*?ON public\.profiles/)
    expect(executableSql).not.toMatch(/ALTER TABLE[\s\S]*?profiles/)
  })

  it('INVARIANT: contains no destructive DDL (DROP/TRUNCATE/DELETE) — re-runnable catalog op only', () => {
    // Safety-rail mirror of the migration header's blast-radius claim. Scanned
    // against executable SQL because the header prose literally lists
    // "DROP/TRUNCATE/DELETE" and the one-line rollback comment shows a DROP.
    expect(executableSql).not.toMatch(/\bDROP TABLE\b/)
    expect(executableSql).not.toMatch(/\bTRUNCATE\b/)
    expect(executableSql).not.toMatch(/\bDELETE FROM\b/)
    // CREATE OR REPLACE keeps it idempotent.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_get_user_phones/)
  })
})
