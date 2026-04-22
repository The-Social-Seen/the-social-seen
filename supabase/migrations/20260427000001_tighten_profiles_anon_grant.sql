-- Migration: tighten_profiles_anon_grant
--
-- Sprint 2.5 (Phase 2.5) — Batch 1.
-- Narrows the set of profiles columns that anonymous REST callers can SELECT.
--
-- Prior state (from 20260420000003_harden_profiles_pii_access_fix):
--   anon SELECT allowed on:
--     id, email, full_name, avatar_url, job_title, company, industry, bio,
--     linkedin_url, role, onboarding_complete, referral_source, status,
--     created_at, updated_at, deleted_at
--
-- Removed in this migration (reason in parens):
--   email               — PII under UK GDPR + spammer fodder once the domain
--                         is indexed. Admin reads go via service_role; members
--                         read their own via authenticated (full SELECT).
--   onboarding_complete — internal auth-flow state; not public content.
--   referral_source     — analytics signal written by the member and read by
--                         admin; no reason for unauthenticated visibility.
--   updated_at          — internal audit metadata.
--   deleted_at          — internal audit metadata. (Row-level RLS continues
--                         to filter out soft-deleted rows via the existing
--                         USING policy, so anon queries don't see them anyway.)
--
-- Retained anon-visible columns — all genuinely needed for public event
-- rendering (host avatars / names on event cards + detail pages):
--   id, full_name, avatar_url, job_title, company, industry, bio,
--   linkedin_url, role, status, created_at
--
-- Verification plan (manual, per-column):
--   curl "$SUPABASE_URL/rest/v1/profiles?select=email" \
--        -H "apikey: $SUPABASE_ANON_KEY"
--   → expect 401 with { code: "42501", message: "permission denied ..." }
--
-- Authenticated callers retain full SELECT (declared explicitly below for
-- documentation; matches the prior migration's stance).

-- ── Drop the existing anon GRANT and re-declare with the narrower set ───────
-- Postgres doesn't allow REVOKE of individual columns from within an
-- already-narrower grant cleanly without first re-broadening. The safest
-- idempotent shape is to REVOKE SELECT on the table from anon, then
-- GRANT SELECT on the desired columns.

REVOKE SELECT ON public.profiles FROM anon;

GRANT SELECT (
  id,
  full_name,
  avatar_url,
  job_title,
  company,
  industry,
  bio,
  linkedin_url,
  role,
  status,
  created_at
) ON public.profiles TO anon;

-- ── Authenticated role retains full SELECT (explicit declaration) ───────────
GRANT SELECT ON public.profiles TO authenticated;
