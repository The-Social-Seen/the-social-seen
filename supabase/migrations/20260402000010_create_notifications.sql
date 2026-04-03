-- Migration: 010_create_notifications
-- Admin-sent notification log (email/push — mocked for demo).
-- Amendment 1.2: includes recipient_type and recipient_event_id columns.
-- RLS: admin read/write only.

CREATE TABLE IF NOT EXISTS public.notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_by             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Amendment 1.2: targeting
  recipient_type      notification_recipient NOT NULL DEFAULT 'all',
  recipient_event_id  uuid REFERENCES public.events(id) ON DELETE SET NULL,
  type                notification_type NOT NULL,
  subject             text NOT NULL,
  body                text NOT NULL,
  sent_at             timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_sent_by ON public.notifications (sent_by);
CREATE INDEX IF NOT EXISTS idx_notifications_sent_at ON public.notifications (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_event ON public.notifications (recipient_event_id)
  WHERE recipient_event_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies — admin read/write only ─────────────────────────────────────

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select"
  ON public.notifications FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert"
  ON public.notifications FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update"
  ON public.notifications FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
