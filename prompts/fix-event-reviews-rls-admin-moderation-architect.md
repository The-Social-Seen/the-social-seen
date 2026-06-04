# Fix: admin can't hide reviews — `new row violates row-level security policy for table "event_reviews"`

**Agent:** `/project:architect` — produce `SYSTEM-DESIGN-event-reviews-rls.md` (root, matching the other `SYSTEM-DESIGN-*.md` docs). Spec a single corrective RLS migration. Hand off to `/project:backend-developer`, then `/project:tester`, then `/project:code-reviewer`. **No frontend agent** — the UI ([ReviewsTable](src/components/admin/ReviewsTable.tsx)) and the Server Action ([toggleReviewVisibility](src/app/(admin)/admin/actions.ts:1993)) are already correct; the bug is purely in the database policies.
**Branch (backend dev creates):** `fix/event-reviews-rls-admin-moderation` from latest `main`.
**Type:** Bugfix (RLS). One new migration file. No app-code changes expected. No new columns → no anon-visibility decision needed.

**Origin:** 2026-06-04 user report — clicking **Hide** on a review in `/admin/reviews` throws `new row violates row-level security policy for table "event_reviews"`. Diagnosed in conversation; diagnosis below is high-confidence but **one ground-truth check is still pending** (see "Confirm before finalising").

---

## Diagnosis (read before designing — this is the whole problem)

### The error is structurally impossible under the *repo* policy

The error is a `WITH CHECK` violation. The repo's `reviews_update` policy ([20260402000007_create_event_reviews.sql:53](supabase/migrations/20260402000007_create_event_reviews.sql:53)) is:

```sql
CREATE POLICY "reviews_update" ON public.event_reviews FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
  -- no explicit WITH CHECK
```

When `WITH CHECK` is omitted, Postgres reuses `USING` for it. The admin branch is **row-independent**, and the only live UPDATE path ([toggleReviewVisibility](src/app/(admin)/admin/actions.ts:2007)) changes **only `is_visible`** (never `user_id`). Proof it can't fail:

- For the UPDATE to target a row, the OLD row must satisfy `USING` = `A_old OR B` (where `A_old = old.user_id = auth.uid()`, `B = admin-exists`).
- `WITH CHECK` on the NEW row = `A_new OR B`. Since `user_id` is unchanged, `A_new = A_old`.
- So `WITH CHECK` = `A_old OR B` = the `USING` value, which was already `true`. ∎

Therefore **the live database policy differs from the repo** — it has drifted (dashboard edit, or an early policy version that migration 007 never overwrote in prod; same class as the "[migrations need a manual `supabase db push --linked`](memory)" gotcha).

### Almost-certain live shape

The drifted policy almost certainly splits `USING` and `WITH CHECK` and forgot the admin branch in the check — a literal-but-wrong reading of the CLAUDE.md RLS spec row (*"UPDATE: Own review only. Admins: is_visible"*):

```sql
USING      (user_id = auth.uid() OR <is_admin>)   -- admin may target any row
WITH CHECK (user_id = auth.uid())                 -- ❌ new row must be the caller's own
```

Admin hides someone else's review → `USING` passes (admin branch) → `WITH CHECK` fails (review isn't theirs) → the exact error.

### Coupled second bug — `reviews_select` has no admin branch

[reviews_select](supabase/migrations/20260402000007_create_event_reviews.sql:33) is `USING (is_visible = true OR user_id = auth.uid())` — **no admin clause**. Consequences, all confirmed by reading the code:

- [getAdminReviews](src/app/(admin)/admin/actions.ts:1968) uses a **user-scoped** admin client (see [requireAdmin](src/app/(admin)/admin/actions.ts:108) — it is NOT `service_role`; consistent with the [admin PII read pattern](memory)). So the **Hidden** tab (`.eq('is_visible', false)`) returns only the admin's *own* hidden reviews — effectively always empty.
- The moment an admin successfully hides a review, it flips to `is_visible = false` and **disappears from the admin's own view** — they can never re-show it through the UI.

Both must be fixed together or moderation still doesn't work end-to-end.

### Why `requireAdmin` passes but the policy's admin branch "fails"

No contradiction once you accept the drift: `requireAdmin` reads `role` via `.select('role')` (works — `authenticated` has full SELECT on profiles per [20260420000003](supabase/migrations/20260420000003_harden_profiles_pii_access_fix.sql)), and the drifted `WITH CHECK` simply doesn't *contain* an admin branch to evaluate. Don't redesign `requireAdmin` — it's fine.

---

## Confirm before finalising (ground truth the planner could not get)

This worktree has no DB password (only the anon-key `.env.local` in the main checkout) and local Supabase/Docker is down, so the planner could not read `pg_policies` directly. The design must be **robust regardless** (the corrective migration `DROP`s + `CREATE`s authoritatively, overriding any drift), but the spec should include this read-only confirmation query for the user to run in the Supabase SQL editor and paste the result into the migration's header comment as the documented "before" state:

```sql
select policyname, cmd, qual as using_expr, with_check
from pg_policies
where tablename = 'event_reviews'
order by policyname;
```

If `with_check` on `reviews_update` lacks an admin branch, diagnosis confirmed. Design must not *depend* on this — proceed either way.

---

## Required design output (`SYSTEM-DESIGN-event-reviews-rls.md`)

### 1. The corrective migration

- **Filename:** `20260604000001_fix_event_reviews_rls_admin_moderation.sql` (next in sequence — latest is `20260602000001`).
- **Do NOT edit migration 007.** New file only (CLAUDE.md: never edit applied migrations).
- Idempotent: `DROP POLICY IF EXISTS` then `CREATE POLICY` for each policy touched. Header comment documents *why* (drift correction) and the confirmed "before" state from the query above.
- **RLS stays enabled** throughout (CLAUDE.md non-negotiable). `DROP/CREATE POLICY` never disables RLS — fine.
- Reuse the established admin-check idiom verbatim for consistency: `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')`. (Indexed: PK on `profiles.id`, `idx_profiles_role`.)

### 2. `reviews_update` — the fix

Specify the exact policy. It must:
- Keep the **owner** branch (`user_id = auth.uid()`) in BOTH `USING` and `WITH CHECK` — preserves the CLAUDE.md "own review only" capability. (Note: there is currently **no app-side user-review-edit path** — reviews are insert-only from the app; the owner branch is spec-compliance/future-proofing. Verify this claim with `grep -rn "from('event_reviews')" src/` before relying on it.)
- Include the **admin** branch in BOTH `USING` and `WITH CHECK` so an admin can update **any** review's row. Write `WITH CHECK` **explicitly** (do not rely on the implicit `USING`-as-`WITH CHECK` default — being explicit is what prevents this exact drift class from silently recurring).

### 3. DECISION: how tightly to scope admin writes (`is_visible`-only vs any column)

The CLAUDE.md spec says admins get **`is_visible` only**, but a permissive `WITH CHECK` admin branch lets an admin change *any* column (rating, review_text) on *any* user's review. Choose and justify:

- **Option A — permissive admin branch** (simplest). Admin `WITH CHECK` = `is_admin`, full-row. Relies on the app only ever sending `is_visible` (which [toggleReviewVisibility](src/app/(admin)/admin/actions.ts:2007) does). Fits the current single-admin trust model. If chosen, record an explicit follow-up: enforce `is_visible`-only when a second admin / delegated host lands (cross-ref the [multi-admin revisit](memory) pattern).
- **Option B — `BEFORE UPDATE` trigger** enforcing that a non-owner admin may only change `is_visible` (and `updated_at`), raising otherwise. Honors the spec literally; defends against future careless writes. More moving parts; `SECURITY DEFINER` not required (trigger runs in the updating txn) — if any function is added, apply `search_path` hardening per project precedent.

Planner's lean: **Option A for this fix** (minimal, matches trust model, unblocks the user now) **with the Option B follow-up explicitly logged**. Architect makes the final call and documents the rationale + the follow-up.

### 4. `reviews_select` — the coupled fix

Add an admin branch so admins read all reviews incl. hidden:
`USING (is_visible = true OR user_id = auth.uid() OR <is_admin>)`. This intentionally exposes hidden reviews to admins (required for the Hidden tab + re-show). Confirm no other consumer over-reads as a result (public/event pages filter `is_visible = true` explicitly — verify in [reviews.ts](src/lib/supabase/queries/reviews.ts)).

### 5. Leave `reviews_insert` untouched

[reviews_insert](supabase/migrations/20260402000007_create_event_reviews.sql:38) (confirmed-booking gate) is correct and unrelated. Do not modify. State this explicitly so the backend dev doesn't touch it.

---

## Edge cases the spec must address (decision or "deferred — reason")

1. **Owner edits own review** (future UI) — must still pass `WITH CHECK` (`user_id = auth.uid()` branch). Confirm.
2. **Admin re-shows a hidden review** — only works once `reviews_select` has the admin branch (§4). Confirm the toggle's pre-read `.single()` ([line 1999](src/app/(admin)/admin/actions.ts:1999)) will now find hidden rows for an admin.
3. **Admin hides their *own* review** — passes via either branch. No regression.
4. **Non-admin, non-owner** attempts UPDATE — blocked by both `USING` and `WITH CHECK`. Confirm.
5. **`set_event_reviews_updated_at` trigger** fires on these UPDATEs (sets `updated_at`). Does not touch `user_id`, so the `A_new = A_old` invariant holds. Confirm it's compatible with whatever Option (A/B) is chosen — under Option B, the trigger's `updated_at` write must not be flagged as an illegal admin column change.
6. **Transactional safety of DROP+CREATE** — migration runs in one txn; no window where the table is policy-less-but-RLS-on (which would deny-all). Confirm ordering.
7. **Idempotent re-run** — applying the migration twice is a no-op. Confirm.

## Out of scope (do not expand)

- No changes to [ReviewsTable](src/components/admin/ReviewsTable.tsx) or [toggleReviewVisibility](src/app/(admin)/admin/actions.ts:1993) — already correct.
- No changes to `reviews_insert`, other tables' policies, or `requireAdmin`.
- No new columns; no `tag_kind`/`event_reviews` schema changes.
- No retrofit of `SECURITY DEFINER search_path` on unrelated functions (separate [hardening PR](memory)).
- The Option B trigger is *in scope only if the architect selects Option B*; otherwise it's a logged follow-up.

## Operational note (must appear in the spec & the eventual PR description)

Because the live DB drifted, this migration is **corrective**: merging the PR is not enough. Per the project's standing rule, after merge the user runs `supabase db push --include-all --linked` to apply to prod, then re-runs the §"Confirm" query to verify `reviews_update.with_check` now contains the admin branch, and finally hides a real review in `/admin/reviews` to confirm end-to-end. Local RLS tests require Docker/`supabase start` (currently down) — the spec should say how the tester validates (local Supabase if available; otherwise the test plan documents the manual prod verification as the gating check).

## Done checklist (architect)

- [ ] `SYSTEM-DESIGN-event-reviews-rls.md` written, covering §1–§5.
- [ ] Exact SQL for `reviews_update` (explicit `USING` + explicit `WITH CHECK`, owner + admin branches) drafted — not run.
- [ ] Exact SQL for `reviews_select` (admin branch added) drafted.
- [ ] §3 decision (Option A vs B) made, justified, with follow-up logged if A.
- [ ] All 7 edge cases addressed.
- [ ] Read-only confirm query + manual prod-verification steps included.
- [ ] Migration filename + idempotency + "RLS stays enabled" + "don't edit 007" stated for the backend dev.
- [ ] Open questions (if any) surfaced at the top for the user before backend work starts.
