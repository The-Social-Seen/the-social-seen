// ── Primitive enums (match DB enum values exactly) ───────────────────────────

export type UserRole = 'member' | 'admin'

export type UserStatus = 'active' | 'suspended' | 'banned'

// `EventCategory` (the legacy 9-value enum) was retired in F1b-schema —
// `events.category` and the corresponding Postgres enum no longer exist.
// `event_tags.is_primary = true` is the sole source of truth for an
// event's primary categorisation; the 15 primary-eligible tag slugs live
// in src/lib/constants/tags.ts (PRIMARY_ELIGIBLE_TAG_SLUGS /
// PRIMARY_TAG_LABELS) and member-facing rendering reads
// event.primary_tag.label.

export type BookingStatus =
  | 'confirmed'
  | 'cancelled'
  | 'waitlisted'
  | 'no_show'
  // P2-7: paid bookings live here between book_event_paid() and the Stripe
  // webhook flipping them to 'confirmed'. See migration 20260422000001.
  | 'pending_payment'

export type NotificationType = 'reminder' | 'announcement' | 'waitlist' | 'event_update'

export type NotificationRecipient = 'all' | 'event_attendees' | 'waitlisted' | 'custom'

// ── Member-data demographics (Phase 3, Migration 1) ──────────────────────────

export type Gender = 'female' | 'male' | 'non_binary' | 'prefer_not_to_say'

export type AgeRange =
  | '18-24'
  | '25-29'
  | '30-34'
  | '35-39'
  | '40-44'
  | '45-49'
  | '50+'

// ── Database row types ────────────────────────────────────────────────────────
// These mirror the public schema tables 1:1 (snake_case, exact field names).

export interface Profile {
  id:                  string
  email:               string
  full_name:           string
  avatar_url:          string | null
  job_title:           string | null
  company:             string | null
  industry:            string | null
  bio:                 string | null
  linkedin_url:        string | null
  role:                UserRole
  onboarding_complete: boolean
  referral_source:     string | null
  // Added by migration 20260420000001 (P2-2 registration, P2-3 verification, P2-8 member mgmt)
  phone_number:        string | null
  email_consent:       boolean
  email_verified:      boolean
  status:              UserStatus
  created_at:          string
  updated_at:          string
  deleted_at:          string | null
}

export interface Event {
  id:                string
  slug:              string
  title:             string
  description:       string
  short_description: string
  date_time:         string   // ISO timestamptz — always UTC from DB
  end_time:          string   // ISO timestamptz — always UTC from DB
  venue_name:        string
  venue_address:     string
  // P2-5: if false, venue_name + venue_address are hidden on the public
  // event page until 1 week before date_time. Daily cron flips to true and
  // emails confirmed attendees.
  venue_revealed:    boolean
  // P2-5: UK postcode, used for Google Maps link. Null on legacy events.
  postcode:          string | null
  // `category` (legacy 9-value enum) dropped in F1b-schema. Source of
  // truth for primary categorisation is event_tags.is_primary = true,
  // surfaced as `primary_tag` on EventWithStats / EventDetail / the
  // BookingWithEvent.event Pick<>.
  price:             number   // stored in pence; £35 = 3500
  capacity:          number | null  // null = unlimited capacity
  image_url:         string | null
  dress_code:        string | null
  // Hours before start within which cancellations are refunded.
  // 0 = non-refundable. Default 48. Per-event configurable.
  refund_window_hours: number
  is_published:      boolean
  is_cancelled:      boolean
  // Off-platform partnership attendees. Purely additive to the public-facing
  // "going" display (via EventWithStats.total_attending). Does NOT consume
  // capacity — booking RPCs continue to gate on platform confirmed_count only.
  external_attendees: number
  created_at:        string
  updated_at:        string
  deleted_at:        string | null
}

export interface EventHost {
  id:         string
  event_id:   string
  profile_id: string
  role_label: string
  sort_order: number
  created_at: string
}

export interface EventInclusion {
  id:         string
  event_id:   string
  label:      string
  icon:       string | null  // Lucide icon name (kebab-case)
  sort_order: number
  created_at: string
}

export interface Booking {
  id:               string
  user_id:          string
  event_id:         string
  status:           BookingStatus
  waitlist_position: number | null
  price_at_booking: number   // pence snapshot at time of booking
  /**
   * Non-refundable booking fee charged on top of price_at_booking at
   * checkout. Snapshot at row creation; never updates after that.
   * 0 for free events and pre-migration rows.
   * Added by migration 20260517000001 (refund-fee-deduction).
   * Refund policy:
   *   - User-initiated cancellation: NOT refunded (covers Stripe fee).
   *   - Admin-initiated event cancellation: refunded (platform absorbs).
   */
  booking_fee_pence: number
  /**
   * Actual Stripe processing fee captured from BalanceTransaction.fee
   * in the checkout.session.completed webhook. Reporting / reconciliation
   * only — NOT used in any refund formula.
   * 0 for free events and if the webhook lookup failed (non-blocking).
   * Added by migration 20260517000001 (refund-fee-deduction).
   */
  stripe_fee_pence:  number
  booked_at:        string
  created_at:       string
  updated_at:       string
  deleted_at:       string | null
}

export interface EventReview {
  id:          string
  user_id:     string
  event_id:    string
  rating:      number   // 1–5
  review_text: string | null
  is_visible:  boolean
  created_at:  string
  updated_at:  string
}

export interface EventPhoto {
  id:         string
  event_id:   string
  image_url:  string
  caption:    string | null
  sort_order: number
  created_at: string
}

export interface UserInterest {
  id:         string
  user_id:    string
  // FK to public.tags. After F2-schema (drop_user_interests_interest_column),
  // this is the sole carrier of interest semantics — the legacy `interest`
  // text column is gone. Reads JOIN to tags.label for the display string.
  tag_id:     string
  created_at: string
}

// ── Canonical taxonomy (Phase 3, Migration 2) ────────────────────────────────

export interface Tag {
  id:         string
  slug:       string
  label:      string
  parent_id:  string | null
  sort_order: number
  is_active:  boolean
  created_at: string
  updated_at: string
}

export interface EventTag {
  id:         string
  event_id:   string
  tag_id:     string
  is_primary: boolean
  created_at: string
}

export type NotificationChannel = 'in_app' | 'email' | 'sms'
export type NotificationStatus = 'sent' | 'failed' | 'pending'

export interface Notification {
  id:                 string
  // Nullable since migration 20260421000001 — system emails (cron-driven
  // reminders, etc.) have no requesting user.
  sent_by:            string | null
  recipient_type:     NotificationRecipient
  recipient_event_id: string | null
  type:               NotificationType
  subject:            string
  body:               string
  sent_at:            string
  created_at:         string
  // Added by migration 20260421000001 (P2-4 transactional email):
  channel:            NotificationChannel
  recipient_email:    string | null
  provider_message_id: string | null
  status:             NotificationStatus
  error_message:      string | null
  template_name:      string | null
}

// ── View types ────────────────────────────────────────────────────────────────
// Mirrors the event_with_stats database view.

/**
 * Primary-tag info attached to every member-facing event row.
 *
 * Phase 3 F1a / F1b: the events query layer JOINs `event_tags` + `tags`
 * so member-facing rendering reads the canonical 15-tag taxonomy via
 * `event.primary_tag.label`. The partial unique index
 * `uq_event_tags_one_primary` guarantees exactly one primary tag per
 * event, so this field is non-nullable.
 *
 * The legacy `events.category` column and `event_category` Postgres enum
 * were retired in F1b-schema (Migration 20260506000001). This is now the
 * sole vocabulary for primary categorisation.
 *
 * See: docs/member-data-layer-spec.md (Decisions 4, 5, 6, 9).
 */
export interface PrimaryTag {
  slug:  string
  label: string
}

export interface EventWithStats extends Event {
  confirmed_count:   number
  /**
   * Public-facing "X going" total: confirmed_count + external_attendees.
   * Public surfaces (event card, event detail, booking sidebar) read this;
   * admin surfaces stay on confirmed_count for a platform-only view.
   */
  total_attending:   number
  /**
   * Sum of price_at_booking (pence) for confirmed bookings on this event.
   * NULL when not aggregated (e.g. public read paths that don't need it).
   */
  revenue_collected: number | null
  avg_rating:        number
  review_count:      number
  spots_left:        number | null  // null when capacity is null (unlimited)
  /**
   * Primary tag from `event_tags` + `tags` join. Non-nullable —
   * every event has exactly one primary by the partial unique index.
   */
  primary_tag:     PrimaryTag
}

// ── Composed types for UI consumption ────────────────────────────────────────
// These are assembled by the data layer (server components / server actions).

/** Full event detail: stats + hosts with profiles + inclusions */
export interface EventDetail extends EventWithStats {
  hosts: Array<
    EventHost & {
      profile: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'bio' | 'job_title' | 'company'>
    }
  >
  inclusions: EventInclusion[]
}

/** A booking row enriched with the event it belongs to */
export interface BookingWithEvent extends Booking {
  event: Pick<
    Event,
    | 'id'
    | 'slug'
    | 'title'
    | 'short_description'
    | 'date_time'
    | 'end_time'
    | 'venue_name'
    | 'venue_address'
    | 'image_url'
    | 'dress_code'
  > & {
    /**
     * Primary tag from the event_tags + tags join. Non-nullable; see
     * `PrimaryTag` / `EventWithStats.primary_tag`.
     */
    primary_tag: PrimaryTag
  }
}

/** A review enriched with the reviewer's public profile */
export interface ReviewWithAuthor extends EventReview {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
}

/** Admin member list row — profile + booking aggregates */
export interface MemberWithStats extends Profile {
  events_attended:  number
  events_confirmed: number
  events_waitlisted: number
}

/**
 * One booking row for the admin per-event attendees view
 * (`getEventBookings`).
 *
 * `profile.phone_number` is admin-only PII merged in JS via the
 * `admin_get_user_phones()` SECURITY DEFINER RPC — it is NEVER part of the
 * `.select()` (revoked from the `authenticated` GRANT in 20260503000002).
 * It is `null` when the member set no phone OR when the profile was
 * soft-deleted (the RPC filters `deleted_at IS NULL`, so deleted-member PII
 * does not resurface). The fee/refund/cancellation fields are typed
 * permissively against the `bookings` table (refund + cancellation metadata
 * is nullable; fee columns are NOT NULL DEFAULT 0).
 */
export interface AdminEventBooking {
  id:                    string
  status:                BookingStatus
  waitlist_position:     number | null
  price_at_booking:      number
  booking_fee_pence:     number
  stripe_fee_pence:      number
  booked_at:             string
  created_at:            string
  stripe_payment_id:     string | null
  stripe_refund_id:      string | null
  refunded_amount_pence: number | null
  cancelled_at:          string | null
  cancellation_reason:   string | null
  // Admin waitlist-promotion payment-hold mechanism (migration
  // 20260713000001). True while this row is a pending_payment seat hold
  // created by promoteFromWaitlist / admin_promote_waitlist_to_hold, as
  // opposed to a normal self-service checkout. See
  // SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §2.5 — surfacing
  // this in the admin bookings UI is a separate frontend/UX task, not
  // done here.
  is_admin_hold:         boolean
  admin_hold_expires_at: string | null
  profile: Pick<
    Profile,
    'id' | 'full_name' | 'email' | 'avatar_url' | 'phone_number'
  > | null
}

// ── Backwards-compatibility layer ─────────────────────────────────────────────
// These types kept existing mock-data pages and components compiling until
// they are rewritten in Batch 3 (Event Pages) and Batch 7 (Reviews & Gallery).
// Do NOT use in new code — prefer the DB row types above.

/**
 * @deprecated Use EventWithStats or EventDetail from the Supabase data layer.
 * Kept for backwards compatibility with pre-Supabase mock components.
 */
export interface SocialEvent {
  id: string
  slug: string
  title: string
  description: string
  shortDescription: string
  dateTime: string
  endTime: string
  venueName: string
  venueAddress: string
  // Soft-typed string post-F1b-schema (EventCategory enum retired).
  // The deprecated mock array still uses these legacy strings; consumers
  // (gallery preview only) don't read this field.
  category: string
  price: number
  capacity: number
  spotsLeft: number
  imageUrl: string
  isPublished: boolean
  isPast: boolean
  hostName: string
  hostRole: string
  hostAvatar: string
  hostBio: string
  dressCode?: string
  whatsIncluded?: string[]
  galleryImages?: GalleryPhoto[]
  reviews?: LegacyEventReview[]
  averageRating?: number
  totalReviews?: number
  attendeeCount: number
}

/**
 * @deprecated Use Profile from the Supabase data layer.
 */
export interface Member {
  id: string
  name: string
  email: string
  jobTitle: string
  company: string
  industry: string
  bio: string
  avatarUrl: string
  linkedinUrl?: string
  interests: string[]
  joinedAt: string
  eventsAttended: number
}

/**
 * @deprecated Use ReviewWithAuthor from the Supabase data layer.
 */
export interface LegacyEventReview {
  id: string
  eventId: string
  userName: string
  userAvatar: string
  rating: number
  reviewText: string
  createdAt: string
}

/**
 * @deprecated Use EventPhoto from the Supabase data layer.
 */
export interface GalleryPhoto {
  id: string
  eventId: string
  imageUrl: string
  caption?: string
}
