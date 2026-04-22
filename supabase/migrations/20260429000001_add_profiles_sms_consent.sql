-- Migration: add_profiles_sms_consent (Phase 2.5 Batch 5)
--
-- Adds `profiles.sms_consent` to gate outbound SMS sends (venue reveals
-- + day-of reminders) under UK PECR per-channel-consent rules.
--
-- UK PECR (reg 22) requires a separate opt-in for each marketing
-- channel. `profiles.email_consent` already covers email; SMS needs
-- its own flag. Default `false` so existing profiles are opted out
-- until they explicitly toggle it on via the profile page.
--
-- Anon visibility: NOT exposed — sms_consent is not public profile
-- data. Mirrors the email_consent posture from migration 20260420000003
-- / 20260427000001.
--
-- Trigger update: handle_new_user() now reads sms_consent from
-- raw_user_meta_data (same pattern as email_consent). The join form's
-- signUp Server Action writes it into metadata at signup time.

-- ── Column ──────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false;

-- ── Trigger: pick up sms_consent from signup metadata ───────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    phone_number,
    email_consent,
    sms_consent
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone_number', ''),
    COALESCE((NEW.raw_user_meta_data->>'email_consent')::boolean, false),
    COALESCE((NEW.raw_user_meta_data->>'sms_consent')::boolean, false)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- ── RLS / grants ────────────────────────────────────────────────────────────
-- Anon already has a narrow allow-list (20260427000001) that excludes
-- sms_consent. Authenticated retains full SELECT + owner-UPDATE via
-- the existing profiles policies — members can flip their own consent
-- from /profile.
--
-- No grant changes needed. Declared here for documentation.
COMMENT ON COLUMN public.profiles.sms_consent IS
  'UK PECR per-channel consent flag. Must be explicitly true for any SMS send. Default false.';
