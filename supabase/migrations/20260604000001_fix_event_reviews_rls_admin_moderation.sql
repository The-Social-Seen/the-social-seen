-- Migration: fix_event_reviews_rls_admin_moderation
--
-- ── Why this exists (corrective) ───────────────────────────────────────────
-- Clicking "Hide" on a review in /admin/reviews throws:
--   new row violates row-level security policy for table "event_reviews"
-- The Server Action (toggleReviewVisibility), the UI (ReviewsTable), and the
-- requireAdmin gate are all CORRECT. The bug is purely in the LIVE database
-- policies, which have DRIFTED from this repo's migration 007
-- (20260402000007_create_event_reviews.sql). This migration re-establishes the
-- two affected policies AUTHORITATIVELY via DROP + CREATE, so prod is fixed
-- regardless of the exact drifted shape.
--
-- Two coupled defects, both fixed here together (fixing one alone leaves
-- moderation broken end-to-end):
--
--   1. reviews_update — the live WITH CHECK almost certainly LACKS the admin
--      branch. An admin updating SOMEONE ELSE'S review passes USING (admin
--      branch present there) but fails WITH CHECK (which only allows the
--      caller's own row). That mismatch is the exact RLS violation above.
--
--   2. reviews_select — has owner + public branches but NO admin branch (true
--      in the repo too, 007:33-35). getAdminReviews uses a USER-SCOPED admin
--      client (NOT service_role — see requireAdmin), so it runs under RLS as
--      the admin user and cannot see OTHER members' hidden reviews. The Hidden
--      tab is therefore empty, and the instant an admin hides a review it
--      vanishes from their own view and can never be re-shown via the UI.
--
-- ── Live "before" state (PENDING USER CONFIRMATION) ────────────────────────
-- This worktree has no prod DB password and local Supabase/Docker is down, so
-- the actual live policy text could not be read. The corrective DROP + CREATE
-- below overrides any drift either way, so this migration is correct
-- regardless — but for the record, run the read-only confirmation query from
-- SYSTEM-DESIGN-event-reviews-rls.md §6 and paste the output here:
--
--   select policyname, cmd, qual as using_expr, with_check
--   from   pg_policies
--   where  tablename = 'event_reviews'
--   order  by policyname;
--
--   --- CONFIRMED LIVE BEFORE-STATE (paste pg_policies output) -------------
--   reviews_update.with_check : <PASTE — expected to lack the admin branch,
--                                e.g. just (user_id = auth.uid())>
--   reviews_select.qual       : <PASTE — expected (is_visible = true OR
--                                user_id = auth.uid()), no admin branch>
--   -----------------------------------------------------------------------
--
-- Diagnosis interpretation (from §6):
--   • If reviews_update.with_check is NULL → the live policy omitted WITH CHECK
--     and Postgres reuses USING → the error would be impossible and the
--     diagnosis needs revisiting. This migration is still a correct no-net-
--     change hardening in that case (it makes the implicit check explicit).
--   • If reviews_update.with_check is non-NULL and lacks the admin branch
--     (e.g. (user_id = auth.uid())) → diagnosis CONFIRMED — that is the bug.
--
-- ── Why WITH CHECK is written EXPLICITLY ───────────────────────────────────
-- Migration 007 OMITTED WITH CHECK on reviews_update, relying on Postgres's
-- implicit "no WITH CHECK → reuse USING" default. That implicit coupling is
-- exactly what let the live policy drift into a state where the admin branch
-- survived in USING but was lost from the effective check. Writing WITH CHECK
-- EXPLICITLY here makes the admin allowance unmissable: the next person to edit
-- this policy sees BOTH clauses and cannot accidentally split them with a
-- mismatched check. This is the structural guard against the drift recurring.
--
-- ── Coupled reviews_select change ──────────────────────────────────────────
-- The reviews_select widening (adding the admin branch) MUST ship in the SAME
-- migration as the reviews_update fix. Without it: the toggle's pre-read
-- .single() cannot find a hidden row owned by another member, the Hidden tab
-- is empty, and a just-hidden review can never be re-shown. The public/event
-- read paths ALL additionally filter is_visible = true in-query (homepage,
-- past-event cards, event rating aggregate, event detail, dashboard avg), so
-- the admin branch NEVER widens public exposure — it only grants the two admin
-- moderation SELECTs the visibility they need.
--
-- ── Decision: Option A (permissive admin WITH CHECK; NO trigger) ───────────
-- Admin WITH CHECK = the full admin EXISTS(...) predicate, allowing an admin to
-- write any column on any review's row. This relies on the APPLICATION only
-- ever sending is_visible, which toggleReviewVisibility does — and it is the
-- ONLY UPDATE path in the codebase (there is no app-side owner-edit / upsert).
-- Matches the single-admin trust model and stays consistent with the
-- permissive full-row admin branches on bookings_update / events_update / the
-- repo's own reviews_update. The column-restricting BEFORE UPDATE trigger
-- (Option B, pre-drafted in SYSTEM-DESIGN-event-reviews-rls.md §3.4) is a
-- FOLLOW-UP only — to be added when a SECOND admin, a delegated host, or any
-- non-is_visible admin write path lands. It is deliberately NOT shipped here.
--
-- ── Safety / blast radius ──────────────────────────────────────────────────
--   • RLS stays ENABLED throughout. DROP POLICY / CREATE POLICY never disables
--     RLS; this migration adds NO `DISABLE ROW LEVEL SECURITY` anywhere.
--   • Single-transaction migration. Between DROP and CREATE the policy is
--     absent but RLS remains on, so the in-txn state is deny-by-default (never
--     allow-all), and MVCC means no concurrent session observes a policy-less
--     window. A mid-way failure rolls back to the pre-migration policies.
--   • Touches ONLY reviews_update and reviews_select. reviews_insert (the
--     confirmed-booking gate, 007:38-50), the set_event_reviews_updated_at
--     trigger, the table, and the indexes are all UNTOUCHED.
--   • No schema change, no column change, no data change, no new column (so no
--     anon-visibility decision is required). No service_role anywhere. No
--     DROP/TRUNCATE/DELETE. No edit to any already-applied migration file.
--   • Idempotent: DROP POLICY IF EXISTS + CREATE POLICY for each → a second
--     `supabase db push` recreates the policies identically (net no-op).
--   • Admin-check idiom is the established repo verbatim form
--     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()
--     AND role = 'admin')) — an index lookup (PK on profiles.id +
--     idx_profiles_role), matching events_*, bookings_*, the repo reviews_*.
--
-- ── Prod apply step (FLAG FOR THE HUMAN — agent does NOT run this) ──────────
-- Per MEMORY.md → "Migrations need manual `supabase db push` to prod", CI
-- applies migrations to the LOCAL Supabase only. Because the live DB DRIFTED,
-- merging this PR is NOT enough to fix prod. After merge a human must run
-- `supabase db push --include-all --linked`, then re-run the §6 pg_policies
-- query to confirm reviews_update.with_check now contains the admin branch,
-- then Hide + re-Show a real review (authored by a DIFFERENT member) in
-- /admin/reviews end-to-end.
--
-- ── Cross-reference ────────────────────────────────────────────────────────
--   • SYSTEM-DESIGN-event-reviews-rls.md (authoritative spec; §2.2 + §4.3 SQL,
--     §3 Option-A decision, §6 confirm query, §9 prod-apply steps)
--   • supabase/migrations/20260402000007_create_event_reviews.sql (the policy
--     definitions this migration corrects — never edit it)

-- ── 1. reviews_update — the bug fix ────────────────────────────────────────
-- Users can edit their own review; admins can moderate (toggle is_visible) on
-- ANY review. WITH CHECK is written EXPLICITLY (not left to the implicit
-- USING-reuse default) so this policy cannot silently drift into a state where
-- the admin branch is present in USING but missing from WITH CHECK — the exact
-- failure that caused
--   new row violates row-level security policy for table "event_reviews"
-- on admin Hide. The owner and admin branches are identical in USING and
-- WITH CHECK: since the only live UPDATE never changes user_id, WITH CHECK
-- evaluates to the same truth value as USING, so an authorised UPDATE can never
-- be rejected by the check.
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

-- ── 2. reviews_select — the coupled fix ────────────────────────────────────
-- Anyone reads visible reviews; an author always reads their own (incl. hidden,
-- e.g. GDPR export + duplicate-review check); admins read everything (incl.
-- hidden) so the moderation Hidden tab works and a hidden review can be
-- re-shown. Public/event read paths all additionally filter is_visible = true
-- in-query, so the admin branch never widens public exposure. The owner branch
-- (user_id = auth.uid()) is PRESERVED from migration 007 — dropping it would
-- break the GDPR data export and the duplicate-review check for a member whose
-- own review was hidden.
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
