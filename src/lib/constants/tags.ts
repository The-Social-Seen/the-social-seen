/**
 * Canonical taxonomy constants — Phase 3 Member Data Layer.
 *
 * Mirrors the seed in `supabase/migrations/20260504000001_create_tags_and_event_tags.sql`.
 *
 * Post-F1b-schema (Migration 20260506000001), the legacy `events.category`
 * enum and the `_tag_slug_to_legacy_category` SQL helper are gone. The
 * 15-tag canonical taxonomy is the sole vocabulary for primary
 * categorisation across DB, API, and UI.
 *
 * ⚠️ Lockstep — change here means change in Migration 2's tag seed. The
 * old "three places" lockstep (seed + slug→enum SQL function + sync
 * trigger CASE) collapsed to one when F1b-schema dropped the trigger
 * + helper.
 */

/**
 * The 15 primary-eligible tag slugs. Admins can choose ANY of these as an
 * event's primary tag. The 8 interest-only slugs (prefixed `interest-`) are
 * NOT in this set and the admin tag picker hides them from the primary
 * column.
 */
export const PRIMARY_ELIGIBLE_TAG_SLUGS = new Set<string>([
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

/**
 * Member-facing display order + labels for the 15 primary-eligible tags.
 *
 * Mirrors the seed in Migration 2 (sort_order 10..150 ascending). Used by
 * the events filter chip bar and any UI that needs to enumerate primary
 * tags without hitting the DB. Labels match `tags.label` exactly — change
 * here means change in Migration 2 too.
 *
 * Order matches the migration's ascending sort_order: "Drinks & Bars" first
 * (sort 10), "Workshops & Masterclasses" last (sort 150).
 */
export const PRIMARY_TAG_LABELS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'drinks-bars',             label: 'Drinks & Bars' },
  { slug: 'dining-supper-clubs',     label: 'Dining & Supper Clubs' },
  { slug: 'activities-social-games', label: 'Activities & Social Games' },
  { slug: 'nightlife-dancing',       label: 'Nightlife & Dancing' },
  { slug: 'live-music-gigs',         label: 'Live Music & Gigs' },
  { slug: 'theatre-comedy',          label: 'Theatre & Comedy' },
  { slug: 'galleries-museums',       label: 'Galleries & Museums' },
  { slug: 'festivals-seasonal',      label: 'Festivals & Seasonal' },
  { slug: 'sport-fitness',           label: 'Sport & Fitness' },
  { slug: 'outdoor-picnics',         label: 'Outdoor & Picnics' },
  { slug: 'weekends-travel',         label: 'Weekends & Travel' },
  { slug: 'themed-socials',          label: 'Themed Socials' },
  { slug: 'charity-volunteering',    label: 'Charity & Volunteering' },
  { slug: 'wellness-mindfulness',    label: 'Wellness & Mindfulness' },
  { slug: 'workshops-masterclasses', label: 'Workshops & Masterclasses' },
]

/**
 * Reverse mapping for the `?category=` → `?tag=` soft fallback on the
 * /events listing page. Mirrors Migration 2's "Step 2: default fallback"
 * SQL — each legacy enum string points to the most representative primary
 * slug (the one a member who clicked the old chip would most plausibly
 * have meant).
 *
 * Post-F1b-schema, the `event_category` Postgres enum is gone — but the
 * 9 string keys here remain valid as URL parameter values forever:
 * external links from emails, Google search results, and social posts
 * predating F1a still arrive with `?category=<old-enum-value>`. The
 * helper below normalises those legacy strings to a canonical primary
 * slug; the page redirects 307 to `?tag=<slug>` and the URL contract
 * is restored.
 *
 * Lossy: an enum value that splits into multiple primary slugs (e.g.
 * `cultural` → theatre / galleries / festivals / charity) collapses to
 * one. That's accepted — the soft fallback exists to keep old shared
 * links from 404'ing, not to perfectly recover original intent. Users
 * landing via the redirect can re-pick a sharper tag from the new chip
 * row.
 *
 * Returns the canonical primary slug, or null if the input isn't a known
 * legacy enum value (caller treats null as "ignore the param").
 */
const LEGACY_CATEGORY_TO_PRIMARY_SLUG: Record<string, string> = {
  drinks:     'drinks-bars',
  dining:     'dining-supper-clubs',
  cultural:   'galleries-museums',     // see Migration 2 Step 2 fallback
  wellness:   'wellness-mindfulness',
  sport:      'sport-fitness',
  workshops:  'workshops-masterclasses',
  music:      'live-music-gigs',
  networking: 'workshops-masterclasses', // networking demoted to interest-only
  activity:   'activities-social-games',
}

export function primarySlugForLegacyCategory(category: string): string | null {
  return LEGACY_CATEGORY_TO_PRIMARY_SLUG[category] ?? null
}
