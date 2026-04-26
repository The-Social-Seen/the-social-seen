import type { EventCategory } from '@/types'

// ── Site config ───────────────────────────────────────────────────────────────

export const SITE_CONFIG = {
  name:        'The Social Seen',
  tagline:     'Where Connections Become Stories',
  description: "Supper clubs. Gallery openings. Rooftop drinks. London's most interesting professionals, one unforgettable evening at a time.",
  url:         'https://thesocialseen.com',
  memberCount: '1,000+',
  eventsHosted: '200+',
  avgRating:   '4.9',
} as const

// ── Social ───────────────────────────────────────────────────────────────────
// Single source of truth for the brand's social URLs. Used by the footer,
// the gallery follow-CTA, the post-booking nudge, and the Organization
// JSON-LD `sameAs`. Add additional channels here as they go live.

export const SOCIAL_LINKS = {
  instagram: 'https://www.instagram.com/the_social_seen',
} as const

// ── Timezone ──────────────────────────────────────────────────────────────────

export const LONDON_TZ = 'Europe/London'

// ── Navigation ────────────────────────────────────────────────────────────────

export const NAV_LINKS_PUBLIC = [
  { label: 'Events',      href: '/events' },
  { label: 'Gallery',     href: '/gallery' },
  { label: 'Contact',     href: '/contact' },
  { label: 'Collaborate', href: '/collaborate' },
  { label: 'Join',        href: '/join' },
  { label: 'Sign In',     href: '/login' },
] as const

export const NAV_LINKS_MEMBER = [
  { label: 'Events',      href: '/events' },
  { label: 'Gallery',     href: '/gallery' },
  { label: 'My Bookings', href: '/bookings' },
  { label: 'Contact',     href: '/contact' },
] as const

// ── Event categories ──────────────────────────────────────────────────────────

export const CATEGORIES: Array<{ value: EventCategory; label: string }> = [
  { value: 'drinks',     label: 'Drinks' },
  { value: 'dining',     label: 'Dining' },
  { value: 'cultural',   label: 'Cultural' },
  { value: 'wellness',   label: 'Wellness' },
  { value: 'sport',      label: 'Sport' },
  { value: 'workshops',  label: 'Workshops' },
  { value: 'music',      label: 'Music' },
  { value: 'networking', label: 'Networking' },
  { value: 'activity',   label: 'Activity' },
]

// ── Interest options (used in registration Step 2) ────────────────────────────
//
// ⚠️ Lockstep with Migration 3 + seed.sql.
//
// Each entry's `slug` is the canonical taxonomy slug from `public.tags` that
// the legacy `interest` text value maps to. After Migration 3
// (20260504000002_migrate_user_interests_to_tag_id.sql), `user_interests.tag_id`
// is NOT NULL — every write-path (saveInterests, updateInterests) must
// resolve and insert a tag_id alongside the legacy `interest` text.
//
// The slug→text map is replicated in three places that MUST stay identical:
//   • DB (Migration 3 reconciliation backfill — CASE in the UPDATE)
//   • DB (supabase/seed.sql user_interests INSERT — JOIN tags ON CASE)
//   • Code (this file — the `slug` field on each entry)
// A future cross-check test (W5 / code-reviewer scope) should mechanically
// assert all three stay in sync.

export const INTEREST_OPTIONS = [
  // Group A — primary-eligible remaps (6)
  { value: 'Wine & Cocktails',     label: 'Wine & Cocktails',     slug: 'drinks-bars' },
  { value: 'Fine Dining',          label: 'Fine Dining',          slug: 'dining-supper-clubs' },
  { value: 'Art & Culture',        label: 'Art & Culture',        slug: 'galleries-museums' },
  { value: 'Yoga & Wellness',      label: 'Yoga & Wellness',      slug: 'wellness-mindfulness' },
  { value: 'Running & Sport',      label: 'Running & Sport',      slug: 'sport-fitness' },
  { value: 'Jazz & Music',         label: 'Jazz & Music',         slug: 'live-music-gigs' },
  // Group B — interest-only remaps (8)
  { value: 'Technology',           label: 'Technology',           slug: 'interest-technology' },
  { value: 'Entrepreneurship',     label: 'Entrepreneurship',     slug: 'interest-entrepreneurship' },
  { value: 'Networking',           label: 'Networking',           slug: 'interest-networking' },
  { value: 'Photography',          label: 'Photography',          slug: 'interest-photography' },
  { value: 'Travel',               label: 'Travel',               slug: 'interest-travel' },
  { value: 'Books & Literature',   label: 'Books & Literature',   slug: 'interest-books-literature' },
  { value: 'Sustainable Living',   label: 'Sustainable Living',   slug: 'interest-sustainable-living' },
  { value: 'Film & Cinema',        label: 'Film & Cinema',        slug: 'interest-film-cinema' },
] as const

export type InterestValue = (typeof INTEREST_OPTIONS)[number]['value']
export type InterestSlug = (typeof INTEREST_OPTIONS)[number]['slug']

/**
 * Resolve a legacy interest text value to its canonical tag slug.
 * Returns the slug or `undefined` if the input is off-list (callers should
 * treat undefined as a validation failure — never silently drop the row).
 */
export function interestSlugFor(value: string): InterestSlug | undefined {
  return INTEREST_OPTIONS.find((opt) => opt.value === value)?.slug
}

// ── "How did you hear about us?" options (registration Step 1) ───────────────

export const HEAR_ABOUT_OPTIONS = [
  'A friend or colleague',
  'Instagram',
  'LinkedIn',
  'Attended an event',
  'Google search',
  'Other',
] as const

// ── Pricing ───────────────────────────────────────────────────────────────────

/** Prices are stored in pence. This constant makes intent explicit. */
export const PENCE_PER_POUND = 100

// ── Booking limits ────────────────────────────────────────────────────────────

/** Warn when an event has this many spots remaining */
export const LOW_SPOTS_THRESHOLD = 5

/** Events within this many hours show a "Tomorrow" reminder highlight */
export const REMINDER_HOURS_THRESHOLD = 48

// ── Admin ─────────────────────────────────────────────────────────────────────

export const ADMIN_EMAIL = 'mitesh50@hotmail.com'

// ── Supabase Storage buckets ──────────────────────────────────────────────────

export const STORAGE_BUCKETS = {
  eventImages: 'event-images',
  avatars:     'avatars',
} as const
