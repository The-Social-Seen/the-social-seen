-- Migration: profile_nudge_tracking (P2-10)
--
-- Adds `profiles.profile_nudge_email_sent_at` so the daily edge function
-- can send the "finish your profile" nudge exactly once per member —
-- ~3 days after registration, only if their profile is <50% complete.
--
-- Why a column rather than a `notifications` dedupe_key:
--   The dedupe_key approach works for repeating event-scoped jobs
--   (venue reveals, reminders) where the key is `<template>:<event>:<user>`.
--   The profile nudge is per-user one-shot — checking a column on profiles
--   is cleaner than scanning notifications by template_name.
--
-- Why `timestamptz NULL`:
--   NULL = never sent. Non-null = the timestamp it was sent at. The
--   edge function filters on `profile_nudge_email_sent_at IS NULL`.
--
-- Grants: profiles already revokes column-level access for sensitive
-- columns (see migrations 20260420000002+, 20260423000003). This column
-- carries no PII (timestamp only) but follow the secure-by-default
-- pattern from Sprint 2 — REVOKE from anon and authenticated. The edge
-- function uses the service-role JWT which bypasses column grants.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_nudge_email_sent_at timestamptz;

REVOKE SELECT (profile_nudge_email_sent_at) ON public.profiles FROM anon;
REVOKE SELECT (profile_nudge_email_sent_at) ON public.profiles FROM authenticated;

COMMENT ON COLUMN public.profiles.profile_nudge_email_sent_at IS
  'Set by the daily-notifications edge function when the "finish your profile" nudge has been sent. NULL = not yet sent. One-shot per user; checked alongside completion score < 50%.';
