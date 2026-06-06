# SYSTEM-DESIGN — Corrective RLS migration for `event_reviews` admin moderation

> Produced by: Architect agent
> Date: 2026-06-04
> Status: Spec — hand to `backend-developer` next, then `tester`, then `code-reviewer`. **No frontend agent** (UI + Server Action are already correct).
> Branch (backend dev creates): `fix/event-reviews-rls-admin-moderation` from latest `main`
> Origin prompt: [prompts/fix-event-reviews-rls-admin-moderation-architect.md](prompts/fix-event-reviews-rls-admin-moderation-architect.md)

This is a focused bugfix spec. It does NOT replace [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md). It corrects two RLS policies on `public.event_reviews` via a single new, idempotent migration. No app-code changes. No schema changes. No new columns (so no anon-visibility decision is required).

---

## 0. TL;DR

Clicking **Hide** on a review in `/admin/reviews` throws `new row violates row-level security policy for table "event_reviews"`. The Server Action ([toggleReviewVisibility](src/app/(admin)/admin/actions.ts:1993)) and the UI are correct. The bug is purely in the live database policies, which have **drifted** from the repo's migration 007. Two coupled defects:

1. **`reviews_update`** — the live `WITH CHECK` almost certainly lacks the admin branch, so an admin updating *someone else's* review passes `USING` (admin branch present there) but fails `WITH CHECK` (which only allows the caller's own row). That is the exact error.
2. **`reviews_select`** — has an owner branch but **no admin branch** (true in the *repo* too, [007:35](supabase/migrations/20260402000007_create_event_reviews.sql)). So `getAdminReviews` (which uses a **user-scoped** admin client, not `service_role`) cannot see *other users'* hidden reviews — the Hidden tab is effectively empty, and the moment an admin hides a review it vanishes from their own view and can never be re-shown via the UI.

Both must be fixed together or moderation still doesn't work end-to-end.

| Policy | Repo (migration 007) | Live (drifted — to be confirmed) | After this migration |
|---|---|---|---|
| `reviews_update` USING | `owner OR admin` | `owner OR admin` (likely unchanged) | `owner OR admin` |
| `reviews_update` WITH CHECK | *(omitted → reuses USING)* | **`owner` only** (admin branch lost) — the bug | **`owner OR admin`, written explicitly** |
| `reviews_select` USING | `is_visible OR owner` | `is_visible OR owner` (no admin) | `is_visible OR owner OR admin` |
| `reviews_insert` WITH CHECK | confirmed-booking gate | (unchanged) | **untouched** |

The corrective migration `DROP`s + `CREATE`s `reviews_update` and `reviews_select` authoritatively, so it fixes the live DB **regardless of the exact drift shape**. It leaves `reviews_insert` untouched.

The decision the prompt asks me to make (§3 below) — how tightly to scope admin writes — is **Option A** (permissive admin `WITH CHECK`), with the Option B follow-up explicitly logged.

---

## Open questions for the user

I am the architect; per the prompt I make the decisions. Two items are worth surfacing **before backend implementation**. Neither blocks the backend-developer — both have architect defaults.

### OQ-1: Run the read-only `pg_policies` query and paste the result into the migration header (recommended)

This worktree has no DB password and local Supabase/Docker is down, so I could not read `pg_policies` to capture the *actual* "before" state. The corrective migration is robust either way (it `DROP`s + `CREATE`s authoritatively), but the migration header should document the confirmed live "before" shape for the record. Please run §6's query in the Supabase SQL editor and paste the output; the backend-developer drops it into the header comment verbatim.
**Architect default if no answer:** ship with the header noting the live state as "diagnosed-but-unconfirmed; corrective DROP/CREATE overrides any drift," and confirm post-merge via the same query (§9). Not a blocker.

### OQ-2: Confirm Option A (permissive admin write) vs Option B (column-restricting trigger) — §3

My call is **Option A** for this fix, with Option B logged as a follow-up tied to the multi-admin trigger. Rationale in §3. If you want the spec-literal "admins may change `is_visible` only" enforced *at the DB* right now, say so and I'll re-issue with Option B as the chosen path (the trigger SQL is fully drafted in §3.4 so the switch is cheap).
**Architect default if no answer:** Option A.

If neither needs overriding, the backend-developer can start with no further input.

---

## Things in the codebase that surprised me / are worth flagging

These are not blockers — they sharpen the spec.

1. **The prompt's summary undercounts the `event_reviews` call sites.** `grep -rn "from('event_reviews')" src/` returns **12** hits, not the handful implied. I read every one. The classification matters for the §2 owner-branch decision, so here is the full table:

   | File:line | Operation | Path / role | Filters `is_visible`? |
   |---|---|---|---|
   | [bookings/actions.ts:95](src/app/(member)/bookings/actions.ts:95) | SELECT `id` | duplicate-review check (self) | n/a (own rows) |
   | [bookings/actions.ts:113](src/app/(member)/bookings/actions.ts:113) | **INSERT** | `submitReview` (self, confirmed-booking) | n/a |
   | [profile/privacy-actions.ts:95](src/app/(member)/profile/privacy-actions.ts:95) | SELECT | GDPR data export (own rows) | no — but `user_id = auth.uid()`, owner sees own hidden via owner branch |
   | [admin/actions.ts:273](src/app/(admin)/admin/actions.ts:273) | SELECT `rating` | dashboard avg rating | **yes** (`is_visible = true`) |
   | [admin/actions.ts:1972](src/app/(admin)/admin/actions.ts:1972) | SELECT | `getAdminReviews` | optional (`all`/`visible`/`hidden`) — **needs admin SELECT branch** |
   | [admin/actions.ts:2000](src/app/(admin)/admin/actions.ts:2000) | SELECT (`.single()`) | `toggleReviewVisibility` pre-read | no filter — **needs admin SELECT branch to find hidden rows** |
   | [admin/actions.ts:2008](src/app/(admin)/admin/actions.ts:2008) | **UPDATE** `is_visible` | `toggleReviewVisibility` | the only UPDATE path; sets `is_visible` only |
   | [lib/.../reviews.ts:29](src/lib/supabase/queries/reviews.ts:29) | SELECT | homepage testimonials | **yes** |
   | [lib/.../reviews.ts:120](src/lib/supabase/queries/reviews.ts:120) | SELECT `event_id` | reviewable-events filter (self) | n/a (own rows) |
   | [lib/.../events.ts:182](src/lib/supabase/queries/events.ts:182) | SELECT | past-events card reviews | **yes** |
   | [lib/.../events.ts:301](src/lib/supabase/queries/events.ts:301) | SELECT `rating` | event-detail rating aggregate | **yes** |
   | [lib/.../events.ts:386](src/lib/supabase/queries/events.ts:386) | SELECT | `getEventReviews` (event detail) | **yes** |

   **Conclusions from the table:**
   - **Exactly ONE UPDATE path exists** ([2008](src/app/(admin)/admin/actions.ts:2008)) and it is admin-only and sets **`is_visible` only**. There is **no app-side owner-UPDATE / upsert** anywhere. So the owner branch in `reviews_update` is genuinely **spec-compliance / future-proofing**, exactly as the prompt claimed — confirmed by reading, not assumed.
   - **Every public/event-facing SELECT explicitly filters `is_visible = true`** (the four card/aggregate/detail/homepage paths). So widening `reviews_select` with an admin branch **cannot** cause any of them to over-read hidden reviews — they self-restrict. The only consumers that benefit from the admin branch are the two admin SELECTs ([1972](src/app/(admin)/admin/actions.ts:1972) and [2000](src/app/(admin)/admin/actions.ts:2000)).

2. **The prompt's §4 target string for `reviews_select` drops the owner branch.** The prompt writes the target as `USING (is_visible = true OR user_id = auth.uid() OR <is_admin>)` — which is right — but it's worth being explicit that the **repo already has the owner branch** ([007:35](supabase/migrations/20260402000007_create_event_reviews.sql): `USING (is_visible = true OR user_id = auth.uid())`). My migration **preserves** the owner branch and **adds** the admin branch. Dropping the owner branch would break the GDPR export ([privacy-actions.ts:95](src/app/(member)/profile/privacy-actions.ts:95)) and the duplicate-review check for a member whose own review was hidden. The owner branch stays.

3. **`requireAdmin` is fine — do not touch it.** It reads `role` via `.select('role')` on a **user-scoped** server client ([actions.ts:108-122](src/app/(admin)/admin/actions.ts:108)), which works because `authenticated` retains full SELECT on `profiles` ([20260420000003:65](supabase/migrations/20260420000003_harden_profiles_pii_access_fix.sql)). It is **not** `service_role`. That is exactly why `getAdminReviews` runs under RLS as the admin user and therefore needs an admin SELECT branch on the table — consistent with the established [admin PII read pattern](memory) (user-scoped client + DEFINER RPCs for revoked columns; here no revoked columns are involved, so a plain SELECT policy branch is the right tool).

4. **The `set_event_reviews_updated_at` trigger is present and benign.** [007:68-71](supabase/migrations/20260402000007_create_event_reviews.sql) wires a `BEFORE UPDATE` trigger to `public.set_updated_at()` (defined in [20260402000002](supabase/migrations/20260402000002_create_profiles.sql)). It sets `updated_at` and never touches `user_id`, so the `A_new = A_old` invariant in the prompt's proof holds, and the owner-branch `WITH CHECK` is unaffected. Under Option A it is a complete non-issue. (It would only need consideration under Option B — see §3.4.)

5. **`reviews_insert` is correct and unrelated.** [007:38-50](supabase/migrations/20260402000007_create_event_reviews.sql) — confirmed-booking gate. Untouched (§5).

---

## 1. The corrective migration

### 1.1 Filename

```
supabase/migrations/20260604000001_fix_event_reviews_rls_admin_moderation.sql
```

The most-recent applied migration is `20260602000001_admin_get_user_phones_batch.sql` (confirmed by `ls supabase/migrations/`). Today is 2026-06-04, so `20260604000001` is correctly next in sequence. Backend-developer should create it with `supabase migration new fix_event_reviews_rls_admin_moderation` and rename/confirm the timestamp is ≥ the latest applied one (do NOT hand-pick a timestamp earlier than `20260602000001`).

### 1.2 Non-negotiable constraints (restate for the backend-developer)

- **NEVER edit migration 007** ([20260402000007_create_event_reviews.sql](supabase/migrations/20260402000007_create_event_reviews.sql)). New file only (CLAUDE.md: never edit applied migrations).
- **RLS stays ENABLED throughout.** `DROP POLICY` / `CREATE POLICY` never disables RLS. Do **not** add `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` anywhere, not even transiently.
- **Idempotent.** `DROP POLICY IF EXISTS` then `CREATE POLICY` for each policy touched. A second `supabase db push` is a no-op.
- **Reuse the established admin-check idiom verbatim** for consistency and so the planner-grep stays clean:
  ```sql
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  ```
  (Indexed: PK on `profiles.id` plus `idx_profiles_role` — the subquery is an index lookup, not a scan. Matches `events_*`, `bookings_*`, the repo `reviews_update`, etc.)
- **Write `WITH CHECK` EXPLICITLY** on `reviews_update`. Do **not** rely on the implicit "omit `WITH CHECK` → Postgres reuses `USING`" default. Being explicit is the structural fix that prevents this drift class from silently recurring: the next person who edits the policy sees both clauses and can't accidentally split them with a mismatched check.
- **Touch only `reviews_update` and `reviews_select`.** Do not `DROP`/`CREATE` `reviews_insert`, the trigger, the table, the indexes, or any other table's policies.

### 1.3 Why DROP+CREATE (not ALTER POLICY)

Postgres has `ALTER POLICY`, but `DROP POLICY IF EXISTS` + `CREATE POLICY` is:
- **Idempotent and drift-proof** — it fully overwrites whatever shape exists live, which is the entire point (we don't know the exact drifted text without OQ-1). `ALTER POLICY` would require knowing the current clauses to amend them.
- **Consistent with the repo** — migration 007 itself uses `DROP POLICY IF EXISTS` then `CREATE POLICY` ([007:32-35, 38-50, 53-62](supabase/migrations/20260402000007_create_event_reviews.sql)). Match the house style.

### 1.4 Transactional safety

Supabase runs each migration file in a single transaction. Within that transaction:
- `DROP POLICY "reviews_update"` then `CREATE POLICY "reviews_update"` — between the two statements the policy is absent, but **RLS remains enabled**, so the table is in a deny-by-default state for UPDATE *for the duration of the transaction only*. No concurrent session sees a policy-less-but-RLS-on window because the changes aren't visible until commit (MVCC). Same for `reviews_select`.
- **Therefore there is no window where reviews are readable-by-all or writable-by-all.** Worst case if the migration *failed* mid-way: the whole transaction rolls back and the pre-migration policies remain intact. Confirmed safe.
- Ordering between the two policies is irrelevant (they're independent). I recommend doing `reviews_update` first then `reviews_select` purely to match the narrative; the backend-developer may order either way.

---

## 2. `reviews_update` — the fix

### 2.1 Requirements

The policy must:
- **USING** (which OLD rows an admin/owner may target): `owner OR admin`.
- **WITH CHECK** (which NEW row state is allowed after the write): `owner OR admin`, **written explicitly**.
- Keep the **owner** branch in BOTH clauses — preserves the CLAUDE.md "own review only" capability. (No app-side owner-edit path exists today — confirmed in "Things that surprised me" #1 — so this is spec-compliance / future-proofing. It is correct and harmless to keep.)
- Include the **admin** branch in BOTH clauses so an admin can update **any** review's row — this is what unblocks Hide/Show.

### 2.2 Final SQL — `reviews_update`

```sql
-- Users can edit their own review; admins can moderate (toggle is_visible on) any review.
-- WITH CHECK is written EXPLICITLY (not left to the implicit USING-reuse default) so this
-- policy cannot silently drift into a state where the admin branch is present in USING but
-- missing from WITH CHECK — which is the exact failure that caused
-- "new row violates row-level security policy for table event_reviews" on admin Hide.
DROP POLICY IF EXISTS "reviews_update" ON public.event_reviews;
CREATE POLICY "reviews_update"
  ON public.event_reviews FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

### 2.3 Why this is exactly the same admin branch twice (not a tighter `is_visible`-only check)

See the §3 decision. Under Option A the admin `WITH CHECK` is the full-row admin predicate (permissive). The owner and admin branches are identical in `USING` and `WITH CHECK` — which is intentional and is what makes the policy trivially correct (the prompt's proof: since the only live UPDATE never changes `user_id`, `WITH CHECK` evaluates to the same truth value as `USING`, so an authorised UPDATE can never be rejected by the check).

---

## 3. DECISION — how tightly to scope admin writes

**Decision: Option A (permissive admin `WITH CHECK`), with the Option B follow-up explicitly logged.**

### 3.1 The two options

- **Option A — permissive admin branch.** Admin `WITH CHECK` = the admin `EXISTS(...)` predicate, allowing an admin to set *any* column on *any* review's row. Relies on the **application** only ever sending `is_visible` — which [toggleReviewVisibility:2007-2010](src/app/(admin)/admin/actions.ts:2007) does, and it is the **only** UPDATE path in the codebase ("surprised me" #1).
- **Option B — `BEFORE UPDATE` trigger** that, for a non-owner admin, raises unless the only changed columns are `is_visible` (and `updated_at`). Honours the CLAUDE.md spec line ("UPDATE: Own review only. Admins: is_visible") literally at the DB layer.

### 3.2 Why Option A for this fix

1. **It fully unblocks the user with the minimum surface.** The bug is "admin can't hide a review." Option A is two policy statements. Option B adds a function + trigger + their own idempotency + tests + `search_path` hardening — more moving parts for a hotfix whose job is to restore moderation.
2. **It matches the current trust model.** There is a **single admin** (`mitesh50@hotmail.com` per CLAUDE.md Batch 8) and **one** server-controlled UPDATE path that sends only `is_visible`. An admin cannot reach a "change a member's `rating`/`review_text`" path through the app — no such code exists ("surprised me" #1). The permissive policy is only theoretically broader; in practice the app constrains it.
3. **Consistency with sibling policies.** `bookings_update`, `events_update`, and the *repo's own* `reviews_update` all use a permissive full-row admin branch (admins can update any column on the rows they're allowed to touch) — see [social-seen-safety-SKILL.md:89-105](social-seen-safety-SKILL.md) and [007:53-62](supabase/migrations/20260402000007_create_event_reviews.sql). Option A keeps `event_reviews` consistent with the rest of the schema; Option B would make it a one-off.
4. **The spec-literal gap is a defence-in-depth nicety, not a live vulnerability.** "Admins: is_visible only" defends against a *future* careless admin write path. None exists today. Encoding it now is premature for a single-admin demo.

### 3.3 The logged follow-up (must be recorded — see §8)

When a **second admin**, a **delegated host**, or any **non-`is_visible` admin write path** lands, upgrade to Option B (column-restricting trigger) so a careless or hostile admin write cannot silently rewrite members' `rating`/`review_text`. This is the same shape as the standing [multi-admin revisit](memory) pattern (permissive single-admin postures get re-evaluated when admin count > 1). Cross-reference that note. **Trigger SQL is pre-drafted in §3.4** so the upgrade is a copy-paste migration, not a fresh design.

### 3.4 Option B — pre-drafted trigger (NOT to be created now; reference for the follow-up)

> The backend-developer must **NOT** include this in the `20260604000001` migration. It is recorded here so the future follow-up is turnkey. If the user overrides OQ-2 to choose Option B now, this becomes part of the migration and the §2.2 admin `WITH CHECK` branch stays as-is (the trigger enforces the column restriction; the policy still grants the row).

```sql
-- FOLLOW-UP ONLY (multi-admin / delegated-host era) — do NOT ship in 20260604000001.
-- Restrict non-owner admins to changing is_visible (and the trigger-managed updated_at).
-- Runs in the updating txn; SECURITY DEFINER NOT required. If it were ever made DEFINER,
-- apply the stricter search_path = public, pg_catalog per project precedent
-- (project_security_definer_search_path_hardening).
CREATE OR REPLACE FUNCTION public.enforce_admin_review_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Owner editing their own review: unrestricted (subject to the RLS policy).
  IF NEW.user_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Non-owner reached here only because they passed the admin branch of reviews_update.
  -- Such a caller may change ONLY is_visible. updated_at is set by set_event_reviews_updated_at;
  -- compare against OLD on the immutable columns.
  IF NEW.user_id   IS DISTINCT FROM OLD.user_id
     OR NEW.event_id    IS DISTINCT FROM OLD.event_id
     OR NEW.rating      IS DISTINCT FROM OLD.rating
     OR NEW.review_text IS DISTINCT FROM OLD.review_text
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'Admins may only change is_visible on another member''s review'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Must fire BEFORE set_event_reviews_updated_at is irrelevant for correctness (we only read
-- OLD vs NEW on immutable columns), but ordering by name puts this first; acceptable either way.
DROP TRIGGER IF EXISTS enforce_admin_review_update_scope ON public.event_reviews;
CREATE TRIGGER enforce_admin_review_update_scope
  BEFORE UPDATE ON public.event_reviews
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_review_update_scope();
```

Note for the follow-up author: `set_event_reviews_updated_at` writing `updated_at` is **not** flagged as an illegal admin change because the trigger above only compares the immutable columns (`user_id, event_id, rating, review_text, created_at`) — it deliberately ignores `is_visible` and `updated_at`. This resolves edge case #5 under Option B.

---

## 4. `reviews_select` — the coupled fix

### 4.1 Requirement

Add an admin branch so admins read **all** reviews including hidden ones, while preserving the existing public (`is_visible = true`) and owner (`user_id = auth.uid()`) branches:

```
USING (is_visible = true OR user_id = auth.uid() OR <is_admin>)
```

This intentionally exposes hidden reviews **to admins** — required for the Hidden tab ([getAdminReviews](src/app/(admin)/admin/actions.ts:1972) with `filter='hidden'`) and for the re-show pre-read ([toggleReviewVisibility](src/app/(admin)/admin/actions.ts:2000)).

### 4.2 No consumer over-reads as a result — verified

I read all five non-admin SELECT paths. **Every public/event-facing one already filters `is_visible = true` in the query** ("surprised me" #1 table): homepage ([reviews.ts:35](src/lib/supabase/queries/reviews.ts:35)), past-event cards ([events.ts:185](src/lib/supabase/queries/events.ts:185)), event rating aggregate ([events.ts:304](src/lib/supabase/queries/events.ts:304)), event detail ([getEventReviews, events.ts:392](src/lib/supabase/queries/events.ts:392)), dashboard avg ([actions.ts:275](src/app/(admin)/admin/actions.ts:275)). The owner-scoped paths read only the caller's own rows. **Adding the admin branch changes nothing for any of them** — it only grants the two admin moderation SELECTs the visibility they need. Confirmed no leak.

### 4.3 Final SQL — `reviews_select`

```sql
-- Anyone reads visible reviews; an author always reads their own (incl. hidden, e.g. GDPR
-- export); admins read everything (incl. hidden) so the moderation Hidden tab works and a
-- hidden review can be re-shown. Public/event read paths all additionally filter
-- is_visible = true in-query, so the admin branch never widens public exposure.
DROP POLICY IF EXISTS "reviews_select" ON public.event_reviews;
CREATE POLICY "reviews_select"
  ON public.event_reviews FOR SELECT
  USING (
    is_visible = true
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

---

## 5. `reviews_insert` — leave untouched

[reviews_insert](supabase/migrations/20260402000007_create_event_reviews.sql:38) (the verified-attendee / confirmed-booking gate) is **correct and unrelated** to this bug. **Do not `DROP`, re-`CREATE`, or `ALTER` it.** The backend-developer must not include it in the migration. Stated explicitly so it isn't "tidied up" by reflex.

---

## 6. Read-only confirmation query (run before & after — OQ-1)

Run in the Supabase SQL editor (read-only; safe). Paste the **before** output into the migration header as the documented drift state, and re-run **after** the post-merge push to verify the fix (§9).

```sql
select policyname, cmd, qual as using_expr, with_check
from   pg_policies
where  tablename = 'event_reviews'
order  by policyname;
```

**Interpreting the "before" result:**
- If `reviews_update.with_check` is `NULL` → the live policy omitted `WITH CHECK` and Postgres reuses `USING` → the error would be *impossible* and the diagnosis would need revisiting (but the migration is still a correct no-net-change hardening — it makes the implicit check explicit).
- If `reviews_update.with_check` is non-NULL and **lacks** the `profiles ... role = 'admin'` admin branch (e.g. just `(user_id = auth.uid())`) → **diagnosis confirmed** — that is the bug.
- `reviews_select.qual` is expected to be `(is_visible = true OR user_id = auth.uid())` with **no** admin branch (matches the repo). The migration adds the admin branch.

The design does **not** depend on this result — the corrective `DROP`/`CREATE` overrides any drift either way. The query is for documentation + post-merge verification.

---

## 7. Edge cases (all 7 from the prompt, addressed)

| # | Edge case | Resolution |
|---|---|---|
| 1 | **Owner edits own review** (future UI) | Passes: `user_id = auth.uid()` branch is in BOTH `USING` and `WITH CHECK` of the new `reviews_update` (§2.2). No app path exercises this today ("surprised me" #1), but the capability is preserved per CLAUDE.md. **Confirmed.** |
| 2 | **Admin re-shows a hidden review** | Works **only** after `reviews_select` gains the admin branch (§4). The toggle's pre-read `.single()` ([2000-2003](src/app/(admin)/admin/actions.ts:2000)) currently can't find a hidden row owned by another member; with the admin SELECT branch it now can, returns `is_visible = false`, and the UPDATE flips it back to `true` (allowed by the admin `WITH CHECK`). **Confirmed — this is exactly why §4 is coupled to §2.** |
| 3 | **Admin hides their *own* review** | Passes via **either** branch (owner OR admin) in both `USING` and `WITH CHECK`. No regression. **Confirmed.** |
| 4 | **Non-admin, non-owner attempts UPDATE** | Blocked: fails the `USING` predicate (neither owner nor admin) so no row is even targetable; would also fail `WITH CHECK`. **Confirmed denied.** |
| 5 | **`set_event_reviews_updated_at` trigger fires on these UPDATEs** | Sets `updated_at`; never touches `user_id`, so `A_new = A_old` and the owner-branch `WITH CHECK` is unaffected. **Under Option A: fully compatible, no interaction.** (Under the §3.4 Option-B follow-up, the scope trigger ignores `updated_at` and `is_visible`, so the `updated_at` write is not flagged.) **Confirmed.** |
| 6 | **Transactional safety of DROP+CREATE** | Single-transaction migration; MVCC means no concurrent session observes a policy-less window; RLS stays enabled so the in-txn state is deny-by-default, never allow-all; a mid-way failure rolls back to the pre-migration policies. **Confirmed safe** (§1.4). |
| 7 | **Idempotent re-run** | `DROP POLICY IF EXISTS` + `CREATE POLICY` for each → a second `supabase db push` drops the just-created policy and recreates it identically. No-op net effect. **Confirmed.** |

---

## 8. Follow-up to log (Option B trigger)

Add to [docs/FOLLOW-UPS.md](docs/FOLLOW-UPS.md) (backend-developer creates the entry as part of the PR, matching the precedent in [SYSTEM-DESIGN-refund-fee-deduction.md §10.3](SYSTEM-DESIGN-refund-fee-deduction.md)):

```markdown
## event_reviews RLS follow-ups

- **Tighten admin review writes to is_visible-only (Option B).** 20260604000001 ships a
  permissive admin WITH CHECK on reviews_update (Option A) — fine under the single-admin trust
  model and the single app UPDATE path (toggleReviewVisibility, is_visible only). When a SECOND
  admin, a delegated host, or any non-is_visible admin write path lands, add the
  enforce_admin_review_update_scope() BEFORE UPDATE trigger (pre-drafted in
  SYSTEM-DESIGN-event-reviews-rls.md §3.4) so an admin cannot rewrite members' rating/review_text.
  Cross-ref: project_image_allowlist_revisit_on_multi_admin (same "single-admin-contingent posture"
  pattern).
```

---

## 9. Operational note (must appear in the PR description)

Because the live DB **drifted**, this migration is **corrective** — merging the PR is not enough. Per the standing rule ([project_migration_apply_step](memory)), CI applies migrations to **local Supabase only**. After merge the user must:

1. `supabase db push --include-all --linked` to apply `20260604000001` to prod.
2. Re-run the §6 `pg_policies` query and verify:
   - `reviews_update.with_check` now contains the admin branch (`... role = 'admin'`).
   - `reviews_select.qual` now contains the admin branch.
3. In `/admin/reviews`, **Hide** a real review (one authored by a *different* member, to exercise the admin-not-owner path that was failing), confirm no RLS error, confirm it moves to the **Hidden** tab, then **Show** it again (exercises edge case #2 — the re-show path that needed the SELECT admin branch).

The PR description must call out step 1 explicitly — a green CI does not mean prod is fixed.

---

## 10. How the tester validates (no Docker assumption)

Local RLS tests require `supabase start` (Docker), which is **currently down** in this environment. The test plan must therefore be written so it works **either** way:

- **If local Supabase is available:** the tester writes pgTAP / SQL RLS assertions (or Vitest against a local instance) covering the seven edge cases in §7 — most importantly: (a) admin-not-owner hides another member's review succeeds; (b) admin reads a hidden review via the Hidden filter; (c) non-admin non-owner UPDATE is denied; (d) owner can still read/edit own hidden review. These run against the migrated local DB.
- **If local Supabase is unavailable:** the **manual prod verification in §9 (step 3) is the gating check** and must be recorded as performed (with the policy-query output captured) in the PR before merge-to-prod is declared done. The tester documents this explicitly rather than silently skipping.

No new application-layer tests are required by this change (the Server Action and UI are unchanged). The tester should, however, add/keep a regression note that any **future** edit to `reviews_update` must preserve an explicit `WITH CHECK` containing the admin branch — this is the structural guard against the drift recurring. A cheap CI grep (assert the migration set still contains an explicit `WITH CHECK` admin branch for `reviews_update`) is a reasonable optional addition, mirroring the parked grep-check idea in [project_admin_actions_error_messages](memory).

---

## 11. Files affected — quick map for backend-developer

**New file:**
- `supabase/migrations/20260604000001_fix_event_reviews_rls_admin_moderation.sql` — `DROP`+`CREATE` `reviews_update` (explicit USING + explicit WITH CHECK, owner + admin) and `reviews_select` (add admin branch). Header documents: why (drift correction), the §6 before-state (from OQ-1), idempotency, "RLS stays enabled," "do not edit 007," and the §3 Option-A decision + logged follow-up.

**Documentation:**
- `docs/FOLLOW-UPS.md` — Option B follow-up entry (§8).

**Explicitly NOT touched** (state in PR to pre-empt scope creep):
- `supabase/migrations/20260402000007_create_event_reviews.sql` (the applied migration — never edit).
- `reviews_insert`, the `set_event_reviews_updated_at` trigger, the table, indexes, any other table's policies.
- [toggleReviewVisibility](src/app/(admin)/admin/actions.ts:1993), [getAdminReviews](src/app/(admin)/admin/actions.ts:1968), [ReviewsTable](src/components/admin/ReviewsTable.tsx), `requireAdmin` — all already correct.
- No new columns; no anon-visibility decision needed.

**Total files touched: 1 migration + 1 docs entry.** Well within the 15-file batch rule.

---

## Done checklist

- [x] `SYSTEM-DESIGN-event-reviews-rls.md` written, covering §1–§5 of the prompt.
- [x] Exact SQL for `reviews_update` (explicit `USING` + explicit `WITH CHECK`, owner + admin branches) drafted — **not run** (§2.2).
- [x] Exact SQL for `reviews_select` (admin branch added, owner branch preserved) drafted (§4.3).
- [x] §3 decision made and justified: **Option A** (permissive admin write), with the Option B trigger pre-drafted and the follow-up logged (§3, §8).
- [x] All 7 edge cases addressed (§7).
- [x] Read-only confirm query + manual prod-verification steps included (§6, §9).
- [x] Migration filename + idempotency + "RLS stays enabled" + "don't edit 007" stated for the backend-developer (§1.1–§1.2, §11).
- [x] Open questions surfaced at the top (OQ-1: run pg_policies; OQ-2: confirm Option A) — both have architect defaults, neither blocks.
- [x] Verified against the codebase (not the prompt's summary): 12 `event_reviews` call sites classified; exactly one UPDATE path (admin, is_visible-only); zero owner-UPDATE path; all public SELECTs filter `is_visible = true`; latest migration is `20260602000001`.

---

## HANDOVER

- **Agent:** architect
- **Task:** Spec a single corrective RLS migration for `event_reviews` so admins can hide/show reviews (fix `new row violates row-level security policy`).
- **Files changed:** `SYSTEM-DESIGN-event-reviews-rls.md` (created).
- **Migrations planned:** `supabase/migrations/20260604000001_fix_event_reviews_rls_admin_moderation.sql` — `DROP`+`CREATE` `reviews_update` (explicit USING + explicit WITH CHECK, owner + admin) and `reviews_select` (add admin branch, preserve public + owner). Not yet created — backend-developer creates via `supabase migration new`.
- **Tests added:** none (architect doesn't write tests). Validation plan in §10 (local pgTAP/SQL if Docker up; otherwise manual prod verification in §9 is the gating check).
- **Next agent:** `backend-developer` to create the migration exactly as specified (§2.2 + §4.3), add the §8 follow-up entry, and write the PR description with the §9 post-merge `supabase db push` + re-verify steps. Then `tester`, then `code-reviewer`.
- **Risks / open questions:**
  - **OQ-1** — live `pg_policies` "before" state unconfirmed (no DB password / Docker down). Migration is robust either way; user should run §6's query and paste the output into the header, then re-run post-merge.
  - **OQ-2** — Option A vs B. I chose A (matches single-admin trust model + the only app UPDATE path sends `is_visible` only). Override to B only if you want the spec-literal "admins change `is_visible` only" enforced at the DB now; §3.4 has the trigger ready.
  - **Corrective migration** — merge alone does NOT fix prod. The §9 `supabase db push --include-all --linked` + re-verify is mandatory and must be in the PR description.
  - **Coupled fix** — `reviews_select` MUST ship in the same migration as `reviews_update`, or re-show (edge case #2) stays broken and the Hidden tab stays empty.
