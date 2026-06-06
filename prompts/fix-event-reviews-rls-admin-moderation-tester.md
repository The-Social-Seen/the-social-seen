# Tester: regression-lock the `event_reviews` RLS fix + confirm nothing broke

**Agent:** `/project:tester`. Hand off to `/project:code-reviewer`.
**Context docs:** `SYSTEM-DESIGN-event-reviews-rls.md` (spec, esp. §7 edge cases + §10 validation), and the migration just written: `supabase/migrations/20260604000001_fix_event_reviews_rls_admin_moderation.sql`.
**Git:** stay on the current worktree branch. Do NOT branch, commit, or push.

---

## The testing reality you must work within (read first — don't fight it)

1. **There is NO database-level RLS test harness in this project.** No pgTAP, no `supabase/tests/`. Every existing "RLS-ish" test (`src/app/(admin)/admin/__tests__/*.test.ts`, `src/lib/supabase/queries/__tests__/*.test.ts`) uses a **mocked** Supabase client (`vi.mock('@/lib/supabase/server', …)`). A mock cannot enforce a Postgres `WITH CHECK` — **which is exactly why this bug shipped undetected.** Do not pretend a mocked Vitest test proves RLS; it cannot.
2. **Docker / local Supabase is down**, so you cannot `supabase start` and run real policy assertions either. Do not attempt it; do not claim you did.
3. Therefore the *behavioural* proof for this fix is the **manual prod verification** in the PR description (Hide + re-Show a review authored by a *different* member, post `supabase db push`). Your job is NOT to replace that — it's to (a) add a repo-native regression lock so the fix can't silently un-ship, and (b) prove the change broke nothing else.

## Task 1 — Regression-lock the policy shape (the real deliverable)

Follow the repo's established **drift-test** pattern: `src/lib/utils/__tests__/images-drift.test.ts` reads a source-of-truth file as text and asserts its shape, with a thorough top-of-file "why" comment. Mirror that style.

Create a new test (suggested: `src/lib/supabase/__tests__/event-reviews-rls-drift.test.ts` — but place it wherever is most idiomatic; check where sibling supabase tests live). It must:

- Read **all** `supabase/migrations/*.sql` as text, and for each of `reviews_update` and `reviews_select`, locate the **last** `CREATE POLICY "<name>" …;` statement across the whole migration set (last-wins = the effective live definition). Assert on THAT — not on a hardcoded single filename — so the guard keeps working if a future migration redefines the policy.
- Assert for **`reviews_update`**:
  - It has an explicit `WITH CHECK` clause (not just `USING`). This is the structural guard against the original drift class — migration 007 omitted `WITH CHECK` and relied on the implicit `USING`-reuse, which is how the admin branch got lost in the effective check.
  - **Both** the `USING` and the `WITH CHECK` clauses contain the admin branch (`role = 'admin'`) **and** the owner branch (`user_id = auth.uid()`).
- Assert for **`reviews_select`**: its `USING` contains all three branches — `is_visible = true`, `user_id = auth.uid()` (owner; preserved for GDPR export + duplicate-review check), and the admin branch (`role = 'admin'`).
- Write a thorough top-of-file comment (images-drift style) explaining: what bug this guards (`new row violates row-level security policy` on admin Hide), why a *mocked* test can't cover it, and that this asserts policy **shape in the migration SQL**, not runtime enforcement (which is gated by the manual prod check).

Keep the SQL parsing pragmatic and robust, not a full parser: isolate each `CREATE POLICY` statement (from the keyword to its terminating `;`), then assert the required substrings appear within the right clause. Normalise whitespace/case so multi-line formatting doesn't make it brittle. If you find the assertions are fighting the regex, prefer a slightly looser check (e.g. "the admin predicate `role = 'admin'` appears at least twice in the reviews_update statement — once per clause") over a fragile exact match — but document any looseness in a comment.

## Task 2 — Prove nothing else broke

- Identify and run the existing tests that exercise the unchanged moderation surface — at least: `src/app/(admin)/admin/__tests__/actions.test.ts` and `…/actions-moderation.test.ts` (whichever holds the `toggleReviewVisibility` / admin-role coverage), `src/components/admin/__tests__/ReviewsTable.test.ts`, and `src/lib/supabase/queries/__tests__/reviews.test.ts`. They must still pass unchanged — **no app code changed**, so any failure is a real regression to investigate, not a test to "fix."
- Run your new test. Then run the full suite (`pnpm test`) to confirm no collateral breakage.
- `pnpm tsc --noEmit` and `pnpm lint` must stay clean (the new test file is TS — make sure it lints, incl. the `react-hooks/set-state-in-effect` CI-vs-local gotcha if any effects are involved; this test won't have effects, but lint must still pass).

## Do NOT
- Do NOT modify the migration, the Server Action, `ReviewsTable`, or any app/source file. You only add a test file.
- Do NOT add a pgTAP / `supabase start` harness here — that's a worthwhile but separate infrastructure follow-up; note it, don't build it.
- Do NOT weaken or delete existing tests to make things green.
- Do NOT claim any real-DB or local-Supabase execution.

## Your final message to me must contain
- Path to the new test file + the key assertions it makes (and any pragmatic looseness you chose, with the reason).
- Exact commands you ran and their real results (pass/fail counts). Honest — if something fails, show it.
- Confirmation the existing moderation/reviews tests still pass unchanged.
- A short **"test coverage gap" statement**: that DB-level RLS enforcement remains unverified by the automated suite, that the manual prod check is the gating proof for this fix, and a one-line recommendation on the pgTAP/local-Supabase follow-up (for the reviewer + the user to weigh).
- Filled-in done-checklist.

## Done checklist (paste filled-in)
- [ ] New drift/regression test added, scanning migrations for the last-wins definition of both policies, asserting explicit `WITH CHECK` + admin & owner branches (update) and all three branches (select).
- [ ] Thorough "why / what this does and doesn't cover" comment at the top, images-drift style.
- [ ] New test passes; reason for any pragmatic regex looseness documented.
- [ ] Existing moderation + reviews + ReviewsTable tests run and pass unchanged.
- [ ] Full `pnpm test` run; results reported honestly.
- [ ] `pnpm tsc --noEmit` + `pnpm lint` clean.
- [ ] No source/migration files modified; no branch/commit/push.
- [ ] Coverage-gap statement + pgTAP follow-up recommendation included.
