# Code review: corrective `event_reviews` RLS migration + regression test

**Agent:** `/project:code-reviewer` — final approval gate before commit. Read-only; reject-and-route, don't fix.
**Verdict required:** clear **APPROVE** or **REJECT**, with findings split into **blocking** vs **non-blocking**.

## What changed (the shippable diff)
- `supabase/migrations/20260604000001_fix_event_reviews_rls_admin_moderation.sql` — NEW. `DROP`+`CREATE` `reviews_update` (explicit `USING` + explicit `WITH CHECK`, each `owner OR admin`) and `reviews_select` (adds admin branch; preserves `is_visible = true` + owner). This is the whole fix.
- `src/lib/supabase/__tests__/event-reviews-rls-drift.test.ts` — NEW. Migration-shape regression lock (last-wins policy scan), mirroring the sibling `migration-*.test.ts` drift guards in that dir.

Supporting docs (not code — skim for accuracy, don't gate on prose): `SYSTEM-DESIGN-event-reviews-rls.md`, `prompts/fix-event-reviews-rls-admin-moderation-{architect,backend,tester}.md`.

## Background you need
- **Bug:** admin clicking Hide in `/admin/reviews` → `new row violates row-level security policy for table "event_reviews"`. Root cause: the LIVE policy drifted from repo migration 007 — its `reviews_update` `WITH CHECK` lacks the admin branch, so an admin updating another member's review passes `USING` but fails `WITH CHECK`. Coupled defect: `reviews_select` (in repo too) has no admin branch, so admins can't read hidden reviews (Hidden tab empty; can't re-show).
- **User decision locked: Option A** — permissive admin `WITH CHECK` (admin may write any column), NO column-restricting trigger. Rationale: single-admin trust model; only app UPDATE path (`toggleReviewVisibility`) sends `is_visible` only. The trigger (Option B) is a logged follow-up.
- **Constraints honoured by the change:** new migration only (007 untouched), `reviews_insert` untouched, RLS stays enabled, idempotent, no app-code/schema/data changes.
- **Environment:** Docker/local Supabase down → no runtime RLS test possible; the gating behavioural proof is the manual prod check in the PR (Hide + re-Show a *different* member's review after `supabase db push --include-all --linked`). The new test guards SQL *shape*, not runtime enforcement — by design.

## Review focus (in priority order)
1. **Security — does the fix introduce any over-exposure?**
   - `reviews_select` now returns hidden reviews to admins. Confirm the admin branch is genuinely role-gated (`EXISTS … role = 'admin'`) and cannot widen exposure to anon/non-admin/non-owner callers. Confirm public/event read paths still filter `is_visible = true` in-query (so the widening is moderation-only).
   - Option A permissive admin `WITH CHECK`: confirm the *residual* risk (an admin could in principle write `review_text`/`rating` on another member's row) is correctly bounded by "no app path does this" + single-admin trust, and that it's explicitly documented + logged as a follow-up. Flag if you think this should block (it was a deliberate user decision — disagree on the merits if warranted, but treat overriding it as a recommendation, not a unilateral block).
2. **Correctness — does the migration actually fix the bug and not regress others?**
   - The `owner OR admin` predicate is identical in `USING` and `WITH CHECK` on update, and `user_id` is never mutated → an authorised UPDATE can't be rejected by the check. Sanity-check that reasoning.
   - `reviews_select` preserves the owner branch (GDPR export / duplicate-review check depend on owners reading own hidden rows). Confirm it wasn't dropped.
   - Admin-check idiom matches repo precedent (`events_*`, `bookings_*`); indexed (`profiles` PK + `idx_profiles_role`).
3. **Migration hygiene / CLAUDE.md compliance** — idempotent (`DROP POLICY IF EXISTS` + `CREATE`), RLS never disabled, single-txn deny-by-default window (no allow-all gap), filename sequence correct (`20260604000001` after `20260602000001`), header documents the corrective intent + the pending live "before" capture slot + the manual prod-apply step.
4. **Test quality — real guard or false confidence?**
   - Does it assert the *effective* (last-wins) policy so a future migration that re-drops the admin branch fails the test? Or is it pinned to one filename (weaker)?
   - Is the SQL-text parsing robust enough not to be either brittle (fails on legal reformatting) or toothless (passes on a gutted policy because it matched the header comment)? The tester reports stripping `--` comments and splitting on the `WITH CHECK` keyword, and mutation-testing 3 bug reintroductions — validate that reasoning holds by reading the test.
   - Confirm it does NOT masquerade as runtime RLS proof (comment must be honest about shape-only).
5. **Anything touched that shouldn't be** — confirm `git status`/diff shows only the two NEW files as shippable (plus docs/prompts). No edits to 007, app code, other policies, or other migrations.

## Out of scope for your review
- Design tokens / accessibility (no UI in this change).
- The pgTAP/local-Supabase harness gap — already logged as a follow-up; note if you agree it's the right call, don't gate on it.
- Re-litigating Option A vs B as a hard block (see focus #1).

## Your verdict message must contain
- **APPROVE** or **REJECT**.
- Blocking findings (if any) with file:line and why it blocks.
- Non-blocking findings / suggestions (clearly marked optional).
- A one-line confirmation you checked the security widening (`reviews_select`) and the Option-A residual-risk acceptance.
- If APPROVE: confirm it's ready for the planner to commit (the user runs the prod `db push` + manual verification after merge).
