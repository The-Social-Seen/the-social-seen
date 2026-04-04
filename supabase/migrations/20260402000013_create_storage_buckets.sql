-- Migration: 013_create_storage_buckets
-- Creates Supabase Storage buckets and their access policies.
-- Buckets: avatars (public read, auth write own),
--          events  (public read, admin write),
--          gallery (public read, admin write).
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING.

-- ── Create buckets ────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('events', 'events', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('gallery', 'gallery', true)
ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS policies — avatars bucket ─────────────────────────────────────
-- Public read: anyone can download avatars
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Auth users can upload their own avatar (path must start with their user ID)
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Auth users can update/replace their own avatar
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Auth users can delete their own avatar
DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;
CREATE POLICY "avatars_auth_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Storage RLS policies — events bucket ──────────────────────────────────────
-- Public read
DROP POLICY IF EXISTS "events_public_read" ON storage.objects;
CREATE POLICY "events_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'events');

-- Admin write only
DROP POLICY IF EXISTS "events_admin_insert" ON storage.objects;
CREATE POLICY "events_admin_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'events'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "events_admin_update" ON storage.objects;
CREATE POLICY "events_admin_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'events'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "events_admin_delete" ON storage.objects;
CREATE POLICY "events_admin_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'events'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── Storage RLS policies — gallery bucket ─────────────────────────────────────
-- Public read
DROP POLICY IF EXISTS "gallery_public_read" ON storage.objects;
CREATE POLICY "gallery_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'gallery');

-- Admin write only
DROP POLICY IF EXISTS "gallery_admin_insert" ON storage.objects;
CREATE POLICY "gallery_admin_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'gallery'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "gallery_admin_update" ON storage.objects;
CREATE POLICY "gallery_admin_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'gallery'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "gallery_admin_delete" ON storage.objects;
CREATE POLICY "gallery_admin_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'gallery'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
