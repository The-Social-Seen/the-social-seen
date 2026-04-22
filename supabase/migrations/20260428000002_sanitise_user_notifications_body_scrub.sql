-- Migration: sanitise_user_notifications_body_scrub (Phase 2.5 Batch 2 — GDPR)
--
-- Extends the GDPR scrub RPC to purge references to a deleted user
-- inside `notifications.body` HTML of rows where the deleted user
-- was NEITHER sender NOR recipient.
--
-- Motivation (tracked in docs/FOLLOW-UPS.md, P2-4 code review):
--   Admin-announcement emails are composed by the admin as free text.
--   They can reference other members by name or email — e.g.
--   "Charlotte Davis will be hosting the next pop-up". When Charlotte
--   deletes her account, her name persists in every announcement body
--   that mentioned her — those rows are sent by admin (not Charlotte),
--   and Charlotte is only one of N recipients. The prior scrub passes
--   (sender, recipient_user_id, recipient_email) don't touch these rows.
--
-- Approach — scrub the whole body of any row whose HTML contains the
-- deleted user's email OR full_name. Collateral damage (wiping bodies
-- that coincidentally mention the name) is an acceptable tradeoff for
-- GDPR completeness — the notifications table is an audit log; the
-- content has already been delivered; losing body prose for audit rows
-- is strictly preferable to leaving identifying data in the DB after an
-- Article 17 erasure request.
--
-- Full_name matching is case-insensitive and requires name length >= 4
-- to avoid wiping every email when the user's full_name happens to be
-- "Al" or similar. Email matching is always safe (emails are unique
-- within the install).
--
-- Signature change: adds optional p_user_full_name. Default NULL so
-- existing callers that don't pass it continue to work (and simply
-- skip the name scrub). Drop + recreate the prior 2-arg overload to
-- avoid PostgREST resolution ambiguity (same pattern as 20260425000001).

DROP FUNCTION IF EXISTS public.sanitise_user_notifications(uuid, text);

CREATE OR REPLACE FUNCTION public.sanitise_user_notifications(
  p_user_id        uuid,
  p_user_email     text DEFAULT NULL,
  p_user_full_name text DEFAULT NULL
)
RETURNS integer AS $$
DECLARE
  v_sender_rows        integer := 0;
  v_recipient_rows     integer := 0;
  v_email_rows         integer := 0;
  v_body_email_rows    integer := 0;
  v_body_name_rows     integer := 0;
BEGIN
  -- 1. Sender rows (transactional emails write sent_by = recipient's
  --    profile id; same as before).
  UPDATE public.notifications
  SET    body            = '[redacted — account deleted]',
         recipient_email = NULL,
         subject         = '[redacted]'
  WHERE  sent_by = p_user_id
    AND  body != '[redacted — account deleted]';
  GET DIAGNOSTICS v_sender_rows = ROW_COUNT;

  -- 2. Recipient rows by FK (admin announcements after P2-9).
  UPDATE public.notifications
  SET    body            = '[redacted — account deleted]',
         recipient_email = NULL,
         subject         = '[redacted]'
  WHERE  recipient_user_id = p_user_id
    AND  body != '[redacted — account deleted]';
  GET DIAGNOSTICS v_recipient_rows = ROW_COUNT;

  -- 3. Recipient rows by email (belt-and-braces for pre-FK backfills).
  IF p_user_email IS NOT NULL AND p_user_email <> '' THEN
    UPDATE public.notifications
    SET    body            = '[redacted — account deleted]',
           recipient_email = NULL,
           subject         = '[redacted]'
    WHERE  recipient_email = p_user_email
      AND  body != '[redacted — account deleted]';
    GET DIAGNOSTICS v_email_rows = ROW_COUNT;
  END IF;

  -- 4. Cross-reference rows — any body mentioning the deleted user's
  --    email, regardless of sender/recipient identity.
  IF p_user_email IS NOT NULL AND p_user_email <> '' THEN
    UPDATE public.notifications
    SET    body    = '[redacted — account deleted]',
           subject = '[redacted]'
    WHERE  body ILIKE '%' || p_user_email || '%'
      AND  body != '[redacted — account deleted]';
    GET DIAGNOSTICS v_body_email_rows = ROW_COUNT;
  END IF;

  -- 5. Cross-reference rows — body mentions the deleted user's full name.
  --    Minimum 4 chars to avoid catastrophic matches on short names.
  --    ILIKE is case-insensitive; we bracket with spaces/punctuation-
  --    insensitive substring match via % on both sides.
  IF p_user_full_name IS NOT NULL
     AND length(trim(p_user_full_name)) >= 4 THEN
    UPDATE public.notifications
    SET    body    = '[redacted — account deleted]',
           subject = '[redacted]'
    WHERE  body ILIKE '%' || trim(p_user_full_name) || '%'
      AND  body != '[redacted — account deleted]';
    GET DIAGNOSTICS v_body_name_rows = ROW_COUNT;
  END IF;

  RETURN v_sender_rows
       + v_recipient_rows
       + v_email_rows
       + v_body_email_rows
       + v_body_name_rows;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION
  public.sanitise_user_notifications(uuid, text, text) FROM PUBLIC;

COMMENT ON FUNCTION
  public.sanitise_user_notifications(uuid, text, text) IS
  'GDPR helper — scrubs PII from notifications rows related to a user_id. Five passes: sender, recipient_user_id, recipient_email, body-mentions-email, body-mentions-full_name. Returns total row count scrubbed.';
