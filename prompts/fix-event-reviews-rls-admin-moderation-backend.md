# Backend: implement the corrective `event_reviews` RLS migration

**Agent:** `/project:backend-developer`. Hand off to `/project:tester`, then `/project:code-reviewer`.
**Spec:** `SYSTEM-DESIGN-event-reviews-rls.md` (authoritative — read it first, in full).
**Decision locked by user:** **Option A** (permissive admin branch; NO `BEFORE UPDATE` trigger). The Option B trigger in spec §3.4/§8 is a *follow-up only* — do **not** implement it.
**Git:** We are already on the isolated worktree branch `claude/silly-hermann-b50dde`. Do **NOT** create a new branch, do **NOT** commit, do **NOT** push. Just add the migration file to the working tree and report. The planner handles git after code review, when the user asks.

---

## The one thing to build

Create exactly one new migration file:

`supabase/migrations/20260604000001_fix_event_reviews_rls_admin_moderation.sql`

(That sequence-style name matches the repo's manual convention — cf. `20260602000001_admin_get_user_phones_batch.sql`. If you generate via `supabase migration new`, rename the result to this exact filename. Latest existing migration is `20260602000001`, so this is correctly next.)

It contains **only** the two policy redefinitions from the spec — nothing else.

### `reviews_update` (the actual bug fix)
```sql
DROP POLICY IF EXISTS "reviews_update" ON public.event_reviews;
CREATE POLICY "reviews_update"
  ON public.event_reviews FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

### `reviews_select` (coupled fix — MUST ship in the same migration)
```sql
DROP POLICY IF EXISTS "reviews_select" ON public.event_reviews;
CREATE POLICY "reviews_select"
  ON public.event_reviews FOR SELECT
  USING (
    is_visible = true
    OR user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

Match the SQL to the spec character-for-character. If the spec and this prompt ever differ, **the spec wins** — re-read it and flag the discrepancy to me rather than guessing.

## Hard constraints (CLAUDE.md — non-negotiable)
- **Do NOT edit** `20260402000007_create_event_reviews.sql` or any other applied migration. New file only.
- **Do NOT touch** `reviews_insert` (the confirmed-booking gate is correct and unrelated).
- RLS must stay **ENABLED** — `DROP/CREATE POLICY` never disables it; do not add any `DISABLE ROW LEVEL SECURITY`.
- No `DROP TABLE/TRUNCATE/DELETE`, no `service_role` anywhere, no schema/column changes, no data changes.
- Idempotent: re-running the file is a no-op (`DROP POLICY IF EXISTS` + `CREATE POLICY` gives you this).
- No app-code changes. `ReviewsTable.tsx`, `toggleReviewVisibility`, `getAdminReviews`, `requireAdmin` are all already correct.

## Migration header comment (required)
Match the header style of a recent migration (read `20260602000001_admin_get_user_phones_batch.sql` and `20260515095343_reaper_pgcron_schedule.sql` for the house style). The header must explain:
- **Why this exists:** corrective. The live DB's `reviews_update` policy drifted from repo migration 007 — it carries a `WITH CHECK` that lacks the admin branch (suspected live shape: `WITH CHECK (user_id = auth.uid())`), so an admin hiding another member's review hits `new row violates row-level security policy for table "event_reviews"`. This migration re-establishes the policies authoritatively, overriding the drift.
- **Live "before" state:** note it is **pending user confirmation** via the `pg_policies` query in spec §6 (the planner could not read prod — no DB password, Docker down). Leave a clearly-marked line the user can paste the confirmed output into. Do not block on it — the migration is correct regardless.
- **Why `WITH CHECK` is written explicitly:** relying on the implicit USING-as-WITH-CHECK default is what let this drift class hide. Explicit `WITH CHECK` makes the admin allowance unmissable.
- **Coupled `reviews_select` change:** admins must be able to read hidden reviews or the admin Hidden tab is empty and a just-hidden review can't be re-shown.
- Cross-reference: `SYSTEM-DESIGN-event-reviews-rls.md`.

## Verification before you report done
- `pnpm tsc --noEmit` — clean (sanity; no TS changed, but confirms nothing else broke).
- `pnpm lint` — clean.
- `pnpm build` — succeeds.
- **Local DB apply / RLS proof is NOT possible right now** — Docker/`supabase start` is down (planner confirmed). Do **not** attempt to push to prod or to a remote DB. If Docker happens to be available to you, `supabase start` + `supabase migration up` to confirm the file applies cleanly is a bonus — but report honestly whether you actually ran it or not. Never claim an apply you didn't perform.
- Eyeball the SQL once more against the spec.

## What to put in your handover to me
- Confirm the migration file path + that it contains ONLY the two policies (no trigger, no extra statements).
- Paste the full final SQL you wrote (so I and the tester anchor on reality, not the spec's draft).
- State explicitly whether you applied it locally (yes/no) and the result.
- `tsc` / `lint` / `build` results.
- Anything in the spec that didn't match the codebase when you looked.
- A ready-to-paste **PR description** draft including a **"Required after merge"** section with: `supabase db push --include-all --linked`, then re-run the spec §6 `pg_policies` query to confirm `reviews_update.with_check` now contains the admin branch, then hide + re-show a real review in `/admin/reviews` end-to-end. (This is the standing "migrations need a manual prod push" rule — the merge alone does not fix prod.)

## Done checklist (paste filled-in)
- [ ] `supabase/migrations/20260604000001_fix_event_reviews_rls_admin_moderation.sql` created, two policies only, matches spec SQL exactly.
- [ ] Header comment covers: corrective/why, suspected+pending-confirmation before-state, explicit-WITH-CHECK rationale, coupled select change, spec cross-ref.
- [ ] Migration 007 untouched; `reviews_insert` untouched; RLS still enabled; idempotent.
- [ ] No app-code, schema, or data changes.
- [ ] `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build` all clean.
- [ ] Local apply attempted only if Docker available; result reported honestly (no false claims).
- [ ] PR description draft with "Required after merge" prod-apply + re-verify steps provided.
- [ ] No branch created, no commit, no push.
