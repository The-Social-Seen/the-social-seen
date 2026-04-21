// ── Primitive enums (match DB enum values exactly) ───────────────────────────

export type UserRole = 'member' | 'admin'

export type UserStatus = 'active' | 'suspended' | 'banned'

export type EventCategory =
  | 'drinks'
  | 'dining'
  | 'cultural'
  | 'wellness'
  | 'sport'
  | 'workshops'
  | 'music'
  | 'networking'
  | 'activity'

export type BookingStatus = 'confirmed' | 'cancelled' | 'waitlisted' | 'no_show'

export type NotificationType = 'reminder' | 'announcement' | 'waitlist' | 'event_update'

export type NotificationRecipient = 'all' | 'event_attendees' | 'waitlisted' | 'custom'

// ── Category label map ────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  drinks:     'Drinks',
  dining:     'Dining',
  cultural:   'Cultural',
  wellness:   'Wellness',
  sport:      'Sport',
  workshops:  'Workshops',
  music:      'Music',
  networking: 'Networking',
  activity:   'Activity',
}

export function categoryLabel(category: EventCategory): string {
  return CATEGORY_LABELS[category]
}

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
  category:          EventCategory
  price:             number   // stored in pence; £35 = 3500
  capacity:          number | null  // null = unlimited capacity
  image_url:         string | null
  dress_code:        string | null
  is_published:      boolean
  is_cancelled:      boolean
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
  interest:   string
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

export interface EventWithStats extends Event {
  confirmed_count: number
  avg_rating:      number
  review_count:    number
  spots_left:      number | null  // null when capacity is null (unlimited)
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
    'id' | 'slug' | 'title' | 'date_time' | 'end_time' | 'venue_name' | 'image_url' | 'category' | 'dress_code'
  >
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
  category: EventCategory
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
