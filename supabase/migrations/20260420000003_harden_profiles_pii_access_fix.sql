-- Migration: harden_profiles_pii_access_fix
--
-- Supersedes the (no-op) column REVOKE in 20260420000002. That migration
-- tried to REVOKE column-level SELECT privileges from anon, but Postgres
-- semantics mean a table-level GRANT subsumes column-level REVOKEs: if
-- `anon` already has `SELECT ON public.profiles`, revoking a narrower
-- column-level grant changes nothing. Supabase grants broad SELECT to
-- `anon` / `authenticated` by default, so the REVOKE had no effect.
--
-- Correct pattern: REVOKE the broad table-level SELECT from anon, then
-- GRANT back SELECT only on the columns that are safe to expose publicly.
--
-- Safe columns (anon can SELECT):
--   id, email, full_name, avatar_url, job_title, company, industry, bio,
--   linkedin_url, role, onboarding_complete, referral_source, status,
--   created_at, updated_at, deleted_at
--
-- Hidden from anon (PII or sensitive internal state):
--   phone_number       -- UK GDPR: personal data, not publicly visible
--   email_consent      -- marketing consent state, internal
--   email_verified     -- auth internals, not for public display
--
-- `authenticated` retains full SELECT on all columns — members need to
-- see their own consent state and admins need phone numbers for SMS
-- notifications (P2-5). Finer-grained per-row restriction for
-- authenticated callers (e.g. "only the owner can read their own
-- phone_number") can be added later via column-level grants tied to
-- a security-definer function, if we ever expose profile browsing.
--
-- IMPORTANT: when adding a new column to profiles in a future migration,
-- decide explicitly whether anon should see it. The safe default going
-- forward is NOT to add it to the anon GRANT list — a column with no
-- explicit anon grant is invisible to anon callers, even with RLS
-- `USING (true)`. This gives us "secure by default" on profile columns.
--
-- Idempotent: REVOKE is a no-op if already revoked; GRANT is a no-op
-- if already granted (with identical grantor and privileges).

-- ── Strip the broad table-level SELECT from anon ─────────────────────────────
REVOKE SELECT ON public.profiles FROM anon;

-- ── Grant back SELECT only on safe (non-PII) columns ────────────────────────
GRANT SELECT (
  id,
  email,
  full_name,
  avatar_url,
  job_title,
  company,
  industry,
  bio,
  linkedin_url,
  role,
  onboarding_complete,
  referral_source,
  status,
  created_at,
  updated_at,
  deleted_at
) ON public.profiles TO anon;

-- ── Authenticated role retains full SELECT ──────────────────────────────────
-- No change from defaults, but declared explicitly for documentation and
-- to guard against any future REVOKE from authenticated breaking app queries.
GRANT SELECT ON public.profiles TO authenticated;
