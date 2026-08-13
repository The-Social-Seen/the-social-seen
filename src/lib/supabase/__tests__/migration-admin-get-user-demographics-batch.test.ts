// Static-security + skip-marked DB-integration coverage for migration
// `20260812000001_admin_get_user_demographics_batch.sql` — the batch
// admin-only PII read primitive for member `gender`/`age_range`, per
// docs/SYSTEM-DESIGN-admin-gender-batch-rpc.md §7.
//
// ── Why this is static-text, not live-DB ─────────────────────────────────────
// This mirrors the established pattern in `migration-admin-get-user-phones
// .test.ts` (itself mirroring Layer 1 of `migration-w1-demographics.test.ts`):
// there is NO local pgTAP / Supabase harness on the build machine (`docker` is
// not on PATH — confirmed before writing this file), so the security-critical
// idioms are asserted by reading the .sql file and regex-matching the
// load-bearing clauses. These run in CI without Docker and catch a refactor
// that would quietly weaken the PII boundary in the migration file itself.
// The live-DB equivalents (admin returns data; non-admin -> forbidden; anon ->
// forbidden; empty array; unmatched ids; soft-deleted exclusion) are the
// `it.skip(... TODO(gender-batch-docker) ...)` cases below — unskip once a
// local Supabase stack is reachable (`supabase start`).
//
// ── INVARIANT this whole file defends ────────────────────────────────────────
// `gender` (and `age_range`) is admin-only PII, excluded from the
// `authenticated` column GRANT on public.profiles since the column was
// introduced (20260503000001). The ONLY sanctioned BULK exposure is this one
// SECURITY DEFINER function, gated on `role = 'admin'`. If any assertion below
// fails, a member's gender can leak to a non-admin (or anon) caller, OR the
// admin gate / soft-delete filter has been removed. None of those may regress.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_PATH = resolve(
  MIGRATIONS_DIR,
  '20260812000001_admin_get_user_demographics_batch.sql',
)

const sql = readFileSync(MIGRATION_PATH, 'utf-8')

// `sql` with `-- …` line comments stripped. The migration's header is a long
// prose block that legitimately quotes the words it forbids (e.g. "no
// DROP/TRUNCATE/DELETE", "no service-role"), so the "absence of destructive
// DDL" / "no stray GRANT" assertions must scan the EXECUTABLE statements only
// — otherwise the safety prose trips its own guard.
const executableSql = sql.replace(/--.*$/gm, '')

// The full CREATE OR REPLACE … $$ … $$ body, isolated so gate/filter
// assertions can't be satisfied by text living elsewhere in the file (e.g. a
// header comment that quotes `role = 'admin'`).
const fnBody = sql.match(
  /CREATE OR REPLACE FUNCTION public\.admin_get_user_demographics[\s\S]*?\$\$[\s\S]*?\$\$/,
)?.[0]

// ════════════════════════════════════════════════════════════════════════════
// Static (run without Docker, today) — spec §7 items 1-5
// ════════════════════════════════════════════════════════════════════════════

describe('Migration 20260812000001 — admin_get_user_demographics static security', () => {
  // ── Signature / shape ──────────────────────────────────────────────────────

  it('declares the exact signature admin_get_user_demographics(target_user_ids uuid[])', () => {
    // spec §7.3: the Supabase JS arg key (`target_user_ids`) is the SQL
    // parameter name — a rename here silently breaks `fetchDemographicsMap`'s
    // rpc() call shape, which is asserted separately in the JS-wiring tests.
    // Plural + array guards against an accidental single-uuid signature
    // drifting in during a future edit.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_get_user_demographics\(target_user_ids uuid\[\]\)/,
    )
  })

  it('returns TABLE (user_id uuid, gender public.gender, age_range public.age_range) — the set-returning merge shape', () => {
    // user_id is the merge key; gender/age_range are the payload. Switching to
    // a scalar return would change the wire format and break the Map-by-id
    // merge in `fetchDemographicsMap` without a TS error.
    expect(sql).toMatch(
      /RETURNS TABLE \(\s*user_id uuid,\s*gender public\.gender,\s*age_range public\.age_range\s*\)/,
    )
  })

  it('is LANGUAGE plpgsql (required for the RAISE EXCEPTION admin gate)', () => {
    expect(fnBody, 'function body not found').toBeTruthy()
    expect(fnBody!).toMatch(/LANGUAGE plpgsql/)
  })

  // ── spec §7 item 1: SECURITY DEFINER + exact search_path ────────────────────

  it('INVARIANT: is SECURITY DEFINER (the in-body admin gate, not a GRANT, is the boundary)', () => {
    // SECURITY DEFINER is what lets the fn read a column that is revoked from
    // the caller's role. Lose it and either the fn stops returning data, or
    // (worse, if combined with a widened GRANT) the boundary moves. Must stay.
    expect(fnBody!).toMatch(/SECURITY DEFINER/)
  })

  it('INVARIANT: pins SET search_path = public exactly (not the stricter NOR a looser variant)', () => {
    // The spec (§1.4) deliberately matches (not strengthens) its three
    // siblings; the hardening retrofit is a separate future PR that will move
    // ALL SECURITY DEFINER functions together. A one-function divergence here
    // fragments the pattern, and an unset/loose search_path on a SECURITY
    // DEFINER function is a classic privilege-escalation vector.
    expect(fnBody!).toMatch(/SET search_path = public\b/)
    expect(fnBody!).not.toMatch(/SET search_path = public, pg_catalog/)
    expect(fnBody!).not.toMatch(/SET search_path = pg_catalog/)
  })

  // ── spec §7 item 2: admin gate + exact RAISE EXCEPTION idiom ─────────────────

  it('INVARIANT: gates on the CALLER being an admin via auth.uid() (target ids cannot spoof admin-ness)', () => {
    // The EXISTS check keys on auth.uid() — the session's own id — NOT on
    // anything derived from target_user_ids. This is what stops a non-admin
    // passing an admin's id (or any id, including their own) in the array to
    // obtain data. Assert the gate is an EXISTS over profiles WHERE id =
    // auth.uid() AND role = 'admin'.
    expect(fnBody!).toMatch(
      /IF NOT EXISTS\s*\([\s\S]*?FROM public\.profiles[\s\S]*?WHERE id = auth\.uid\(\)[\s\S]*?role = 'admin'[\s\S]*?\)\s*THEN/,
    )
  })

  it("INVARIANT: RAISES 'forbidden' for non-admin callers (fail-closed, same string as siblings)", () => {
    // Byte-for-byte the same message as admin_get_user_phone(s) /
    // admin_get_demographics. A non-admin invoker hits this BEFORE any SELECT
    // runs, so no row is ever returned to them — including for their own id.
    expect(fnBody!).toMatch(/RAISE EXCEPTION 'forbidden'/)
    // The RAISE must sit inside the NOT-EXISTS(admin) branch, i.e. the gate
    // fires precisely when the caller is NOT an admin, and structurally BEFORE
    // the RETURN QUERY that reads target_user_ids — the gate is evaluated
    // first regardless of what the array contains (spec §7 item 9).
    expect(fnBody!).toMatch(
      /IF NOT EXISTS[\s\S]*?role = 'admin'[\s\S]*?THEN\s*RAISE EXCEPTION 'forbidden';/,
    )
    const gateIndex = fnBody!.indexOf("RAISE EXCEPTION 'forbidden'")
    const queryIndex = fnBody!.indexOf('RETURN QUERY')
    expect(gateIndex).toBeGreaterThan(-1)
    expect(queryIndex).toBeGreaterThan(-1)
    expect(gateIndex).toBeLessThan(queryIndex)
  })

  // ── Soft-delete filter (referenced by spec §7 items 10-11) ───────────────────

  it("INVARIANT: filters deleted_at IS NULL so a soft-deleted member's PII never resurfaces", () => {
    // A booking can outlive a soft-deleted profile (kept for event history).
    // The fn must NOT return that profile's gender/age_range — the filter is
    // what makes a deleted member's id yield no row -> merge -> null.
    expect(fnBody!).toMatch(/deleted_at IS NULL/)
    // And it must be applied to the profiles read, alongside the
    // id-membership predicate — not in an unrelated clause.
    expect(fnBody!).toMatch(
      /WHERE p\.id = ANY\(target_user_ids\)\s*AND p\.deleted_at IS NULL/,
    )
  })

  // ── spec §7 item 4: GRANT shape — authenticated only, never anon/PUBLIC ──────

  it('GRANTs EXECUTE to authenticated (the in-body gate restricts the RESULT to admins)', () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.admin_get_user_demographics\(uuid\[\]\) TO authenticated;/,
    )
  })

  it('INVARIANT: never GRANTs EXECUTE on this fn to anon', () => {
    // anon must not even be able to invoke it. (Defence in depth: even if it
    // could, the admin gate would forbid — but anon has no business reaching
    // a PII read path at all.) Scanned against executable SQL so the header's
    // "anon … receive 'forbidden', never data" prose can't false-positive.
    expect(executableSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.admin_get_user_demographics[\s\S]*?TO anon/,
    )
  })

  it('INVARIANT: never GRANTs EXECUTE on this fn to PUBLIC', () => {
    expect(executableSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.admin_get_user_demographics[\s\S]*?TO PUBLIC/,
    )
  })

  // ── Catalog-only: no GRANT/REVOKE/ALTER on the profiles TABLE ───────────────
  // The migration must add NOTHING to the table-level column GRANTs. gender /
  // age_range stay excluded from BOTH anon AND authenticated; the ONLY new
  // exposure is this function. A stray GRANT/REVOKE/ALTER on public.profiles
  // here would mean the migration is doing more than the spec's
  // "catalog-only" promise (§4).

  it('INVARIANT: does NOT re-GRANT column SELECT (gender/age_range) on profiles to anyone', () => {
    // The whole point of the SECURITY DEFINER indirection is that NO role
    // (not anon, not authenticated) regains a direct column read on
    // gender/age_range. Executable-SQL scan: the header discusses these
    // columns' GRANT history in prose.
    expect(executableSql).not.toMatch(/GRANT SELECT \(gender/)
    expect(executableSql).not.toMatch(/GRANT SELECT \(age_range/)
    expect(executableSql).not.toMatch(
      /GRANT SELECT[\s\S]*?\bgender\b[\s\S]*?ON public\.profiles/,
    )
    expect(executableSql).not.toMatch(
      /GRANT SELECT[\s\S]*?age_range[\s\S]*?ON public\.profiles/,
    )
  })

  it('INVARIANT: performs no table-level GRANT/REVOKE/ALTER on public.profiles (catalog-only)', () => {
    // The only DDL permitted is CREATE OR REPLACE FUNCTION + GRANT EXECUTE on
    // the function. Any of these on the TABLE would change the data-exposure
    // surface and must be caught. (The header's "NO CHANGE to any table
    // GRANT" prose mentions these verbs, hence the executable-only scan.)
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
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_get_user_demographics/,
    )
  })

  it('leaves the old single-row admin_get_demographics(uuid) untouched (no DROP/redefinition here)', () => {
    // Spec §2: the single-row sibling is explicitly kept, not migrated away.
    // This migration file must not attempt to DROP or redefine it — that
    // would belong to a different, deliberately-out-of-scope PR.
    //
    // Single-line match only (`.` does not span `\n`): the file legitimately
    // contains "DROP FUNCTION" (this fn's own rollback comment, referring to
    // admin_get_user_demographics) and, separately, prose mentioning
    // `admin_get_demographics(uuid)` (the untouched sibling) — a
    // cross-line/[\s\S]*? scan would false-positive by bridging the two
    // unrelated mentions. What must never appear on ONE line is an actual DROP
    // of the OLD (non-`_user_`) single-row function.
    expect(sql).not.toMatch(/DROP FUNCTION[^\n]*\badmin_get_demographics\(uuid\)/)
    expect(sql).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_get_demographics\(target_user_id uuid\)/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Static — spec §7 item 5: cross-cutting audit, no direct .select() of
// gender/age_range on the user-scoped client anywhere in src/
// ════════════════════════════════════════════════════════════════════════════

describe('Cross-cutting audit — no user-scoped .from(\'profiles\').select(...gender/age_range...)', () => {
  // gender/age_range are excluded from the `authenticated` column GRANT
  // (20260503000001). A user-scoped `.select()` naming either column would
  // either fail with 42501 in prod, or (worse, if the GRANT is ever
  // accidentally widened) silently start leaking admin-only PII through a
  // path that bypasses the admin gate entirely. Only the admin-gated RPCs
  // (`admin_get_demographics`, `admin_get_user_demographics`) or the caller's
  // own-row RPC (`get_my_demographics`) may touch these columns.
  const ALLOWLIST = new Set<string>([])

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (entry === 'node_modules' || entry === '__tests__' || entry === '__a11y__')
        continue
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full, out)
      else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
    }
    return out
  }

  it("finds no new .from('profiles').select(...) call naming gender or age_range outside the RPC path", () => {
    const SRC = resolve(__dirname, '../../..')
    const files = walk(SRC)
    const offenders: string[] = []
    // `.from('profiles')` followed (within a reasonable window) by a
    // `.select(...)` whose argument string contains `gender` or `age_range`
    // as a bare column reference.
    const re =
      /\.from\(\s*['"]profiles['"]\s*\)[\s\S]{0,300}?\.select\(\s*[`'"][^)]*?\b(gender|age_range)\b[^)]*?[`'"]\s*\)/
    for (const f of files) {
      const text = readFileSync(f, 'utf-8')
      if (re.test(text)) {
        const rel = f.slice(f.indexOf('/src/') + 1)
        if (!ALLOWLIST.has(rel)) offenders.push(rel)
      }
    }
    expect(
      offenders,
      `User-scoped .from('profiles').select(...) naming gender/age_range bypasses the admin-gated RPC boundary and would either 42501 in prod or leak PII if the GRANT is ever widened. Offending files:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// DB-integration (skip-marked until Docker/local Supabase available) —
// spec §7 items 6-11. `docker` was confirmed NOT on PATH before writing this
// file (`docker: command not found`). Mirrors the exact skip/marker
// convention established in migration-w1-demographics.test.ts and
// migration-admin-get-user-phones.test.ts.
// ════════════════════════════════════════════════════════════════════════════

describe('DB integration — admin_get_user_demographics (TODO(gender-batch-docker))', () => {
  it.skip('unauthenticated caller (no session) RAISES forbidden, not an empty result set', async () => {
    // TODO(gender-batch-docker): unskip once a local Supabase stack is
    // available (`supabase start`).
    //
    // Setup: spawn an anon client (createClient with
    // NEXT_PUBLIC_SUPABASE_ANON_KEY, no auth session). Run:
    //   await anon.rpc('admin_get_user_demographics', { target_user_ids: [someRealUserId] })
    // Expect: error is non-null, error.message contains 'forbidden' (or the
    // PostgREST "P0001" code the RAISE EXCEPTION translates to).
    //
    // This must NOT silently return zero rows — per spec §7 item 6,
    // auth.uid() is NULL for an anon caller, but `NOT EXISTS (SELECT 1 FROM
    // profiles WHERE id = auth.uid() AND role = 'admin')` still evaluates to
    // TRUE for a NULL id (no profile row has id = NULL), so the RAISE fires.
    // Confirm this exact behaviour — it differs from get_my_demographics()'s
    // NULL-tolerant self-read pattern, which this fn deliberately does NOT
    // share (it is admin-only, not self-service).
  })

  it.skip('non-admin authenticated caller RAISES forbidden even when their own id is in the array', async () => {
    // TODO(gender-batch-docker): seed a member profile (role != 'admin') and
    // an admin profile. Sign in as the member. Call:
    //   await memberClient.rpc('admin_get_user_demographics', { target_user_ids: [memberId, adminId] })
    // Expect: error is non-null, error.message contains 'forbidden'.
    //
    // Spec §7 item 7: self-inclusion does NOT bypass the gate. Unlike
    // get_my_demographics() (no parameters, always self), this RPC is
    // admin-only — a member must not be able to read their own gender via
    // this path either (get_my_demographics is the sanctioned self-read
    // path; this one is admin-only end to end).
  })

  it.skip('admin caller with a real attendee list gets one row per matched, non-deleted profile with correct values', async () => {
    // TODO(gender-batch-docker): seed 3-5 member profiles with distinct
    // gender/age_range values plus one profile the array will NOT include.
    // Sign in as an admin. Call:
    //   await adminClient.rpc('admin_get_user_demographics', { target_user_ids: [id1, id2, id3] })
    // Expect: error is null, data has exactly 3 rows, each row's
    // gender/age_range matches the seeded value for that id, and no row
    // exists for the id that was never passed in target_user_ids (spec §7
    // item 8).
  })

  it.skip('empty array input (target_user_ids = []) returns zero rows without erroring, for an admin caller', async () => {
    // TODO(gender-batch-docker): sign in as an admin. Call:
    //   await adminClient.rpc('admin_get_user_demographics', { target_user_ids: [] })
    // Expect: error is null, data is an empty array (`p.id = ANY(ARRAY[]::uuid[])`
    // matches nothing — no exception, no rows).
  })

  it.skip('empty array input STILL raises forbidden for a non-admin caller (gate evaluated before the array is consulted)', async () => {
    // TODO(gender-batch-docker): sign in as a member (non-admin). Call:
    //   await memberClient.rpc('admin_get_user_demographics', { target_user_ids: [] })
    // Expect: error is non-null, error.message contains 'forbidden' — NOT an
    // empty success result. Spec §7 item 9: the admin gate must fire before
    // the (empty) result set is ever evaluated, proving the RAISE is
    // unconditional on array contents.
  })

  it.skip('ids not present in profiles (random UUID, no matching row) return no row for that id while still returning rows for other valid ids', async () => {
    // TODO(gender-batch-docker): seed one real member profile. Sign in as an
    // admin. Call:
    //   await adminClient.rpc('admin_get_user_demographics', { target_user_ids: [realId, randomUuid()] })
    // Expect: error is null, data has exactly 1 row (for realId); no row, no
    // error, no null-filled placeholder row for the unmatched id. Spec §7
    // item 10 — partial-match behaviour matching the admin_get_user_phones
    // precedent. Caller-side, this is what forces the Map-with-?? null
    // fallback discipline in fetchDemographicsMap.
  })

  it.skip('mixed valid + soft-deleted ids in one call: the deleted_at IS NULL filter excludes the soft-deleted row without failing the whole call', async () => {
    // TODO(gender-batch-docker): seed two member profiles, then soft-delete
    // one (UPDATE profiles SET deleted_at = now() WHERE id = deletedId). Sign
    // in as an admin. Call:
    //   await adminClient.rpc('admin_get_user_demographics', { target_user_ids: [activeId, deletedId] })
    // Expect: error is null, data has exactly 1 row (activeId), correct
    // gender/age_range; no row for deletedId, and the call does NOT throw or
    // omit activeId's row just because deletedId was also in the array. Spec
    // §7 item 11 — row-by-row filtering, not whole-call failure.
  })
})
