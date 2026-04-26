-- Migration: create_tags_and_event_tags
--
-- Phase 3, Wave 2 (Migration 2) of the Member Data Layer build.
-- Spec: docs/member-data-layer-spec.md (Decisions 3, 4, 5, 6, 7, 8 + SQL
-- fragments "New tables (Migration 2)" / "Tag seed insert (Migration 2)" /
-- "Event-tags backfill (Migration 2)" / "Bidirectional sync trigger
-- (Migration 2)").
--
-- ── Pairing note ────────────────────────────────────────────────────────────
-- This migration is paired with 20260504000002_migrate_user_interests_to_tag_id.sql
-- (Migration 3). The pair must apply in order: this migration creates `tags`,
-- then Migration 3 adds the FK on `user_interests.tag_id` referencing the
-- rows seeded here. Both ship in the same PR for the same reason.
--
-- ── What this migration does ────────────────────────────────────────────────
--   1. Creates `public.tags` — canonical taxonomy table. parent_id nullable
--      (hierarchy column shipped from day one even though hierarchy semantics
--      are out of scope for this phase — see Decision 3).
--   2. Creates `public.event_tags(event_id, tag_id, is_primary)` join table
--      with the partial unique index `WHERE is_primary = true` enforcing
--      "at most one primary tag per event" at the storage layer.
--   3. Seeds `tags` with the 23-row canonical taxonomy (15 primary-eligible
--      sort 10–150 + 8 interest-only sort 200–270 — see Decision 4).
--   4. Backfills `event_tags` from existing events:
--        - Step 1: 22 per-event UUID overrides (the audited reclassifications)
--        - Step 2: default fallback for the remaining 11 events using
--          `events.category` → primary slug
--        - Step 3: secondary tag rows for 14 multi-tagged events (17 secondary
--          INSERTs total)
--        - Step 4: defensive verification — RAISE EXCEPTION if any event
--          lacks a primary or has more than one
--   5. Installs the bidirectional sync trigger (`events.category` ↔ primary
--      `event_tags`) so existing read paths continue working until F1 drops
--      the `events.category` enum. Includes the static slug→enum mapping
--      function `_tag_slug_to_legacy_category()` (lossy 15→9 collapse, doomed
--      in F1 / Migration 4).
--   6. Sets up RLS policies + GRANTs on both new tables.
--
-- ── Anon-visibility decisions (per CLAUDE.md rule) ──────────────────────────
--   tags: PUBLIC SELECT. The taxonomy is genuine public data — anonymous
--     visitors filtering events on the landing page need to enumerate the
--     active tags. Inactive tags are admin-only via the SELECT policy.
--   event_tags: PUBLIC SELECT for published, non-deleted events. Draft / soft-
--     deleted event tags are admin-only via the SELECT policy. Pattern
--     mirrors the existing `events_select` posture.
--
-- ── Out of scope (held for follow-up migrations) ────────────────────────────
--   • F1 / Migration 4 — drop `events.category` enum, drop the trigger
--     functions, drop `_tag_slug_to_legacy_category`. Held until application
--     code reads from `event_tags` directly.
--   • F2 — drop `user_interests.interest` text column. Held until application
--     reads from `user_interests.tag_id` join via `tags`.
--
-- ── Safety / blast radius ───────────────────────────────────────────────────
--   • Both new tables are additive — zero impact on existing queries until
--     the application opts in to reading from them.
--   • The bidirectional trigger keeps `events.category` in lockstep with
--     primary `event_tags`. Existing reads of `events.category` continue
--     working through the dual-write window.
--   • The trigger's slug→enum mapping is LOSSY (15 primary slugs → 9 enum
--     values). E.g. flipping primary from `theatre-comedy` to `galleries-
--     museums` keeps `events.category = 'cultural'` (no-op for the enum
--     column). This is intentional — `events.category` is "best-effort
--     legacy display value" during the dual-write window, not source of
--     truth post-migration.
--   • Both trigger functions short-circuit on `pg_trigger_depth() > 1` to
--     break the cycle. Side B additionally short-circuits via `IS DISTINCT
--     FROM` to avoid no-op writes that would re-fire Side A.
--   • The partial unique index is created AFTER the backfill, so any
--     defect that produced two primaries for one event_id would surface as
--     an explicit RAISE EXCEPTION in Step 4 BEFORE the index is built (and
--     the index then provides the permanent storage-level guarantee).
--
-- ── Idempotency ─────────────────────────────────────────────────────────────
--   • CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP TRIGGER
--     IF EXISTS for the trigger creation.
--   • Tag seed uses ON CONFLICT (slug) DO NOTHING.
--   • Backfill INSERTs use ON CONFLICT (event_id, tag_id) DO NOTHING.
--   • CREATE OR REPLACE FUNCTION re-runs cleanly.
--   • Verification block raises explicitly on inconsistency (does not
--     silently retry).
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--   Drop the two triggers, drop `_tag_slug_to_legacy_category`, drop the
--   trigger functions, drop event_tags, drop tags. Application reverts to
--   reading `events.category` directly (which has been kept in sync
--   throughout the dual-write window).

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. tags table                                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  label       text NOT NULL,
  parent_id   uuid REFERENCES public.tags(id) ON DELETE SET NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tags IS
  'Canonical taxonomy. 15 primary-eligible + 8 interest-only rows seeded by Migration 2. The is_primary_eligible business rule lives in src/lib/constants.ts (PRIMARY_ELIGIBLE_TAG_SLUGS), not on this table — see Decision 4.';
COMMENT ON COLUMN public.tags.parent_id IS
  'Nullable FK for future hierarchy. All values are NULL on Day 1; hierarchy semantics are out of scope for Phase 3.';
COMMENT ON COLUMN public.tags.is_active IS
  'Soft retirement. Inactive tags are hidden from member-facing pickers but kept so existing event_tags rows stay valid.';

CREATE INDEX IF NOT EXISTS idx_tags_parent ON public.tags(parent_id);
CREATE INDEX IF NOT EXISTS idx_tags_active_sort
  ON public.tags(is_active, sort_order);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tags_select_active" ON public.tags;
CREATE POLICY "tags_select_active"
  ON public.tags FOR SELECT
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "tags_insert_admin" ON public.tags;
CREATE POLICY "tags_insert_admin"
  ON public.tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "tags_update_admin" ON public.tags;
CREATE POLICY "tags_update_admin"
  ON public.tags FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- No DELETE policy: tags retire via is_active = false, never hard delete.

GRANT SELECT ON public.tags TO anon, authenticated;
GRANT INSERT, UPDATE ON public.tags TO authenticated;

DROP TRIGGER IF EXISTS set_tags_updated_at ON public.tags;
CREATE TRIGGER set_tags_updated_at
  BEFORE UPDATE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. event_tags table                                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.event_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES public.tags(id)   ON DELETE RESTRICT,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_event_tags_event_tag UNIQUE (event_id, tag_id)
);

COMMENT ON TABLE public.event_tags IS
  'Join table connecting events to their taxonomy tags. Exactly one row per event has is_primary = true (enforced by partial unique index uq_event_tags_one_primary). Secondary rows count is unbounded.';
COMMENT ON COLUMN public.event_tags.is_primary IS
  'TRUE for the event''s primary tag (drives the legacy events.category sync trigger). FALSE for secondary tags. Partial unique index allows exactly-one-true per event_id.';

CREATE INDEX IF NOT EXISTS idx_event_tags_event ON public.event_tags(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_tag   ON public.event_tags(tag_id);

ALTER TABLE public.event_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_tags_select" ON public.event_tags;
CREATE POLICY "event_tags_select"
  ON public.event_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_tags.event_id
        AND e.deleted_at IS NULL
        AND (
          e.is_published = true
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
          )
        )
    )
  );

DROP POLICY IF EXISTS "event_tags_insert_admin" ON public.event_tags;
CREATE POLICY "event_tags_insert_admin"
  ON public.event_tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "event_tags_update_admin" ON public.event_tags;
CREATE POLICY "event_tags_update_admin"
  ON public.event_tags FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "event_tags_delete_admin" ON public.event_tags;
CREATE POLICY "event_tags_delete_admin"
  ON public.event_tags FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

GRANT SELECT ON public.event_tags TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_tags TO authenticated;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Tag seed — 23 canonical rows (Decision 4)                               ║
-- ║ 15 primary-eligible (sort 10–150) + 8 interest-only (sort 200–270).        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

INSERT INTO public.tags (slug, label, sort_order, is_active) VALUES
  -- ── Primary-eligible (15) ─────────────────────────────────────────
  ('drinks-bars',                 'Drinks & Bars',              10,  true),
  ('dining-supper-clubs',         'Dining & Supper Clubs',      20,  true),
  ('activities-social-games',     'Activities & Social Games',  30,  true),
  ('nightlife-dancing',           'Nightlife & Dancing',        40,  true),
  ('live-music-gigs',             'Live Music & Gigs',          50,  true),
  ('theatre-comedy',              'Theatre & Comedy',           60,  true),
  ('galleries-museums',           'Galleries & Museums',        70,  true),
  ('festivals-seasonal',          'Festivals & Seasonal',       80,  true),
  ('sport-fitness',               'Sport & Fitness',            90,  true),
  ('outdoor-picnics',             'Outdoor & Picnics',         100,  true),
  ('weekends-travel',             'Weekends & Travel',         110,  true),
  ('themed-socials',              'Themed Socials',            120,  true),
  ('charity-volunteering',        'Charity & Volunteering',    130,  true),
  ('wellness-mindfulness',        'Wellness & Mindfulness',    140,  true),
  ('workshops-masterclasses',     'Workshops & Masterclasses', 150,  true),
  -- ── Interest-only (8) ─────────────────────────────────────────────
  -- Slugs prefixed with 'interest-' to disambiguate from primary tags.
  ('interest-technology',         'Technology',                200,  true),
  ('interest-entrepreneurship',   'Entrepreneurship',          210,  true),
  ('interest-networking',         'Networking',                220,  true),
  ('interest-photography',        'Photography',               230,  true),
  ('interest-travel',             'Travel',                    240,  true),
  ('interest-books-literature',   'Books & Literature',        250,  true),
  ('interest-sustainable-living', 'Sustainable Living',        260,  true),
  ('interest-film-cinema',        'Film & Cinema',             270,  true)
ON CONFLICT (slug) DO NOTHING;

-- Defensive: verify the seed produced exactly 23 rows. If a previous
-- partial run left rows behind that don't match the canonical list, this
-- catches the drift early.
DO $$
DECLARE
  tag_count int;
BEGIN
  SELECT count(*) INTO tag_count FROM public.tags;
  IF tag_count <> 23 THEN
    RAISE EXCEPTION 'Tag seed produced % rows, expected 23', tag_count;
  END IF;
END $$;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. Slug → legacy event_category mapping function                           ║
-- ║ Lossy 15 → 9 collapse. Used by Side B of the bidirectional trigger.        ║
-- ║ Becomes dead code after F1 / Migration 4 drops events.category.            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public._tag_slug_to_legacy_category(p_slug text)
RETURNS public.event_category
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN CASE p_slug
    WHEN 'drinks-bars'              THEN 'drinks'::public.event_category
    WHEN 'dining-supper-clubs'      THEN 'dining'::public.event_category
    WHEN 'activities-social-games'  THEN 'activity'::public.event_category
    WHEN 'nightlife-dancing'        THEN 'drinks'::public.event_category   -- closest existing enum
    WHEN 'live-music-gigs'          THEN 'music'::public.event_category
    WHEN 'theatre-comedy'           THEN 'cultural'::public.event_category
    WHEN 'galleries-museums'        THEN 'cultural'::public.event_category
    WHEN 'festivals-seasonal'       THEN 'cultural'::public.event_category
    WHEN 'sport-fitness'            THEN 'sport'::public.event_category
    WHEN 'outdoor-picnics'          THEN 'activity'::public.event_category
    WHEN 'weekends-travel'          THEN 'activity'::public.event_category
    WHEN 'themed-socials'           THEN 'drinks'::public.event_category   -- themed parties are typically drinks-led
    WHEN 'charity-volunteering'     THEN 'cultural'::public.event_category
    WHEN 'wellness-mindfulness'     THEN 'wellness'::public.event_category
    WHEN 'workshops-masterclasses'  THEN 'workshops'::public.event_category
    -- Interest-only slugs (interest-…) deliberately fall through to NULL.
    -- The Side B trigger raises explicitly if it ever sees a NULL return,
    -- guarding against an admin somehow flipping is_primary = true on an
    -- interest-only tag (which the application layer also rejects).
    ELSE NULL
  END;
END;
$$;

COMMENT ON FUNCTION public._tag_slug_to_legacy_category(text) IS
  'Static slug → legacy event_category mapping. Lossy 15→9 collapse used during the dual-write window. Dropped in F1 / Migration 4 along with the events.category column.';

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. Event-tags backfill (Decision 9 + product owner audit)                  ║
-- ║ 4 steps: per-event override → default fallback → secondaries → verify.     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ── Step 1: Primary tags for the 22 audited events ─────────────────
-- Per-event UUID-keyed overrides. Each row maps an existing seed event to
-- its sharper canonical primary tag (the audit replaced the legacy enum
-- assignment with a more specific tag). Comments echo the spec exactly.
INSERT INTO public.event_tags (event_id, tag_id, is_primary)
SELECT
  v.event_id::uuid,
  t.id,
  true
FROM (VALUES
  -- Cultural reclassifications (8)
  ('e1000000-0000-0000-0000-000000000008', 'weekends-travel'),       -- Cotswolds Weekend
  ('e1000000-0000-0000-0000-000000000012', 'festivals-seasonal'),    -- Fireworks Night, Totteridge
  ('e1000000-0000-0000-0000-000000000013', 'theatre-comedy'),        -- Comedy & Dinner in Angel
  ('e1000000-0000-0000-0000-000000000014', 'galleries-museums'),     -- Tate Late
  ('e1000000-0000-0000-0000-000000000016', 'charity-volunteering'),  -- Christmas Eve Volunteering with Crisis
  ('e1000000-0000-0000-0000-000000000023', 'theatre-comedy'),        -- Queen of Wands at Union Theatre
  ('e1000000-0000-0000-0000-000000000026', 'outdoor-picnics'),       -- Picnic in Regent's Park
  ('e1000000-0000-0000-0000-000000000030', 'festivals-seasonal'),    -- Winter Wonderland
  -- Sport reclassifications (7)
  ('e1000000-0000-0000-0000-000000000003', 'activities-social-games'), -- Axe Throwing & Drinks
  ('e1000000-0000-0000-0000-000000000007', 'activities-social-games'), -- Flight Club + Little Scarlett Door
  ('e1000000-0000-0000-0000-000000000010', 'weekends-travel'),         -- Hiking in Snowdonia
  ('e1000000-0000-0000-0000-000000000020', 'weekends-travel'),         -- Skiing in St Moritz
  ('e1000000-0000-0000-0000-000000000022', 'activities-social-games'), -- Mini Golf & Drinks
  ('e1000000-0000-0000-0000-000000000024', 'weekends-travel'),         -- Hiking in the Lake District
  ('e1000000-0000-0000-0000-000000000025', 'festivals-seasonal'),      -- Polo in the Park
  -- Music reclassifications (3)
  ('e1000000-0000-0000-0000-000000000021', 'live-music-gigs'),         -- Oliver Heldens at O2 Brixton
  ('e1000000-0000-0000-0000-000000000028', 'nightlife-dancing'),       -- Halloween at Cubanista
  ('e1000000-0000-0000-0000-000000000029', 'charity-volunteering'),    -- Charity 80s/90s Night
  -- Drinks/dining reclassifications (4)
  ('e1000000-0000-0000-0000-000000000001', 'activities-social-games'), -- Fairgame & Pizza
  ('e1000000-0000-0000-0000-000000000011', 'themed-socials'),          -- Black Tie Evening, Pall Mall
  ('e1000000-0000-0000-0000-000000000015', 'nightlife-dancing'),       -- Christmas Party at Tonteria
  ('e1000000-0000-0000-0000-000000000018', 'themed-socials')           -- Valentine's Singles Evening
) AS v(event_id, slug)
JOIN public.tags t ON t.slug = v.slug
WHERE EXISTS (
  SELECT 1 FROM public.events e
  WHERE e.id = v.event_id::uuid AND e.deleted_at IS NULL
)
ON CONFLICT (event_id, tag_id) DO NOTHING;

-- ── Step 2: Primary tags via default mapping (the 11 unaudited events) ─
-- For any event NOT covered by Step 1, map old enum value to new slug.
-- The `WHERE NOT EXISTS` guard skips any event that already received a
-- primary in Step 1, so re-running the migration is safe and the 22
-- audited events keep their override.
INSERT INTO public.event_tags (event_id, tag_id, is_primary)
SELECT
  e.id,
  t.id,
  true
FROM public.events e
JOIN public.tags t ON t.slug = CASE e.category::text
  WHEN 'drinks'     THEN 'drinks-bars'
  WHEN 'dining'     THEN 'dining-supper-clubs'
  WHEN 'wellness'   THEN 'wellness-mindfulness'
  WHEN 'workshops'  THEN 'workshops-masterclasses'
  WHEN 'networking' THEN 'workshops-masterclasses'  -- networking demoted to interest-only; closest event home
  WHEN 'activity'   THEN 'activities-social-games'
  WHEN 'sport'      THEN 'sport-fitness'   -- defensive; all current sport rows are in Step 1
  WHEN 'cultural'   THEN 'galleries-museums'  -- defensive; all current cultural rows are in Step 1
  WHEN 'music'      THEN 'live-music-gigs'  -- defensive; all current music rows are in Step 1
END
WHERE e.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.event_tags et
    WHERE et.event_id = e.id AND et.is_primary = true
  )
ON CONFLICT (event_id, tag_id) DO NOTHING;

-- ── Step 3: Secondary tags (per-event, is_primary defaults to false) ──
-- 17 rows across 14 events. Each event named in a comment to make
-- diff-review trivial.
INSERT INTO public.event_tags (event_id, tag_id, is_primary)
SELECT
  v.event_id::uuid,
  t.id,
  false
FROM (VALUES
  -- Event 01 (Fairgame & Pizza) → drinks-bars + dining-supper-clubs
  ('e1000000-0000-0000-0000-000000000001', 'drinks-bars'),
  ('e1000000-0000-0000-0000-000000000001', 'dining-supper-clubs'),
  -- Event 03 (Axe Throwing) → drinks-bars
  ('e1000000-0000-0000-0000-000000000003', 'drinks-bars'),
  -- Event 07 (Flight Club) → drinks-bars
  ('e1000000-0000-0000-0000-000000000007', 'drinks-bars'),
  -- Event 10 (Hiking Snowdonia) → sport-fitness
  ('e1000000-0000-0000-0000-000000000010', 'sport-fitness'),
  -- Event 11 (Black Tie Pall Mall) → dining-supper-clubs
  ('e1000000-0000-0000-0000-000000000011', 'dining-supper-clubs'),
  -- Event 13 (Comedy & Dinner Angel) → dining-supper-clubs
  ('e1000000-0000-0000-0000-000000000013', 'dining-supper-clubs'),
  -- Event 15 (Christmas Party Tonteria) → festivals-seasonal + drinks-bars
  ('e1000000-0000-0000-0000-000000000015', 'festivals-seasonal'),
  ('e1000000-0000-0000-0000-000000000015', 'drinks-bars'),
  -- Event 18 (Valentine's Singles) → drinks-bars
  ('e1000000-0000-0000-0000-000000000018', 'drinks-bars'),
  -- Event 20 (Skiing St Moritz) → sport-fitness
  ('e1000000-0000-0000-0000-000000000020', 'sport-fitness'),
  -- Event 22 (Mini Golf & Drinks) → drinks-bars
  ('e1000000-0000-0000-0000-000000000022', 'drinks-bars'),
  -- Event 24 (Hiking Lake District) → sport-fitness
  ('e1000000-0000-0000-0000-000000000024', 'sport-fitness'),
  -- Event 25 (Polo in the Park) → outdoor-picnics
  ('e1000000-0000-0000-0000-000000000025', 'outdoor-picnics'),
  -- Event 28 (Halloween Cubanista) → festivals-seasonal + themed-socials
  ('e1000000-0000-0000-0000-000000000028', 'festivals-seasonal'),
  ('e1000000-0000-0000-0000-000000000028', 'themed-socials'),
  -- Event 29 (Charity 80s/90s Night) → nightlife-dancing
  ('e1000000-0000-0000-0000-000000000029', 'nightlife-dancing')
) AS v(event_id, slug)
JOIN public.tags t ON t.slug = v.slug
WHERE EXISTS (
  SELECT 1 FROM public.events e
  WHERE e.id = v.event_id::uuid AND e.deleted_at IS NULL
)
ON CONFLICT (event_id, tag_id) DO NOTHING;

-- ── Step 4: Verify exactly one primary per event ────────────────────
-- Defensive RAISE EXCEPTION rather than warning: if either invariant is
-- violated, the migration aborts and surfaces the failure mode loudly.
DO $$
DECLARE
  missing_count int;
  duplicate_count int;
BEGIN
  -- Every non-deleted event must have at least one primary
  SELECT count(*) INTO missing_count
  FROM public.events e
  WHERE e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.event_tags et
      WHERE et.event_id = e.id AND et.is_primary = true
    );
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % events without primary tag', missing_count;
  END IF;

  -- No event has more than one primary (the partial unique index will
  -- catch this too once created, but explicit verification gives a
  -- clearer error message during backfill).
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT event_id FROM public.event_tags WHERE is_primary = true
    GROUP BY event_id HAVING count(*) > 1
  ) AS dupes;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Backfill produced % events with multiple primary tags', duplicate_count;
  END IF;
END $$;

-- ── Partial unique index — exactly-one-primary-per-event ──
-- Created AFTER the backfill so the verification block above can produce
-- a clearer error message than the unique constraint violation. The index
-- then provides the permanent storage-layer guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_tags_one_primary
  ON public.event_tags (event_id)
  WHERE is_primary = true;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. Bidirectional sync triggers (Decision 5)                                ║
-- ║ Side A: events.category UPDATE → primary event_tags row UPDATE             ║
-- ║ Side B: event_tags primary INSERT/UPDATE → events.category UPDATE          ║
-- ║ Both short-circuit on pg_trigger_depth() > 1 to break the cycle.           ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Side A: events.category UPDATE → write through to primary event_tags row.
CREATE OR REPLACE FUNCTION public._sync_primary_tag_from_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_canonical_slug text;
  v_tag_id uuid;
BEGIN
  -- Cycle guard: if we're already inside a trigger chain, the change
  -- propagated FROM the other side; do not re-propagate.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- No-op guard: nothing to do if the enum value didn't change.
  IF NEW.category IS NOT DISTINCT FROM OLD.category THEN
    RETURN NEW;
  END IF;

  -- Pick the canonical primary slug for the new enum value. One pick per
  -- enum value (admin can use the new tag picker if they want a different
  -- primary — e.g. nightlife-dancing for a drinks event).
  v_canonical_slug := CASE NEW.category::text
    WHEN 'drinks'     THEN 'drinks-bars'
    WHEN 'dining'     THEN 'dining-supper-clubs'
    WHEN 'wellness'   THEN 'wellness-mindfulness'
    WHEN 'workshops'  THEN 'workshops-masterclasses'
    WHEN 'networking' THEN 'workshops-masterclasses'  -- networking demoted; closest event home
    WHEN 'activity'   THEN 'activities-social-games'
    WHEN 'sport'      THEN 'sport-fitness'
    WHEN 'cultural'   THEN 'galleries-museums'  -- one canonical pick — admin can re-tag
    WHEN 'music'      THEN 'live-music-gigs'
  END;
  IF v_canonical_slug IS NULL THEN
    RAISE EXCEPTION 'unknown legacy category value: %', NEW.category;
  END IF;

  SELECT id INTO v_tag_id FROM public.tags WHERE slug = v_canonical_slug;
  IF v_tag_id IS NULL THEN
    RAISE EXCEPTION 'canonical slug % not found in tags table', v_canonical_slug;
  END IF;

  -- Replace the existing primary tag for this event.
  UPDATE public.event_tags
     SET tag_id = v_tag_id
   WHERE event_id = NEW.id AND is_primary = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_primary_tag_from_category ON public.events;
CREATE TRIGGER trg_sync_primary_tag_from_category
  AFTER UPDATE OF category ON public.events
  FOR EACH ROW EXECUTE FUNCTION public._sync_primary_tag_from_category();

-- Side B: event_tags primary INSERT/UPDATE → write back to events.category.
CREATE OR REPLACE FUNCTION public._sync_category_from_primary_tag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_legacy_cat public.event_category;
BEGIN
  -- Cycle guard: if Side A is propagating downwards we're at depth > 1.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Only primary changes propagate to events.category. Secondary rows
  -- have no effect on the legacy column.
  IF NEW.is_primary IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO v_slug FROM public.tags WHERE id = NEW.tag_id;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'tag_id % not found in tags table', NEW.tag_id;
  END IF;

  v_legacy_cat := public._tag_slug_to_legacy_category(v_slug);
  IF v_legacy_cat IS NULL THEN
    RAISE EXCEPTION 'no legacy enum mapping for primary tag slug: %', v_slug;
  END IF;

  -- IS DISTINCT FROM guard prevents a no-op write that would needlessly
  -- re-fire Side A (depth check would still catch it, but skipping the
  -- write entirely is cleaner).
  UPDATE public.events
     SET category = v_legacy_cat
   WHERE id = NEW.event_id
     AND category IS DISTINCT FROM v_legacy_cat;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_category_from_primary_tag ON public.event_tags;
CREATE TRIGGER trg_sync_category_from_primary_tag
  AFTER INSERT OR UPDATE ON public.event_tags
  FOR EACH ROW EXECUTE FUNCTION public._sync_category_from_primary_tag();

-- ── End of Migration 2 ──────────────────────────────────────────────────────
