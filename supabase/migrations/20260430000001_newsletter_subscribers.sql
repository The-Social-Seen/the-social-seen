-- Migration: newsletter_subscribers (Phase 2.5 Batch 9)
--
-- Public-facing newsletter signup — decoupled from `profiles` because
-- non-members can subscribe without creating an account. For members,
-- `profiles.email_consent` remains the umbrella opt-in and stays in
-- sync with this table via the sync helper in src/lib/brevo/sync.ts.
--
-- Schema decisions:
--   - Email is the primary identity (not id). A subscriber may or may
--     not have a matching profile row; the two are joined on email
--     when a member signs up later.
--   - `status` captures the double-opt-in lifecycle:
--       pending      — email entered, confirmation not yet clicked
--       confirmed    — clicked confirmation link, on the Brevo list
--       unsubscribed — explicitly opted out (via profile toggle,
--                      one-click link, or Brevo list-unsubscribe header)
--   - `confirmation_token` is HMAC-signed (see
--     src/lib/email/newsletter-token.ts). Stored here only for
--     admin forensics — verification is stateless. When a pending
--     subscriber doesn't confirm in 30 days, the row is cleaned up
--     by a Phase 3 cron or manual admin action.
--   - `source` attributes growth: 'footer' | 'landing' | 'profile' |
--     'import'. Nullable-friendly text rather than an enum so new
--     surfaces don't need a migration.
--   - `brevo_contact_id` is Brevo's numeric contact id, stored after
--     a successful sync call so subsequent updates/removals can
--     target it directly. Nullable for rows that haven't synced yet.
--
-- RLS:
--   - SELECT: admin only. No public read — email addresses are PII
--     under UK GDPR and shouldn't be enumerable.
--   - INSERT / UPDATE / DELETE: service_role only (the Server Actions
--     use createAdminClient). No direct authenticated-user writes.

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  source              text,
  confirmation_token  text,
  brevo_contact_id    bigint,
  confirmed_at        timestamptz,
  unsubscribed_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_newsletter_status
    CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  CONSTRAINT chk_newsletter_source
    CHECK (source IS NULL OR source IN ('footer', 'landing', 'profile', 'import')),
  -- Uniqueness at the column level so Supabase's `onConflict: 'email'`
  -- upsert API can target it. Case-insensitivity is enforced at the
  -- application layer — subscribeToNewsletter + confirmNewsletter both
  -- normalise via zod's `.toLowerCase()` before write, so duplicate
  -- signups with differing case collide correctly on this constraint.
  --
  -- We deliberately avoided `CREATE UNIQUE INDEX (lower(email))` — it's
  -- the "proper" CI-unique shape but Postgres only matches ON CONFLICT
  -- to plain unique constraints or expression indexes via explicit
  -- `ON CONFLICT (lower(email))` syntax that the Supabase JS
  -- `onConflict: 'column_name'` API can't emit. Normalising app-side
  -- keeps the upsert API working with a simpler schema.
  CONSTRAINT ux_newsletter_subscribers_email UNIQUE (email)
);

-- Admin queries (e.g. "how many pending subs older than 7 days?")
-- benefit from a status index.
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_status
  ON public.newsletter_subscribers (status);

-- updated_at auto-bump trigger. Reuses the same pattern as
-- notification_preferences.
CREATE OR REPLACE FUNCTION public.touch_newsletter_subscribers()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_newsletter_subscribers_updated_at
  ON public.newsletter_subscribers;
CREATE TRIGGER trg_newsletter_subscribers_updated_at
  BEFORE UPDATE ON public.newsletter_subscribers
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_newsletter_subscribers();

-- RLS
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Admin-only SELECT. No public enumeration of subscriber emails.
CREATE POLICY "newsletter_subscribers_select_admin"
  ON public.newsletter_subscribers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- INSERT / UPDATE / DELETE: no policy means only service_role can
-- write. Server Actions use createAdminClient for every write path.

-- Explicit grants: anon + authenticated get NOTHING. Service role
-- bypasses RLS by default — no grant needed for that.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.newsletter_subscribers FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.newsletter_subscribers FROM authenticated;
-- SELECT via the admin policy above works because authenticated is
-- the role auth.uid() resolves to — the policy re-grants via RLS.
GRANT SELECT ON public.newsletter_subscribers TO authenticated;

COMMENT ON TABLE public.newsletter_subscribers IS
  'Newsletter signup list. Separate from profiles so non-members can subscribe. Members stay in sync via Brevo (see src/lib/brevo/sync.ts).';
