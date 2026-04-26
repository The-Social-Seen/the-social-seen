// W4 — Coverage for Migration 2 (`create_tags_and_event_tags`) and
// Migration 3 (`migrate_user_interests_to_tag_id`).
//
// W2+W3 ship together because Migration 3's FK depends on the rows
// Migration 2 seeds. This test file mirrors the structure of
// `migration-w1-demographics.test.ts`:
//
// ── Layers ──────────────────────────────────────────────────────────────────
// 1. **Migration-text static assertions** — read both .sql files and assert
//    the security/correctness-critical idioms are present (the 23-tag seed,
//    the partial unique index `WHERE is_primary = true`, the
//    `pg_trigger_depth() > 1` cycle guard on both trigger functions, the
//    `IS DISTINCT FROM` guard on Side B of the sync, the slug→enum
//    mapping table, the defensive `RAISE EXCEPTION` blocks, the
//    `ON DELETE CASCADE` on user_interests.tag_id, the unique-constraint
//    swap atomicity). These run without a DB and catch refactor mistakes
//    in the migration files themselves — sabotage-tested below.
//
// 2. **Skipped DB-integration cases** — every assertion the W4 prompt
//    flagged as "do not skip" is encoded here as `it.skip(..., async () =>
//    { ... })` with a `// TODO(W4-docker)` marker and the body of what
//    the assertion should do. These were authored against a checklist —
//    not a live local Supabase — because Docker / Docker Desktop is not
//    available on the build machine. Unskip and run them once a local
//    `supabase start` stack is up. Each test name names the invariant it
//    protects so a failure cleanly identifies the regression.
//
// 3. **Constants <-> seed cross-check (deferred)** — the
//    `PRIMARY_ELIGIBLE_TAG_SLUGS` constant doesn't exist in
//    `src/lib/constants.ts` yet; W5 introduces it as part of the admin
//    event picker work. A skipped test holds the slot — once W5 lands the
//    constant, this test will assert seed ↔ constant equality so the two
//    sources can never drift.
//
// Sabotage checks were performed on three migration-text invariants
// (one per critical guarantee) — see the handover doc for the run log.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Migration text helpers ─────────────────────────────────────────────────

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_2_PATH = resolve(
  MIGRATIONS_DIR,
  '20260504000001_create_tags_and_event_tags.sql',
)
const MIGRATION_3_PATH = resolve(
  MIGRATIONS_DIR,
  '20260504000002_migrate_user_interests_to_tag_id.sql',
)

function loadMigration(p: string): string {
  return readFileSync(p, 'utf-8')
}

// The Decision 4 canonical seed list (15 primary-eligible + 8 interest-only).
// Order matters for diff readability and matches the spec's sort_order
// column exactly. Any drift between this list and the migration's INSERT
// block is a regression — either the spec changed (in which case both
// must move) or someone hand-edited one half.
const PRIMARY_ELIGIBLE_SLUGS: ReadonlyArray<readonly [string, string, number]> =
  [
    ['drinks-bars', 'Drinks & Bars', 10],
    ['dining-supper-clubs', 'Dining & Supper Clubs', 20],
    ['activities-social-games', 'Activities & Social Games', 30],
    ['nightlife-dancing', 'Nightlife & Dancing', 40],
    ['live-music-gigs', 'Live Music & Gigs', 50],
    ['theatre-comedy', 'Theatre & Comedy', 60],
    ['galleries-museums', 'Galleries & Museums', 70],
    ['festivals-seasonal', 'Festivals & Seasonal', 80],
    ['sport-fitness', 'Sport & Fitness', 90],
    ['outdoor-picnics', 'Outdoor & Picnics', 100],
    ['weekends-travel', 'Weekends & Travel', 110],
    ['themed-socials', 'Themed Socials', 120],
    ['charity-volunteering', 'Charity & Volunteering', 130],
    ['wellness-mindfulness', 'Wellness & Mindfulness', 140],
    ['workshops-masterclasses', 'Workshops & Masterclasses', 150],
  ]

const INTEREST_ONLY_SLUGS: ReadonlyArray<readonly [string, string, number]> = [
  ['interest-technology', 'Technology', 200],
  ['interest-entrepreneurship', 'Entrepreneurship', 210],
  ['interest-networking', 'Networking', 220],
  ['interest-photography', 'Photography', 230],
  ['interest-travel', 'Travel', 240],
  ['interest-books-literature', 'Books & Literature', 250],
  ['interest-sustainable-living', 'Sustainable Living', 260],
  ['interest-film-cinema', 'Film & Cinema', 270],
]

// Decision 9 reconciliation map — the legacy text values from
// INTEREST_OPTIONS (constants.ts) and the canonical slug they each
// remap to. 14 rows; 6 to primary-eligible, 8 to interest-only.
const RECONCILIATION_MAP: ReadonlyArray<readonly [string, string]> = [
  // Group A — primary-eligible (6)
  ['Wine & Cocktails', 'drinks-bars'],
  ['Fine Dining', 'dining-supper-clubs'],
  ['Art & Culture', 'galleries-museums'],
  ['Yoga & Wellness', 'wellness-mindfulness'],
  ['Running & Sport', 'sport-fitness'],
  ['Jazz & Music', 'live-music-gigs'],
  // Group B — interest-only (8)
  ['Technology', 'interest-technology'],
  ['Entrepreneurship', 'interest-entrepreneurship'],
  ['Networking', 'interest-networking'],
  ['Photography', 'interest-photography'],
  ['Travel', 'interest-travel'],
  ['Books & Literature', 'interest-books-literature'],
  ['Sustainable Living', 'interest-sustainable-living'],
  ['Film & Cinema', 'interest-film-cinema'],
]

// ════════════════════════════════════════════════════════════════════════════
// Layer 1 — Migration 2 text invariants
// ════════════════════════════════════════════════════════════════════════════

describe('Migration 2 — text invariants (tags + event_tags + sync trigger)', () => {
  const sql = loadMigration(MIGRATION_2_PATH)

  // --- Tables exist with the spec'd shape -----------------------------------

  it('creates public.tags with parent_id (nullable, ON DELETE SET NULL)', () => {
    // Decision 3 — hierarchy column shipped from day one even though
    // semantics are out of scope. ON DELETE SET NULL because deleting a
    // parent should orphan the children, not block the delete.
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.tags/)
    expect(sql).toMatch(
      /parent_id\s+uuid REFERENCES public\.tags\(id\) ON DELETE SET NULL/,
    )
  })

  it('creates public.tags with sort_order, is_active, slug UNIQUE', () => {
    expect(sql).toMatch(/slug\s+text UNIQUE NOT NULL/)
    expect(sql).toMatch(/sort_order\s+integer NOT NULL DEFAULT 0/)
    expect(sql).toMatch(/is_active\s+boolean NOT NULL DEFAULT true/)
  })

  it('creates public.event_tags with FK ON DELETE CASCADE on event_id', () => {
    // Removing an event takes its tags with it (no orphaned rows).
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.event_tags/)
    expect(sql).toMatch(
      /event_id\s+uuid NOT NULL REFERENCES public\.events\(id\) ON DELETE CASCADE/,
    )
  })

  it('creates public.event_tags with FK ON DELETE RESTRICT on tag_id', () => {
    // RESTRICT means a tag cannot be hard-deleted while events reference it.
    // Combined with is_active = false soft-retire, this enforces the
    // "admins retire, never delete" curation pattern.
    expect(sql).toMatch(
      /tag_id\s+uuid NOT NULL REFERENCES public\.tags\(id\)\s+ON DELETE RESTRICT/,
    )
  })

  it('declares the (event_id, tag_id) unique constraint on event_tags', () => {
    // Stops the same tag from being attached twice (primary or secondary)
    // to the same event.
    expect(sql).toMatch(
      /CONSTRAINT uq_event_tags_event_tag UNIQUE \(event_id, tag_id\)/,
    )
  })

  // --- Partial unique index (Decision 6) ------------------------------------

  it('creates the partial unique index uq_event_tags_one_primary WHERE is_primary = true', () => {
    // Decision 6 — the "exactly one primary tag per event" guarantee.
    // Without the WHERE clause this becomes a UNIQUE(event_id) which
    // would forbid all secondary rows. Sabotage-tested.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_event_tags_one_primary[\s\S]*?ON public\.event_tags \(event_id\)[\s\S]*?WHERE is_primary = true/,
    )
  })

  it('creates the partial unique index AFTER the backfill verification block', () => {
    // The verification block produces a clearer error message than the
    // unique constraint violation. Index creation order in the file is
    // load-bearing: verify text-level that the verification DO $$ block
    // appears earlier than the partial unique index.
    const verifyIdx = sql.indexOf(
      'Backfill produced % events with multiple primary tags',
    )
    const indexIdx = sql.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_event_tags_one_primary',
    )
    expect(verifyIdx).toBeGreaterThan(-1)
    expect(indexIdx).toBeGreaterThan(-1)
    expect(verifyIdx).toBeLessThan(indexIdx)
  })

  // --- Tag seed (Decision 4) ------------------------------------------------

  it('seeds exactly 23 rows in tags (15 primary-eligible + 8 interest-only)', () => {
    // Pull the body of the INSERT INTO public.tags VALUES (...) block
    // and count tuples. Robust to whitespace shifts.
    const match = sql.match(
      /INSERT INTO public\.tags \(slug, label, sort_order, is_active\) VALUES([\s\S]*?)ON CONFLICT/,
    )
    expect(match, 'tag seed INSERT block not found').toBeTruthy()
    const body = match![1]
    // Each tuple starts with `(slug, label, sort_order, true)` — count them.
    const tuples = body.match(/\(\s*'[a-z][a-z0-9-]*'\s*,/g) ?? []
    expect(tuples.length).toBe(23)
  })

  for (const [slug, label, sortOrder] of PRIMARY_ELIGIBLE_SLUGS) {
    it(`seeds primary-eligible tag '${slug}' with label '${label}' and sort_order ${sortOrder}`, () => {
      // Match each spec'd row individually so a failure pinpoints the
      // drift to a specific tag rather than a 23-row diff.
      const re = new RegExp(
        `\\(\\s*'${slug.replace(/-/g, '\\-')}'\\s*,\\s*'${label.replace(
          /&/g,
          '&',
        )}'\\s*,\\s*${sortOrder}\\s*,\\s*true\\s*\\)`,
      )
      expect(sql).toMatch(re)
    })
  }

  for (const [slug, label, sortOrder] of INTEREST_ONLY_SLUGS) {
    it(`seeds interest-only tag '${slug}' with label '${label}' and sort_order ${sortOrder}`, () => {
      const re = new RegExp(
        `\\(\\s*'${slug.replace(/-/g, '\\-')}'\\s*,\\s*'${label.replace(
          /&/g,
          '&',
        )}'\\s*,\\s*${sortOrder}\\s*,\\s*true\\s*\\)`,
      )
      expect(sql).toMatch(re)
    })
  }

  it('uses ON CONFLICT (slug) DO NOTHING for the tag seed (re-runnable)', () => {
    expect(sql).toMatch(/ON CONFLICT \(slug\) DO NOTHING/)
  })

  it('verifies the seed produced exactly 23 rows (defensive check)', () => {
    // The migration's own RAISE EXCEPTION if the seed drifted — catches
    // the case where a previous partial run left rows behind.
    expect(sql).toMatch(
      /RAISE EXCEPTION 'Tag seed produced % rows, expected 23'/,
    )
  })

  // --- Slug → enum mapping function -----------------------------------------

  it('declares public._tag_slug_to_legacy_category as IMMUTABLE with search_path = public', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\._tag_slug_to_legacy_category[\s\S]*?IMMUTABLE[\s\S]*?SET search_path = public/,
    )
  })

  for (const [slug, legacyEnum] of [
    ['drinks-bars', 'drinks'],
    ['dining-supper-clubs', 'dining'],
    ['activities-social-games', 'activity'],
    ['nightlife-dancing', 'drinks'],
    ['live-music-gigs', 'music'],
    ['theatre-comedy', 'cultural'],
    ['galleries-museums', 'cultural'],
    ['festivals-seasonal', 'cultural'],
    ['sport-fitness', 'sport'],
    ['outdoor-picnics', 'activity'],
    ['weekends-travel', 'activity'],
    ['themed-socials', 'drinks'],
    ['charity-volunteering', 'cultural'],
    ['wellness-mindfulness', 'wellness'],
    ['workshops-masterclasses', 'workshops'],
  ] as const) {
    it(`maps primary slug '${slug}' → legacy enum '${legacyEnum}'`, () => {
      // Spec Decision 5 caveat — the static slug→enum lookup is lossy
      // (15 → 9). Each row of the lookup matters; if one breaks the
      // bidirectional sync collapses to the wrong category.
      const re = new RegExp(
        `WHEN '${slug.replace(/-/g, '\\-')}'\\s*THEN '${legacyEnum}'::public\\.event_category`,
      )
      expect(sql).toMatch(re)
    })
  }

  it('the slug→enum function falls through to NULL for interest-only slugs (defensive)', () => {
    // Spec — if Side B ever sees an interest-only tag flipped to
    // is_primary, the trigger should raise rather than coerce to the
    // wrong enum value. Side B's RAISE checks for the NULL return.
    expect(sql).toMatch(/-- Interest-only slugs[\s\S]*?ELSE NULL/)
    expect(sql).toMatch(
      /RAISE EXCEPTION 'no legacy enum mapping for primary tag slug: %'/,
    )
  })

  // --- Per-event backfill (Decision 9) --------------------------------------

  it('Step 1 backfill includes all 22 audited per-event overrides', () => {
    // Spec Decision 9 + product owner audit. Each tuple must appear
    // verbatim — if the override list drifts, the backfill silently
    // mis-classifies events (Risk register entry "per-event override
    // list drifts" — high blast radius).
    const overrides: ReadonlyArray<readonly [string, string]> = [
      // Cultural reclassifications (8)
      ['e1000000-0000-0000-0000-000000000008', 'weekends-travel'],
      ['e1000000-0000-0000-0000-000000000012', 'festivals-seasonal'],
      ['e1000000-0000-0000-0000-000000000013', 'theatre-comedy'],
      ['e1000000-0000-0000-0000-000000000014', 'galleries-museums'],
      ['e1000000-0000-0000-0000-000000000016', 'charity-volunteering'],
      ['e1000000-0000-0000-0000-000000000023', 'theatre-comedy'],
      ['e1000000-0000-0000-0000-000000000026', 'outdoor-picnics'],
      ['e1000000-0000-0000-0000-000000000030', 'festivals-seasonal'],
      // Sport reclassifications (7)
      ['e1000000-0000-0000-0000-000000000003', 'activities-social-games'],
      ['e1000000-0000-0000-0000-000000000007', 'activities-social-games'],
      ['e1000000-0000-0000-0000-000000000010', 'weekends-travel'],
      ['e1000000-0000-0000-0000-000000000020', 'weekends-travel'],
      ['e1000000-0000-0000-0000-000000000022', 'activities-social-games'],
      ['e1000000-0000-0000-0000-000000000024', 'weekends-travel'],
      ['e1000000-0000-0000-0000-000000000025', 'festivals-seasonal'],
      // Music reclassifications (3)
      ['e1000000-0000-0000-0000-000000000021', 'live-music-gigs'],
      ['e1000000-0000-0000-0000-000000000028', 'nightlife-dancing'],
      ['e1000000-0000-0000-0000-000000000029', 'charity-volunteering'],
      // Drinks/dining reclassifications (4)
      ['e1000000-0000-0000-0000-000000000001', 'activities-social-games'],
      ['e1000000-0000-0000-0000-000000000011', 'themed-socials'],
      ['e1000000-0000-0000-0000-000000000015', 'nightlife-dancing'],
      ['e1000000-0000-0000-0000-000000000018', 'themed-socials'],
    ]
    expect(overrides.length).toBe(22)
    for (const [eventId, slug] of overrides) {
      const re = new RegExp(
        `\\('${eventId}',\\s*'${slug.replace(/-/g, '\\-')}'\\)`,
      )
      expect(sql, `override missing for ${eventId} → ${slug}`).toMatch(re)
    }
  })

  it('Step 2 default-fallback CASE covers all 9 legacy enum values', () => {
    // Defensive — the spec lists `sport`, `cultural`, `music` as
    // "defensive; all current rows are in Step 1" but the CASE must
    // still handle them so a draft event with one of those categories
    // has a default mapping. Match each WHEN → THEN pair.
    const fallbacks: ReadonlyArray<readonly [string, string]> = [
      ['drinks', 'drinks-bars'],
      ['dining', 'dining-supper-clubs'],
      ['wellness', 'wellness-mindfulness'],
      ['workshops', 'workshops-masterclasses'],
      ['networking', 'workshops-masterclasses'],
      ['activity', 'activities-social-games'],
      ['sport', 'sport-fitness'],
      ['cultural', 'galleries-museums'],
      ['music', 'live-music-gigs'],
    ]
    expect(fallbacks.length).toBe(9)
    for (const [enumVal, slug] of fallbacks) {
      const re = new RegExp(
        `WHEN '${enumVal}'\\s*THEN '${slug.replace(/-/g, '\\-')}'`,
      )
      expect(sql, `fallback missing for ${enumVal} → ${slug}`).toMatch(re)
    }
  })

  it('Step 2 default fallback only fires for events without a Step 1 primary', () => {
    // The WHERE NOT EXISTS guard makes the migration safe to re-run and
    // ensures the 22 overrides keep their override (a Step 2 default
    // would never overwrite the Step 1 primary, but the explicit guard
    // documents the intent and short-circuits the join early).
    expect(sql).toMatch(
      /WHERE e\.deleted_at IS NULL[\s\S]*?AND NOT EXISTS \([\s\S]*?SELECT 1 FROM public\.event_tags et[\s\S]*?WHERE et\.event_id = e\.id AND et\.is_primary = true/,
    )
  })

  it('Step 3 secondaries cover the 14 multi-tagged events with 17 INSERT rows', () => {
    // Spec backfill produces ≥16 secondary rows. We seeded 17 (14 unique
    // events with 1–2 secondaries each). Assert each secondary row is
    // present so a future edit can't silently drop one.
    const secondaries: ReadonlyArray<readonly [string, string]> = [
      // Event 01: 2 secondaries
      ['e1000000-0000-0000-0000-000000000001', 'drinks-bars'],
      ['e1000000-0000-0000-0000-000000000001', 'dining-supper-clubs'],
      // Event 03: 1
      ['e1000000-0000-0000-0000-000000000003', 'drinks-bars'],
      // Event 07: 1
      ['e1000000-0000-0000-0000-000000000007', 'drinks-bars'],
      // Event 10: 1
      ['e1000000-0000-0000-0000-000000000010', 'sport-fitness'],
      // Event 11: 1
      ['e1000000-0000-0000-0000-000000000011', 'dining-supper-clubs'],
      // Event 13: 1
      ['e1000000-0000-0000-0000-000000000013', 'dining-supper-clubs'],
      // Event 15: 2
      ['e1000000-0000-0000-0000-000000000015', 'festivals-seasonal'],
      ['e1000000-0000-0000-0000-000000000015', 'drinks-bars'],
      // Event 18: 1
      ['e1000000-0000-0000-0000-000000000018', 'drinks-bars'],
      // Event 20: 1
      ['e1000000-0000-0000-0000-000000000020', 'sport-fitness'],
      // Event 22: 1
      ['e1000000-0000-0000-0000-000000000022', 'drinks-bars'],
      // Event 24: 1
      ['e1000000-0000-0000-0000-000000000024', 'sport-fitness'],
      // Event 25: 1 — Polo in the Park spot-check (per W4 prompt)
      ['e1000000-0000-0000-0000-000000000025', 'outdoor-picnics'],
      // Event 28: 2 — Halloween spot-check (per W4 prompt)
      ['e1000000-0000-0000-0000-000000000028', 'festivals-seasonal'],
      ['e1000000-0000-0000-0000-000000000028', 'themed-socials'],
      // Event 29: 1
      ['e1000000-0000-0000-0000-000000000029', 'nightlife-dancing'],
    ]
    expect(secondaries.length).toBe(17)
    expect(secondaries.length).toBeGreaterThanOrEqual(16)
    for (const [eventId, slug] of secondaries) {
      const re = new RegExp(
        `\\('${eventId}',\\s*'${slug.replace(/-/g, '\\-')}'\\)`,
      )
      expect(
        sql,
        `secondary tag missing for ${eventId} → ${slug}`,
      ).toMatch(re)
    }
  })

  it('Step 3 secondaries INSERT explicitly sets is_primary = false', () => {
    // Defensive — column default is false, but spelling it out in the
    // INSERT makes the diff obvious if anyone ever omits it.
    expect(sql).toMatch(
      /INSERT INTO public\.event_tags \(event_id, tag_id, is_primary\)\s*SELECT\s*v\.event_id::uuid,\s*t\.id,\s*false\s*FROM \(VALUES[\s\S]*?\) AS v\(event_id, slug\)\s*JOIN public\.tags t ON t\.slug = v\.slug\s*WHERE EXISTS[\s\S]*?ON CONFLICT \(event_id, tag_id\) DO NOTHING/,
    )
  })

  it('Step 4 verification raises if any event lacks a primary tag', () => {
    expect(sql).toMatch(
      /RAISE EXCEPTION 'Backfill incomplete: % events without primary tag'/,
    )
  })

  it('Step 4 verification raises if any event has multiple primary tags', () => {
    expect(sql).toMatch(
      /RAISE EXCEPTION 'Backfill produced % events with multiple primary tags'/,
    )
  })

  // --- Bidirectional sync trigger (Decision 5) ------------------------------

  it('Side A — _sync_primary_tag_from_category fires AFTER UPDATE OF category', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER trg_sync_primary_tag_from_category\s*AFTER UPDATE OF category ON public\.events/,
    )
  })

  it('Side B — _sync_category_from_primary_tag fires AFTER INSERT OR UPDATE on event_tags', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER trg_sync_category_from_primary_tag\s*AFTER INSERT OR UPDATE ON public\.event_tags/,
    )
  })

  for (const fn of [
    '_sync_primary_tag_from_category',
    '_sync_category_from_primary_tag',
  ]) {
    it(`${fn} short-circuits on pg_trigger_depth() > 1 (cycle guard)`, () => {
      // Without this guard, an UPDATE on either side fires the trigger
      // chain forever. Explicit text assertion — sabotage-tested.
      const fnBody = sql.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$`,
        ),
      )
      expect(fnBody, `${fn} body not found`).toBeTruthy()
      expect(fnBody![0]).toMatch(/IF pg_trigger_depth\(\) > 1 THEN[\s\S]*?RETURN NEW/)
    })

    it(`${fn} sets search_path = public (search-path injection defence)`, () => {
      const re = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SET search_path = public`,
      )
      expect(sql).toMatch(re)
    })
  }

  it('Side A — uses IS NOT DISTINCT FROM to no-op when category did not change', () => {
    // Without this guard, even setting `category = category` would
    // trigger an event_tags UPDATE — wasteful and noisy.
    const fnBody = sql.match(
      /CREATE OR REPLACE FUNCTION public\._sync_primary_tag_from_category[\s\S]*?\$\$[\s\S]*?\$\$/,
    )
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(
      /IF NEW\.category IS NOT DISTINCT FROM OLD\.category THEN[\s\S]*?RETURN NEW/,
    )
  })

  it('Side B — UPDATEs events.category only when IS DISTINCT FROM the new value', () => {
    // The crucial no-op guard. Without it, flipping the primary between
    // two slugs that map to the same legacy enum (e.g. theatre-comedy
    // ↔ galleries-museums, both → cultural) would write a no-op to
    // events.category that re-fires Side A. The cycle guard would still
    // catch it, but skipping the write entirely is the documented
    // behaviour and the test the W4 prompt explicitly asks for.
    const fnBody = sql.match(
      /CREATE OR REPLACE FUNCTION public\._sync_category_from_primary_tag[\s\S]*?\$\$[\s\S]*?\$\$/,
    )
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(
      /UPDATE public\.events\s*SET category = v_legacy_cat\s*WHERE id = NEW\.event_id\s*AND category IS DISTINCT FROM v_legacy_cat/,
    )
  })

  it('Side B — only propagates when NEW.is_primary IS TRUE (secondaries are inert)', () => {
    // Secondary INSERT/UPDATE rows must NOT write to events.category —
    // only primary changes propagate. The early return on
    // `IS NOT TRUE` is what enforces this.
    const fnBody = sql.match(
      /CREATE OR REPLACE FUNCTION public\._sync_category_from_primary_tag[\s\S]*?\$\$[\s\S]*?\$\$/,
    )
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(
      /IF NEW\.is_primary IS NOT TRUE THEN[\s\S]*?RETURN NEW/,
    )
  })

  it('Side A — RAISE EXCEPTION if the legacy enum has no canonical-slug mapping', () => {
    // Forward-compat — if someone adds a new event_category enum value
    // without updating the trigger's CASE, the trigger fails loud
    // rather than silently leaving the primary tag stale.
    expect(sql).toMatch(/RAISE EXCEPTION 'unknown legacy category value: %'/)
  })

  it('Side A — RAISE EXCEPTION if the canonical slug is missing from tags', () => {
    expect(sql).toMatch(
      /RAISE EXCEPTION 'canonical slug % not found in tags table'/,
    )
  })

  it('Side B — RAISE EXCEPTION if the tag_id is not in tags', () => {
    expect(sql).toMatch(/RAISE EXCEPTION 'tag_id % not found in tags table'/)
  })

  it('counts at least 6 RAISE EXCEPTION statements in Migration 2', () => {
    // 1 in tag-seed verify + 2 in Step 4 + 2 in Side A + 2 in Side B = 7.
    // Lower bound is 6 — guards against an accidental removal of any
    // single RAISE.
    const count = (sql.match(/^[^-\n]*RAISE EXCEPTION/gm) ?? []).length
    expect(count).toBeGreaterThanOrEqual(6)
  })

  // --- RLS / GRANT (Decision 7) ---------------------------------------------

  it('enables RLS on tags and event_tags', () => {
    expect(sql).toMatch(/ALTER TABLE public\.tags ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(
      /ALTER TABLE public\.event_tags ENABLE ROW LEVEL SECURITY/,
    )
  })

  it('grants SELECT on tags to anon AND authenticated (taxonomy is public)', () => {
    // Decision 7 — the taxonomy table is genuinely public so anon
    // visitors can filter events on the landing page. This is an
    // explicit, considered exposure (anon-visibility decision per
    // CLAUDE.md rule, documented in the migration header).
    expect(sql).toMatch(/GRANT SELECT ON public\.tags TO anon, authenticated/)
  })

  it('grants SELECT on event_tags to anon AND authenticated (with RLS gating drafts)', () => {
    expect(sql).toMatch(
      /GRANT SELECT ON public\.event_tags TO anon, authenticated/,
    )
  })

  it('event_tags SELECT policy joins to events to gate drafts/deleted to admins', () => {
    // Without the join, draft event tags would leak to anon. The policy
    // mirrors events_select's posture.
    expect(sql).toMatch(
      /CREATE POLICY "event_tags_select"[\s\S]*?FROM public\.events e[\s\S]*?e\.deleted_at IS NULL[\s\S]*?e\.is_published = true[\s\S]*?role = 'admin'/,
    )
  })

  it('does NOT grant DELETE on tags to authenticated (soft-retire only)', () => {
    // Decision 3 — tags retire via is_active = false, never DELETE.
    // The grant block grants INSERT, UPDATE on tags but NOT DELETE.
    const tagsGrantBlock = sql.match(
      /GRANT INSERT, UPDATE(?:, DELETE)? ON public\.tags TO authenticated/,
    )
    expect(tagsGrantBlock).toBeTruthy()
    expect(tagsGrantBlock![0]).not.toContain('DELETE')
    // And there must be no tags DELETE policy at all. Pattern is
    // explicitly anchored to the opening quote so `event_tags_delete_admin`
    // doesn't accidentally match (note: the policy name starts at the
    // first character after the opening quote, so we require a non-`e`
    // alphanumeric or anchor it via the literal string `"tags_delete`).
    expect(sql).not.toMatch(/CREATE POLICY "tags_delete/)
  })

  it('grants INSERT, UPDATE, DELETE on event_tags to authenticated (RLS gates writes to admins)', () => {
    expect(sql).toMatch(
      /GRANT INSERT, UPDATE, DELETE ON public\.event_tags TO authenticated/,
    )
  })

  for (const policy of [
    'tags_select_active',
    'tags_insert_admin',
    'tags_update_admin',
    'event_tags_select',
    'event_tags_insert_admin',
    'event_tags_update_admin',
    'event_tags_delete_admin',
  ]) {
    it(`declares RLS policy ${policy}`, () => {
      const re = new RegExp(`CREATE POLICY "${policy}"`)
      expect(sql).toMatch(re)
    })
  }
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1 — Migration 3 text invariants (user_interests reconciliation)
// ════════════════════════════════════════════════════════════════════════════

describe('Migration 3 — text invariants (user_interests.tag_id reconciliation)', () => {
  const sql = loadMigration(MIGRATION_3_PATH)

  // --- Column add (nullable first) ------------------------------------------

  it('adds tag_id as a nullable FK ON DELETE CASCADE to public.tags', () => {
    // Spec — nullable on add so the backfill has space to fill it in;
    // CASCADE because user-interest rows are tightly bound to the tag.
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS tag_id uuid\s*REFERENCES public\.tags\(id\) ON DELETE CASCADE/,
    )
  })

  // --- Backfill (Decision 9 reconciliation map) -----------------------------

  it('backfill UPDATE has the WHERE ui.tag_id IS NULL guard (re-runnable)', () => {
    // Without this guard, a re-run of the migration after later edits
    // would clobber updates to tag_id. The guard makes the UPDATE
    // strictly additive — only NULL rows are touched.
    expect(sql).toMatch(
      /UPDATE public\.user_interests ui\s*SET tag_id = t\.id\s*FROM public\.tags t\s*WHERE ui\.tag_id IS NULL/,
    )
  })

  for (const [legacy, slug] of RECONCILIATION_MAP) {
    it(`backfill maps legacy interest '${legacy}' → slug '${slug}'`, () => {
      // Each Decision 9 row asserted individually so a failure
      // pinpoints the specific legacy value that drifted.
      const re = new RegExp(
        `WHEN '${legacy.replace(/[&]/g, '&').replace(/'/g, "\\\\'")}'\\s*THEN '${slug.replace(/-/g, '\\-')}'`,
      )
      expect(sql).toMatch(re)
    })
  }

  it('backfill CASE has an ELSE NULL fallthrough for off-list legacy values', () => {
    // Off-list values (a stale row from before INTEREST_OPTIONS
    // tightening) must fall through to NULL so the verification step
    // catches them and the migration aborts.
    expect(sql).toMatch(/ELSE NULL\s*END;/)
  })

  // --- Verification block ---------------------------------------------------

  it('verifies zero NULL tag_id rows remain (RAISE EXCEPTION on failure)', () => {
    expect(sql).toMatch(
      /RAISE EXCEPTION\s*'user_interests backfill incomplete: % rows with NULL tag_id\. Unmapped interest values: %'/,
    )
  })

  it('verification surfaces unmapped legacy values in the error message', () => {
    // The error message includes string_agg of the unmapped values for
    // fast triage — not a generic "backfill failed" miss.
    expect(sql).toMatch(
      /SELECT string_agg\(DISTINCT interest, ', '\) INTO sample_unmapped\s*FROM public\.user_interests\s*WHERE tag_id IS NULL/,
    )
  })

  it('counts at least 1 RAISE EXCEPTION statement in Migration 3', () => {
    // The verification block — guards against silently dropping the
    // defensive check.
    const count = (sql.match(/^[^-\n]*RAISE EXCEPTION/gm) ?? []).length
    expect(count).toBeGreaterThanOrEqual(1)
  })

  // --- NOT NULL after backfill ----------------------------------------------

  it('sets tag_id NOT NULL only after the verification block', () => {
    // Order matters — SET NOT NULL on a column with NULL rows would
    // fail noisily. The verification ensures zero NULLs first.
    const verifyIdx = sql.indexOf('user_interests backfill incomplete')
    const notNullIdx = sql.indexOf('ALTER COLUMN tag_id SET NOT NULL')
    expect(verifyIdx).toBeGreaterThan(-1)
    expect(notNullIdx).toBeGreaterThan(-1)
    expect(verifyIdx).toBeLessThan(notNullIdx)
  })

  // --- Atomic constraint swap -----------------------------------------------

  it('swaps the unique constraint inside an explicit BEGIN/COMMIT transaction', () => {
    // Without the transaction wrapper there is a brief window where
    // neither the old nor the new constraint is active — a concurrent
    // INSERT could create a duplicate that survives. The transaction
    // makes the swap atomic from any other session's view.
    expect(sql).toMatch(
      /BEGIN;[\s\S]*?DROP CONSTRAINT IF EXISTS uq_user_interests_user_interest;[\s\S]*?ADD CONSTRAINT uq_user_interests_user_tag UNIQUE \(user_id, tag_id\);[\s\S]*?COMMIT;/,
    )
  })

  it('drops the legacy uq_user_interests_user_interest constraint', () => {
    expect(sql).toMatch(
      /DROP CONSTRAINT IF EXISTS uq_user_interests_user_interest/,
    )
  })

  it('adds the new uq_user_interests_user_tag UNIQUE(user_id, tag_id) constraint', () => {
    expect(sql).toMatch(
      /ADD CONSTRAINT uq_user_interests_user_tag UNIQUE \(user_id, tag_id\)/,
    )
  })

  // --- Legacy text column kept (F2 follow-up) -------------------------------

  it('does NOT drop the legacy interest text column (F2 ships separately)', () => {
    // Spec is explicit: the interest text column stays for one release
    // as rollback insurance. F2 drops it after the application has
    // fully migrated to the FK. Guards against a future-developer
    // shortcut that bundles F2 into Migration 3.
    expect(sql).not.toMatch(/DROP COLUMN[\s]+interest\b/)
    expect(sql).not.toMatch(/DROP COLUMN IF EXISTS interest\b/)
    expect(sql).not.toMatch(/ALTER TABLE public\.user_interests[\s\S]*?DROP COLUMN interest/)
  })

  // --- Index ----------------------------------------------------------------

  it('creates idx_user_interests_tag for the new FK-keyed lookups', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_user_interests_tag\s*ON public\.user_interests\(tag_id\)/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 1 — Cross-migration scope guarantees
// ════════════════════════════════════════════════════════════════════════════

describe('Migration 2 + 3 — scope guarantees (per the W2+W3 prompt)', () => {
  const m2 = loadMigration(MIGRATION_2_PATH)
  const m3 = loadMigration(MIGRATION_3_PATH)

  it('Migration 2 does NOT drop the events.category column (F1 lives separately)', () => {
    // Spec Decision 5 — the dual-write window depends on the column
    // surviving Migration 2. F1 (Migration 4) ships after the
    // application code has fully migrated.
    expect(m2).not.toMatch(/DROP COLUMN[\s]+category\b/)
    expect(m2).not.toMatch(/DROP COLUMN IF EXISTS category\b/)
  })

  it('Migration 2 does NOT drop the event_category enum (F1 lives separately)', () => {
    expect(m2).not.toMatch(/DROP TYPE[\s]+(IF EXISTS )?(public\.)?event_category/)
  })

  it('Migration 2 does NOT add new event_category enum values', () => {
    // Spec Decision 5 caveat — the 15 new primary slugs do NOT match
    // the 9-value enum 1:1. Adding new enum values that are about to be
    // dropped in F1 would be needless churn.
    expect(m2).not.toMatch(/ALTER TYPE event_category ADD VALUE/)
    expect(m2).not.toMatch(/ALTER TYPE public\.event_category ADD VALUE/)
  })

  it('Migration 2 does NOT execute or modify anything in src/ (schema-only scope)', () => {
    // Sanity — comments may legitimately *reference* src/ paths (e.g.
    // "the constant lives in src/lib/constants.ts"), but no executable
    // SQL statement should depend on a source file. Scope verification
    // proper is: backend-developer's PR diff is migrations-only.
    // Here we just confirm there is no `\\i src/...` or `COPY ... FROM
    // 'src/...'` style reference that would couple the migration to
    // the application bundle.
    expect(m2).not.toMatch(/\\i\s+src\//)
    expect(m3).not.toMatch(/\\i\s+src\//)
    expect(m2).not.toMatch(/COPY[\s\S]*?FROM\s+'src\//)
    expect(m3).not.toMatch(/COPY[\s\S]*?FROM\s+'src\//)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 3 — PRIMARY_ELIGIBLE_TAG_SLUGS constant <-> seed cross-check
// (deferred until W5 introduces the constant)
// ════════════════════════════════════════════════════════════════════════════

describe('PRIMARY_ELIGIBLE_TAG_SLUGS constant ↔ Migration 2 seed (TODO(W5))', () => {
  it.skip('constant in src/lib/constants.ts equals the 15 primary-eligible slugs in the seed', async () => {
    // TODO(W5): once W5's frontend work introduces
    //   export const PRIMARY_ELIGIBLE_TAG_SLUGS = new Set<string>([...])
    // unskip this test:
    //
    //   const { PRIMARY_ELIGIBLE_TAG_SLUGS } = await import('@/lib/constants')
    //   expect([...PRIMARY_ELIGIBLE_TAG_SLUGS].sort()).toEqual(
    //     PRIMARY_ELIGIBLE_SLUGS.map(([slug]) => slug).sort(),
    //   )
    //
    // The two sources MUST stay in lockstep — admin event-creation form
    // reads the constant; the DB tags table reads the seed; if they
    // drift, the picker silently includes/excludes the wrong tags.
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 2 — Skipped DB-integration cases (TODO(W4-docker))
//
// These are the W4 prompt's "critical assertions, do not skip" cases.
// They're SKIPPED here because Docker / Docker Desktop is not available
// on the build machine, so a local Supabase stack can't be brought up.
// Unskip once `supabase start` is reachable and run against a fresh
// `supabase db reset`. Each `it.skip(...)` body documents what the test
// should do; the names are written so failures cleanly identify the
// regression.
// ════════════════════════════════════════════════════════════════════════════

describe('DB integration — seed integrity (TODO(W4-docker))', () => {
  it.skip('select count(*) from tags returns exactly 23', async () => {
    // TODO(W4-docker): after `supabase db reset`:
    //   const { count } = await admin.from('tags').select('*', { count: 'exact', head: true })
    //   expect(count).toBe(23)
  })

  it.skip('the 15 primary-eligible slugs are present with the spec sort_orders', async () => {
    // TODO(W4-docker):
    //   const { data } = await admin.from('tags')
    //     .select('slug, label, sort_order')
    //     .lte('sort_order', 199)
    //     .order('sort_order', { ascending: true })
    //   expect(data).toEqual(PRIMARY_ELIGIBLE_SLUGS.map(([slug, label, sort_order]) => ({ slug, label, sort_order })))
  })

  it.skip('the 8 interest-only slugs all start with "interest-" prefix', async () => {
    // TODO(W4-docker):
    //   const { data } = await admin.from('tags').select('slug').gte('sort_order', 200)
    //   data.forEach(({ slug }) => expect(slug).toMatch(/^interest-/))
  })
})

describe('DB integration — primary-tag uniqueness (TODO(W4-docker))', () => {
  it.skip('inserting a second is_primary=true row for the same event fails with unique-violation', async () => {
    // TODO(W4-docker): pick any seeded event (say e1...001), confirm it
    // already has one primary, then try to insert a second:
    //   const { error } = await admin.from('event_tags').insert({
    //     event_id: 'e1000000-0000-0000-0000-000000000001',
    //     tag_id: <some other tag uuid>,
    //     is_primary: true,
    //   })
    //   expect(error?.code).toBe('23505')  // unique_violation
    //   expect(error?.message).toMatch(/uq_event_tags_one_primary/)
  })

  it.skip('inserting a second secondary (is_primary=false) row for the same event succeeds', async () => {
    // TODO(W4-docker): the partial unique index only catches is_primary=true.
    // Secondaries are unconstrained beyond uq_event_tags_event_tag (no
    // duplicate of the same tag).
  })
})

describe('DB integration — bidirectional sync trigger (TODO(W4-docker))', () => {
  it.skip('events → event_tags: UPDATE events.category=\'drinks\' updates the matching event_tags primary', async () => {
    // TODO(W4-docker): pick an event whose current primary is NOT
    // drinks-bars (e.g. e1...008 = weekends-travel after backfill).
    // Run:
    //   await admin.from('events').update({ category: 'drinks' }).eq('id', eventId)
    // Then:
    //   const { data } = await admin.from('event_tags')
    //     .select('tag_id, is_primary, tags(slug)')
    //     .eq('event_id', eventId).eq('is_primary', true).single()
    // Expect: data.tags.slug === 'drinks-bars'.
    // And: count of is_primary=true rows for this event === 1 (the
    // trigger replaced the prior primary, did not add).
  })

  it.skip('event_tags → events: UPDATE event_tags.tag_id (primary) updates events.category', async () => {
    // TODO(W4-docker): pick an event with primary = drinks-bars
    // (events.category = 'drinks'). UPDATE the primary tag_id to point
    // at the live-music-gigs tag. Expect events.category = 'music'.
  })

  it.skip('flipping is_primary=true on a secondary row updates events.category', async () => {
    // TODO(W4-docker): take a multi-tagged event (e.g. Halloween, e1...028).
    // Switch the primary from nightlife-dancing to themed-socials by:
    //   1. UPDATE event_tags SET is_primary = false WHERE event_id = ... AND tag_id = nightlife-dancing-id
    //   2. UPDATE event_tags SET is_primary = true  WHERE event_id = ... AND tag_id = themed-socials-id
    // Expect: events.category = 'drinks' (themed-socials maps to drinks).
  })

  it.skip('trigger recursion guard: bidirectional UPDATE in a transaction completes in <50ms (no infinite loop)', async () => {
    // TODO(W4-docker):
    //   const start = Date.now()
    //   await admin.rpc('exec_sql', {
    //     sql: `UPDATE events SET category = 'sport' WHERE id = '...'`
    //   })
    //   expect(Date.now() - start).toBeLessThan(50)
    // The pg_trigger_depth() > 1 guard on both sides means the chain
    // is single-bounce. Without it, the cycle would consume CPU until
    // the transaction was killed by the statement timeout.
  })

  it.skip('slug→enum lossy mapping is no-op: theatre-comedy ↔ galleries-museums (both → cultural)', async () => {
    // TODO(W4-docker): documented dual-write behaviour (Decision 5 caveat).
    // Pick an event with primary = theatre-comedy (events.category = 'cultural').
    // Capture the events.category value and a marker on the row (e.g. updated_at).
    //   const before = await admin.from('events').select('category, updated_at').eq('id', e).single()
    // Flip the primary tag from theatre-comedy → galleries-museums:
    //   await admin.from('event_tags').update({ tag_id: galleriesMuseumsTagId }).eq('event_id', e).eq('is_primary', true)
    // Re-read events.category — must still be 'cultural'.
    //   const after = await admin.from('events').select('category, updated_at').eq('id', e).single()
    //   expect(after.category).toBe('cultural')
    // The IS DISTINCT FROM guard on Side B should also have prevented
    // an UPDATE-without-change firing — verify updated_at is unchanged
    // (or at least no row write happened):
    //   expect(after.updated_at).toEqual(before.updated_at)
    // This guards against a future "fix" that re-broadens the trigger
    // to write on every primary flip.
  })

  it.skip('Side A — RAISE EXCEPTION on unknown legacy category value', async () => {
    // TODO(W4-docker): hard to test directly because the enum constraint
    // would reject the bad value before the trigger sees it. Instead,
    // verify that adding a new event_category enum value WITHOUT
    // updating the trigger CASE causes the trigger to raise on the
    // first UPDATE that uses the new value:
    //   await admin.rpc('exec_sql', { sql: "ALTER TYPE event_category ADD VALUE 'experimental'" })
    //   try { await admin.from('events').update({ category: 'experimental' }).eq('id', ...) }
    //   catch (err) { expect(err.message).toMatch(/unknown legacy category value/) }
    //   // Cleanup: revert the enum change (which is non-trivial — see
    //   // pg_enum hacking; better to skip or use a transaction.
  })

  it.skip('Side B — RAISE EXCEPTION when an interest-only tag is flipped to is_primary=true', async () => {
    // TODO(W4-docker): the slug→enum function returns NULL for any
    // interest-… slug. Side B raises 'no legacy enum mapping for
    // primary tag slug: %' on NULL. Test:
    //   const interestTechTag = await admin.from('tags').select('id').eq('slug', 'interest-technology').single()
    //   try { await admin.from('event_tags').insert({ event_id: someEventId, tag_id: interestTechTag.id, is_primary: true }) }
    //   catch (err) { expect(err.message).toMatch(/no legacy enum mapping for primary tag slug: interest-technology/) }
  })
})

describe('DB integration — backfill correctness (TODO(W4-docker))', () => {
  it.skip('count(event_tags WHERE is_primary) == count(events WHERE deleted_at IS NULL)', async () => {
    // TODO(W4-docker): every event has exactly one primary tag.
    //   const { count: primaryCount } = await admin.from('event_tags')
    //     .select('*', { count: 'exact', head: true }).eq('is_primary', true)
    //   const { count: eventCount } = await admin.from('events')
    //     .select('*', { count: 'exact', head: true }).is('deleted_at', null)
    //   expect(primaryCount).toBe(eventCount)
  })

  it.skip('count(event_tags WHERE NOT is_primary) ≥ 16', async () => {
    // TODO(W4-docker): the spec backfill produces ≥16 secondary rows.
    //   const { count } = await admin.from('event_tags')
    //     .select('*', { count: 'exact', head: true }).eq('is_primary', false)
    //   expect(count).toBeGreaterThanOrEqual(16)
  })

  it.skip('count(user_interests WHERE tag_id IS NULL) == 0', async () => {
    // TODO(W4-docker): the Migration 3 verification block already
    // asserts this with RAISE EXCEPTION at apply time. This is a belt-
    // and-braces check against a future migration that ADDs a row
    // without a tag_id.
    //   const { count } = await admin.from('user_interests')
    //     .select('*', { count: 'exact', head: true }).is('tag_id', null)
    //   expect(count).toBe(0)
  })

  it.skip('Halloween (Event 28) has nightlife-dancing primary + festivals-seasonal + themed-socials secondaries', async () => {
    // TODO(W4-docker): spot-check from the W4 prompt.
    //   const { data } = await admin.from('event_tags')
    //     .select('is_primary, tags(slug)')
    //     .eq('event_id', 'e1000000-0000-0000-0000-000000000028')
    //     .order('is_primary', { ascending: false })
    //   expect(data.find(r => r.is_primary).tags.slug).toBe('nightlife-dancing')
    //   const secondarySlugs = data.filter(r => !r.is_primary).map(r => r.tags.slug).sort()
    //   expect(secondarySlugs).toEqual(['festivals-seasonal', 'themed-socials'])
  })

  it.skip('Polo in the Park (Event 25) has festivals-seasonal primary + outdoor-picnics secondary', async () => {
    // TODO(W4-docker): spot-check from the W4 prompt.
    //   const { data } = await admin.from('event_tags')
    //     .select('is_primary, tags(slug)')
    //     .eq('event_id', 'e1000000-0000-0000-0000-000000000025')
    //   expect(data.find(r => r.is_primary).tags.slug).toBe('festivals-seasonal')
    //   const secondarySlugs = data.filter(r => !r.is_primary).map(r => r.tags.slug)
    //   expect(secondarySlugs).toEqual(['outdoor-picnics'])
  })
})

describe('DB integration — user_interests FK + unique constraint (TODO(W4-docker))', () => {
  it.skip('INSERT user_interests with non-existent tag_id fails (FK violation)', async () => {
    // TODO(W4-docker): a synthetic uuid that isn't in tags.
    //   const { error } = await admin.from('user_interests').insert({
    //     user_id: someMemberUuid,
    //     interest: 'X',
    //     tag_id: '00000000-0000-0000-0000-000000000000',
    //   })
    //   expect(error?.code).toBe('23503')  // foreign_key_violation
  })

  it.skip('uq_user_interests_user_tag rejects same user inserting same tag twice', async () => {
    // TODO(W4-docker):
    //   await admin.from('user_interests').insert({ user_id, interest: 'A', tag_id: someTagId })
    //   const { error } = await admin.from('user_interests').insert({ user_id, interest: 'B', tag_id: someTagId })
    //   expect(error?.code).toBe('23505')  // unique_violation
    //   expect(error?.message).toMatch(/uq_user_interests_user_tag/)
  })

  it.skip('legacy uq_user_interests_user_interest constraint is removed', async () => {
    // TODO(W4-docker): query pg_constraint and verify the old
    // constraint is gone (the migration explicitly drops it).
    //   const { data } = await admin.rpc('exec_sql', {
    //     sql: `SELECT conname FROM pg_constraint WHERE conrelid = 'public.user_interests'::regclass`
    //   })
    //   const names = data.map(r => r.conname)
    //   expect(names).toContain('uq_user_interests_user_tag')
    //   expect(names).not.toContain('uq_user_interests_user_interest')
  })

  it.skip('user_interests.interest text column still exists (kept until F2)', async () => {
    // TODO(W4-docker): the spec keeps the text column for one release.
    //   const { data } = await admin.rpc('exec_sql', {
    //     sql: `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_interests'`
    //   })
    //   expect(data.map(r => r.column_name)).toContain('interest')
  })

  it.skip('seed user_interests rows all have tag_id populated (post-Migration 3 backfill)', async () => {
    // TODO(W4-docker): walk the 7 seeded members × 4 interests = 28 rows
    // and assert each has a non-null tag_id matching the reconciliation
    // map.
  })
})

describe('DB integration — RLS / GRANT (TODO(W4-docker))', () => {
  it.skip('anon can SELECT active tags', async () => {
    // TODO(W4-docker): the taxonomy is genuinely public.
    //   const { data, error } = await anon.from('tags').select('slug').eq('is_active', true)
    //   expect(error).toBeNull()
    //   expect(data?.length).toBe(23)
  })

  it.skip('anon can SELECT event_tags for published events', async () => {
    // TODO(W4-docker): seeded events are all published.
    //   const { data, error } = await anon.from('event_tags').select('tag_id').limit(1)
    //   expect(error).toBeNull()
    //   expect(data?.length).toBeGreaterThan(0)
  })

  it.skip('anon CANNOT SELECT event_tags for draft events', async () => {
    // TODO(W4-docker): create a draft event (is_published = false) +
    // attach a tag. From an anon client, the row should not appear:
    //   const { data } = await anon.from('event_tags').select('event_id').eq('event_id', draftId)
    //   expect(data).toEqual([])
  })

  it.skip('non-admin authenticated CANNOT INSERT into tags', async () => {
    // TODO(W4-docker): RLS gate.
    //   const { error } = await memberAuth.from('tags').insert({ slug: 'evil', label: 'Evil' })
    //   expect(error).toBeTruthy()
    //   expect(error?.message).toMatch(/policy/)
  })

  it.skip('non-admin authenticated CANNOT INSERT into event_tags', async () => {
    // TODO(W4-docker): RLS gate.
    //   const { error } = await memberAuth.from('event_tags').insert({ event_id: e, tag_id: t, is_primary: false })
    //   expect(error).toBeTruthy()
  })

  it.skip('admin authenticated CAN INSERT into tags', async () => {
    // TODO(W4-docker): RLS happy path.
    //   const { error } = await adminAuth.from('tags').insert({ slug: 'one-off', label: 'One Off' })
    //   expect(error).toBeNull()
    // (then clean up).
  })
})
