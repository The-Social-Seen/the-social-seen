// Phase 3 taxonomy constants — sanity guards.
//
// Post-F1b-schema (Migration 20260506000001), the `event_category` enum
// and the `_tag_slug_to_legacy_category` SQL helper are gone. The
// previously-tested slug→enum mapping (`legacyCategoryForSlug`) was
// removed alongside them. What remains is the 15-tag canonical taxonomy;
// these guards check that the TS source still mirrors the migration's
// seed exactly.
import { describe, it, expect } from 'vitest'
import { PRIMARY_ELIGIBLE_TAG_SLUGS } from '../tags'

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
