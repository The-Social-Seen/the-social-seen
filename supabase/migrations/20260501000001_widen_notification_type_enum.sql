-- CL-3 follow-up (P2-5): widen notification_type enum with values that
-- the daily-notifications edge function already sends but was forced to
-- label as 'reminder' for enum reasons.
--
-- Why:
--   The edge function's `sendWithLog` helper hardcoded
--   `type = 'reminder'` for every new audit row, regardless of whether
--   the template was a venue reveal, review request, or profile nudge.
--   Nothing in app code branches on the `type` column today, but the
--   admin audit filters key off it, so "reminder" misleads the operator
--   when they're reading the notifications table.
--
-- Anon impact: none — the notifications table is not anon-visible.
--
-- Follow-up (separate PR): update the edge function to pass the
-- correct `type` per template once this migration is applied to all
-- environments.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'venue_reveal';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'review_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'profile_nudge';
