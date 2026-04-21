-- Migration: notifications_recipient_user_id (P2-9)
--
-- Adds `recipient_user_id` to public.notifications and extends the
-- GDPR scrub RPC to cover rows where the deleted user was the *recipient*
-- of an admin announcement (introduced alongside the P2-9
-- "Email All Attendees" feature).
--
-- Why a new column rather than matching by recipient_email alone:
--   1. recipient_email is cleared during anonymisation (the Server
--      Action nulls it as part of profile wipe), so matching solely by
--      email requires the caller to pass the pre-anonymisation email.
--      We now do pass it, but a FK is cleaner and survives
--      hypothetical email changes.
--   2. The existing index on (channel, status, sent_at) doesn't help
--      a recipient lookup; we add a partial index keyed on the new
--      column for the scrub query.
--
-- sanitise_user_notifications is extended with an optional
-- `p_user_email` parameter (defaults NULL so any caller that forgets to
-- pass it still works). When provided, we also scrub rows matching
-- that email as a defence-in-depth belt-and-braces layer — e.g.
-- admin announcements sent before the column was populated.
--
-- RLS: notifications is admin-only (read/write/update) — unchanged.
-- No new grants needed on the new column.

-- ── Column ──────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_user
  ON public.notifications (recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;

-- ── Extended scrub RPC ─────────────────────────────────────────────────────
-- Drop the prior 1-arg overload from migration 20260424000001 first.
-- Postgres function identity is (name, argument_types) — without this
-- DROP, both `(uuid)` and `(uuid, text DEFAULT NULL)` would co-exist and
-- PostgREST would either return HTTP 300 (ambiguous) or silently route
-- single-arg callers to the OLD function (which lacks the recipient
-- scrub) — the exact GDPR regression this batch is closing.
DROP FUNCTION IF EXISTS public.sanitise_user_notifications(uuid);

CREATE OR REPLACE FUNCTION public.sanitise_user_notifications(
  p_user_id uuid,
  p_user_email text DEFAULT NULL
)
RETURNS integer AS $$
DECLARE
  v_sender_rows    integer := 0;
  v_recipient_rows integer := 0;
  v_email_rows     integer := 0;
BEGIN
  -- 1. Scrub rows where this user was the sender — preserves the
  --    existing P2-8b behaviour for transactional emails (send.ts
  --    writes sent_by = relatedProfileId which is typically the
  --    recipient's own profile id on transactional flows).
  UPDATE public.notifications
  SET    body            = '[redacted — account deleted]',
         recipient_email = NULL,
         subject         = '[redacted]'
  WHERE  sent_by = p_user_id
    AND  body != '[redacted — account deleted]';
  GET DIAGNOSTICS v_sender_rows = ROW_COUNT;

  -- 2. Scrub rows where this user was the explicit recipient of an
  --    admin announcement (recipient_user_id FK). This is the P2-9
  --    path — "Email All Attendees" writes one row per attendee with
  --    recipient_user_id set.
  UPDATE public.notifications
  SET    body            = '[redacted — account deleted]',
         recipient_email = NULL,
         subject         = '[redacted]'
  WHERE  recipient_user_id = p_user_id
    AND  body != '[redacted — account deleted]';
  GET DIAGNOSTICS v_recipient_rows = ROW_COUNT;

  -- 3. Belt-and-braces: scrub any remaining rows that still carry the
  --    deleted user's email as recipient_email. Catches rows written
  --    before recipient_user_id was populated, and any edge cases
  --    where the email was sent without a profile FK.
  IF p_user_email IS NOT NULL AND p_user_email <> '' THEN
    UPDATE public.notifications
    SET    body            = '[redacted — account deleted]',
           recipient_email = NULL,
           subject         = '[redacted]'
    WHERE  recipient_email = p_user_email
      AND  body != '[redacted — account deleted]';
    GET DIAGNOSTICS v_email_rows = ROW_COUNT;
  END IF;

  RETURN v_sender_rows + v_recipient_rows + v_email_rows;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.sanitise_user_notifications(uuid, text) FROM PUBLIC;
-- Admin client (service_role) invokes this from the Server Action.

COMMENT ON FUNCTION public.sanitise_user_notifications(uuid, text) IS
  'GDPR helper — scrubs PII from notifications rows related to a user_id. Extended in P2-9 to also scrub recipient rows by recipient_user_id FK and recipient_email match. Returns total row count scrubbed.';

-- The 1-arg overload was dropped above; this is now the sole signature.
-- p_user_email defaults to NULL so callers that genuinely have no email
-- to pass (e.g. backfill scripts on already-anonymised profiles) can
-- still invoke the function — they just lose the email-match fallback.
