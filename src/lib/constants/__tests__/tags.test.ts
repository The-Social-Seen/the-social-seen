// W5 — slug→legacy enum mapping must mirror Migration 2's
// `_tag_slug_to_legacy_category()` SQL function exactly. Drift between
// the two would cause the bidirectional trigger and the app code to
// disagree on what `events.category` should be after a primary-tag
// flip.
//
// These assertions are duplicated against the migration's source to
// catch any future edit that updates one side without the other.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  legacyCategoryForSlug,
  PRIMARY_ELIGIBLE_TAG_SLUGS,
} from '../tags'

const MIGRATION_2_PATH = resolve(
  __dirname,
  '../../../../supabase/migrations/20260504000001_create_tags_and_event_tags.sql',
)

const MIGRATION_SQL = readFileSync(MIGRATION_2_PATH, 'utf-8')

describe('PRIMARY_ELIGIBLE_TAG_SLUGS', () => {
  it('contains exactly 15 slugs (the 15 primary-eligible tags from Decision 4)', () => {
    expect(PRIMARY_ELIGIBLE_TAG_SLUGS.size).toBe(15)
  })

  it('matches the spec list verbatim', () => {
    const expected = new Set([
      'drinks-bars',
      'dining-supper-clubs',
      'activities-social-games',
      'nightlife-dancing',
      'live-music-gigs',
      'theatre-comedy',
      'galleries-museums',
      'festivals-seasonal',
      'sport-fitness',
      'outdoor-picnics',
      'weekends-travel',
      'themed-socials',
      'charity-volunteering',
      'wellness-mindfulness',
      'workshops-masterclasses',
    ])
    expect(PRIMARY_ELIGIBLE_TAG_SLUGS).toEqual(expected)
  })

  it('does NOT contain any interest-only (interest-…) slugs', () => {
    for (const slug of PRIMARY_ELIGIBLE_TAG_SLUGS) {
      expect(slug.startsWith('interest-')).toBe(false)
    }
  })
})

describe('legacyCategoryForSlug', () => {
  // Mirror Migration 2's CASE expression. Each row in this table MUST
  // also appear as a `WHEN '<slug>' THEN '<enum>'::public.event_category`
  // line in the migration's `_tag_slug_to_legacy_category` function. The
  // sabotage check below reads the migration source and asserts both
  // halves agree.
  const SLUG_TO_ENUM: ReadonlyArray<readonly [string, string]> = [
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
  ]

  for (const [slug, enumValue] of SLUG_TO_ENUM) {
    it(`maps '${slug}' → '${enumValue}'`, () => {
      expect(legacyCategoryForSlug(slug)).toBe(enumValue)
    })
  }

  it('returns null for interest-only slugs (defensive — picker shouldn’t allow them as primary anyway)', () => {
    expect(legacyCategoryForSlug('interest-technology')).toBeNull()
    expect(legacyCategoryForSlug('interest-networking')).toBeNull()
  })

  it('returns null for unknown slugs', () => {
    expect(legacyCategoryForSlug('completely-made-up-slug')).toBeNull()
    expect(legacyCategoryForSlug('')).toBeNull()
  })

  it('every TS mapping has a matching CASE branch in Migration 2 (lockstep guard)', () => {
    // A future-developer "fix" that updated only the migration (or only
    // this constants file) would silently change the behaviour of the
    // bidirectional trigger. This assertion fails loud if either half
    // drifts.
    for (const [slug, enumValue] of SLUG_TO_ENUM) {
      const re = new RegExp(
        `WHEN '${slug.replace(/-/g, '\\-')}'\\s+THEN '${enumValue}'::public\\.event_category`,
      )
      expect(MIGRATION_SQL, `Migration 2 missing CASE for ${slug}`).toMatch(re)
    }
  })

  it('every PRIMARY_ELIGIBLE_TAG_SLUGS entry has a non-null legacy enum mapping', () => {
    // Without this, an admin selecting that slug as primary would push
    // the bidirectional trigger into Side B's RAISE EXCEPTION ('no legacy
    // enum mapping for primary tag slug: %').
    for (const slug of PRIMARY_ELIGIBLE_TAG_SLUGS) {
      expect(legacyCategoryForSlug(slug), `no enum for ${slug}`).not.toBeNull()
    }
  })
})
