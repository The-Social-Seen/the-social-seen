-- Fix events SELECT policy to exclude soft-deleted events from public reads.
-- Admins retain full visibility (including deleted events) for audit purposes.

DROP POLICY IF EXISTS "events_select" ON public.events;

CREATE POLICY "events_select"
  ON public.events FOR SELECT
  USING (
    (is_published = true AND deleted_at IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
