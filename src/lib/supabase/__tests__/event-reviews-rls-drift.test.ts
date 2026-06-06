// Drift / regression guard — pins the SHAPE of the `event_reviews` RLS
// policies `reviews_update` and `reviews_select` in the migration SQL, so the
// 2026-06-04 admin-moderation fix (migration 20260604000001) cannot silently
// un-ship.
//
// ── What bug this guards ─────────────────────────────────────────────────────
// Clicking "Hide" on a review in /admin/reviews threw:
//   new row violates row-level security policy for table "event_reviews"
// The live `reviews_update` policy had drifted so the admin branch survived in
// USING but was LOST from the effective WITH CHECK — migration 007 omitted
// WITH CHECK and leaned on Postgres's implicit "no WITH CHECK → reuse USING"
// default, which is exactly how the two clauses got split. Coupled to that,
// `reviews_select` had no admin branch, so an admin (running under RLS via a
// USER-SCOPED client, not service_role) couldn't even see another member's
// hidden review to re-show it — the Hidden tab was empty and a hidden review
// could never be un-hidden via the UI. Migration 20260604000001 fixes BOTH:
// it writes WITH CHECK EXPLICITLY with the admin + owner branches, and adds the
// admin branch to reviews_select. See SYSTEM-DESIGN-event-reviews-rls.md §2-§4.
//
// ── Why a mocked Vitest test can't cover this (and this one is a "shape" test)
// Every existing reviews/moderation test mocks the Supabase client
// (`vi.mock('@/lib/supabase/server', …)` — see actions.test.ts /
// actions-moderation.test.ts / ReviewsTable.test.tsx). A mock returns whatever
// the test tells it to; it cannot evaluate a Postgres WITH CHECK at all, so a
// buggy live policy still produces green mocked tests. That blind spot is
// precisely why this bug shipped. This file does NOT prove runtime enforcement
// either — there is no pgTAP / local-Supabase harness in this repo and Docker
// is down. It asserts the POLICY SHAPE present in the migration set: that the
// effective (last-wins) definition of each policy still contains the
// load-bearing clauses. Runtime enforcement is gated by the manual prod check
// in the PR (Hide + re-Show a review authored by a DIFFERENT member after
// `db push`).
//
// ── Pattern ──────────────────────────────────────────────────────────────────
// Mirrors the repo's established static-SQL drift guards
// (migration-admin-get-user-phones.test.ts, images-drift.test.ts): read the
// source-of-truth file(s) as text and regex-assert the load-bearing clauses.
// We scan ALL supabase/migrations/*.sql (filename-sorted = apply order) and
// take the LAST `CREATE POLICY "<name>"` for each policy — "last-wins" is the
// effective live definition — so this guard keeps working if a FUTURE migration
// redefines either policy, rather than pinning one filename.
//
// ── Deliberate pragmatic looseness (documented) ──────────────────────────────
//   • SQL is parsed by regex, not a real parser. We isolate each
//     `CREATE POLICY … ;` statement, normalise whitespace, and assert required
//     substrings appear in the right clause. We do NOT validate full predicate
//     logic (e.g. that the branches are OR-combined) — overreaching there makes
//     the guard brittle against legal re-formatting. The branches we assert are
//     the ones whose ABSENCE reintroduced the bug.
//   • Line comments (`-- …`) are stripped before matching, because the
//     migration's prose header legitimately quotes the very predicates we
//     assert (`role = 'admin'`, `user_id = auth.uid()`). Without stripping, the
//     header alone could satisfy an assertion and mask a gutted policy body.
//   • USING vs WITH CHECK on reviews_update are split on the `WITH CHECK`
//     keyword (asserted to appear exactly once) rather than by paren-matching,
//     because the predicates contain balanced parens (`EXISTS ( SELECT … )`)
//     that a naive `\((.*?)\)` capture would truncate. The split is disjoint at
//     the keyword index, so a single occurrence of a branch cannot satisfy both
//     the USING and the WITH CHECK assertions.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')

// Strip `-- …` line comments so the migration's prose header (which quotes the
// predicates we assert) cannot false-positive. The `'…'` SQL literals in the
// executable body (e.g. 'admin') contain no `--`, so they survive intact.
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*$/gm, '')
}

// Whitespace-normalise so multi-line policy formatting can't make a substring
// match brittle.
function normalise(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

// Scan every migration in apply order (filenames are timestamp-prefixed, so a
// lexical sort == chronological apply order) and return the LAST
// `CREATE POLICY "<name>" … ;` statement found — the effective "last-wins"
// definition that Postgres ends up with after all migrations run. Returns the
// statement text (comment-stripped, whitespace-normalised) and its filename.
function lastWinsPolicy(policyName: string): { statement: string; file: string } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let statement: string | null = null
  let file: string | null = null

  for (const f of files) {
    const sql = stripLineComments(readFileSync(resolve(MIGRATIONS_DIR, f), 'utf-8'))
    // From the CREATE POLICY keyword for this exact name, up to its
    // terminating semicolon. `[\s\S]*?` is non-greedy so it stops at the first
    // `;` (policy statements here contain no inner semicolons). matchAll yields
    // every occurrence in the file; the last one in the last file wins.
    const re = new RegExp(`CREATE\\s+POLICY\\s+"${policyName}"[\\s\\S]*?;`, 'gi')
    for (const m of sql.matchAll(re)) {
      statement = normalise(m[0])
      file = f
    }
  }

  if (!statement || !file) {
    throw new Error(
      `No CREATE POLICY "${policyName}" found in any migration under ${MIGRATIONS_DIR}`,
    )
  }
  return { statement, file }
}

// The two predicate branches whose loss caused (or would re-cause) the bug.
const ADMIN_BRANCH = /role\s*=\s*'admin'/i // the admin EXISTS(...) branch
const OWNER_BRANCH = /user_id\s*=\s*auth\.uid\(\)/i // the owner branch

describe('event_reviews RLS policy shape (drift guard for migration 20260604000001)', () => {
  it('finds a last-wins definition for both moderated policies', () => {
    // Sanity: the scan must actually locate both policies somewhere in the set.
    // (If a refactor renamed/removed them, every assertion below would be moot,
    // so fail loudly here first.)
    const update = lastWinsPolicy('reviews_update')
    const select = lastWinsPolicy('reviews_select')
    expect(update.statement.length).toBeGreaterThan(0)
    expect(select.statement.length).toBeGreaterThan(0)
  })

  // ── reviews_update — the bug fix ───────────────────────────────────────────

  it('INVARIANT: reviews_update declares WITH CHECK EXPLICITLY (the structural anti-drift guard)', () => {
    // Migration 007 OMITTED WITH CHECK and relied on the implicit USING-reuse,
    // which is how the admin branch got lost from the effective check and
    // produced "new row violates row-level security policy". The fix is to
    // write WITH CHECK explicitly so the two clauses can never silently split
    // again. Exactly one occurrence keeps the USING/CHECK split below
    // unambiguous.
    const { statement } = lastWinsPolicy('reviews_update')
    const withCheckCount = (statement.match(/WITH\s+CHECK/gi) ?? []).length
    expect(
      withCheckCount,
      'reviews_update must declare WITH CHECK exactly once (explicit, not implicit USING-reuse)',
    ).toBe(1)
  })

  it("INVARIANT: reviews_update USING allows BOTH admin and owner (an admin can target ANYONE's review)", () => {
    // USING decides which OLD rows are targetable. The admin branch here is what
    // lets an admin reach another member's review at all; the owner branch
    // preserves the spec "own review only" capability.
    const { statement } = lastWinsPolicy('reviews_update')
    const idx = statement.search(/WITH\s+CHECK/i)
    const usingClause = statement.slice(0, idx) // disjoint from the check clause
    expect(ADMIN_BRANCH.test(usingClause), 'reviews_update USING is missing the admin branch').toBe(
      true,
    )
    expect(OWNER_BRANCH.test(usingClause), 'reviews_update USING is missing the owner branch').toBe(
      true,
    )
  })

  it('INVARIANT: reviews_update WITH CHECK allows BOTH admin and owner (the exact branch the bug dropped)', () => {
    // WITH CHECK validates the NEW row state. The admin branch MISSING here is
    // the precise drift that broke admin Hide: an admin passed USING but failed
    // the check. Both branches must be present, mirroring USING.
    const { statement } = lastWinsPolicy('reviews_update')
    const idx = statement.search(/WITH\s+CHECK/i)
    const checkClause = statement.slice(idx) // the WITH CHECK (...) tail only
    expect(
      ADMIN_BRANCH.test(checkClause),
      'reviews_update WITH CHECK is missing the admin branch — this is the regressed bug',
    ).toBe(true)
    expect(
      OWNER_BRANCH.test(checkClause),
      'reviews_update WITH CHECK is missing the owner branch',
    ).toBe(true)
  })

  // ── reviews_select — the coupled fix ───────────────────────────────────────

  it('INVARIANT: reviews_select USING contains all three branches (public, owner, admin)', () => {
    // is_visible = true → public read; user_id = auth.uid() → owner reads own
    // (incl. hidden, for GDPR export + duplicate-review check); admin branch →
    // admins read everything (incl. hidden) so the Hidden tab works and a
    // hidden review can be re-shown. Dropping the admin branch re-empties the
    // Hidden tab; dropping the owner branch breaks GDPR export. SELECT policies
    // have no WITH CHECK, so the whole statement is the USING clause.
    const { statement } = lastWinsPolicy('reviews_select')
    expect(
      /is_visible\s*=\s*true/i.test(statement),
      'reviews_select is missing the public (is_visible = true) branch',
    ).toBe(true)
    expect(
      OWNER_BRANCH.test(statement),
      'reviews_select is missing the owner (user_id = auth.uid()) branch',
    ).toBe(true)
    expect(
      ADMIN_BRANCH.test(statement),
      'reviews_select is missing the admin branch — the Hidden tab / re-show breaks without it',
    ).toBe(true)
  })
})
