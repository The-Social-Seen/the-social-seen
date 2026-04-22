-- Migration: notification_preferences (Phase 2.5 Batch 2 — GDPR)
--
-- UK PECR + GDPR require a working one-click unsubscribe for
-- marketing-adjacent emails. Pre-Batch-2 state: every email had a
-- placeholder `<a href="#">Unsubscribe</a>` link. This migration adds
-- the database side of per-category preferences; the Node + Deno send
-- paths read from it before dispatching marketing emails.
--
-- Why per-category and not a single boolean:
--   Some users want event reminders but not the post-event "How was it?"
--   review-request nag. Others want review requests (they enjoy leaving
--   feedback) but don't want the 3-day profile-completion nudge. The
--   existing `profiles.email_consent` is kept as the umbrella marketing
--   opt-in — a user with email_consent=false receives nothing optional,
--   regardless of the per-category toggles.
--
-- Categories in this table:
--   review_requests    — day-after-event review prompt (P2-5)
--   profile_nudges     — 3-day post-signup profile-completion email (P2-10)
--   admin_announcements — "Email all attendees" broadcasts (P2-9)
--
-- NOT in this table (transactional — sent regardless of preferences):
--   booking_confirmation, otp, venue_reveal, event_reminder,
--   cancellation_confirmation, waitlist_spot_available, welcome.
--   These are either a direct response to user action (confirmation,
--   OTP, cancellation) or delivering the core service the user booked
--   (venue reveal, event reminder — they can't attend without them).
--
-- Row per profile. Auto-created by trigger when a profile is inserted.
-- All booleans default true (opt-out model) — this is permissible under
-- UK PECR because users can only reach these emails after an opted-in
-- signup (profiles.email_consent gates the initial umbrella opt-in).
--
-- RLS: user can read + update their own row; admin can read all.
-- anon has no access (no use case).

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id               uuid        PRIMARY KEY
                                    REFERENCES public.profiles(id) ON DELETE CASCADE,
  review_requests       boolean     NOT NULL DEFAULT true,
  profile_nudges        boolean     NOT NULL DEFAULT true,
  admin_announcements   boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_preferences IS
  'Per-category email preferences. Marketing-adjacent emails check this before send. Transactional emails (booking confirmation, OTP, venue reveal, reminder) bypass it entirely.';

-- ── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_notification_preferences()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at
  ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_notification_preferences();

-- ── Auto-create a row for every new profile ─────────────────────────────────
-- Hooks off the existing public.profiles row — simplest guarantee of
-- "every user has a preferences row." Backfill for existing users below.
CREATE OR REPLACE FUNCTION public.handle_new_profile_preferences()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

DROP TRIGGER IF EXISTS trg_profiles_create_preferences ON public.profiles;
CREATE TRIGGER trg_profiles_create_preferences
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_profile_preferences();

-- Backfill for profiles that already exist. ON CONFLICT makes this a no-op
-- if re-run.
INSERT INTO public.notification_preferences (user_id)
SELECT id FROM public.profiles
WHERE deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- SELECT: own row, or admin.
CREATE POLICY "notification_preferences_select_own"
  ON public.notification_preferences
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- UPDATE: own row only. (Admin has no legitimate need to flip a user's
-- preferences — those changes must be initiated by the user.)
CREATE POLICY "notification_preferences_update_own"
  ON public.notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- INSERT: only via the trigger (service_role-equivalent from the
-- SECURITY DEFINER function). We don't grant INSERT to any role directly.

-- No column-level GRANTs to anon — the public/unsubscribe flow uses a
-- server-side Server Action with the admin client + HMAC token verify,
-- not a direct REST call.
REVOKE SELECT ON public.notification_preferences FROM anon;

-- authenticated: default SELECT / UPDATE on own row via RLS above.
GRANT SELECT, UPDATE ON public.notification_preferences TO authenticated;
