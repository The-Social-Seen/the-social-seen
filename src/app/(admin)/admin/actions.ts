'use server'

import { createServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { uniqueSlug } from '@/lib/utils/slugify'
import { z } from 'zod'
import type {
  EventCategory,
  EventWithStats,
  MemberWithStats,
  NotificationRecipient,
  NotificationType,
} from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Supabase join results can be object, array-of-one, or null depending on
 * the FK relationship. This normalises to a single object or null.
 */
function extractJoin<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null
  return (value as T) ?? null
}

function extractField<T extends Record<string, unknown>>(
  value: unknown,
  field: keyof T
): T[keyof T] | null {
  const obj = extractJoin<T>(value)
  return obj ? obj[field] : null
}

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Authentication required')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') throw new Error('Admin access required')

  return { supabase, userId: user.id }
}

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const EVENT_CATEGORIES = [
  'drinks', 'dining', 'cultural', 'wellness',
  'sport', 'workshops', 'music', 'networking',
] as const

const eventFormSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  short_description: z.string().min(10).max(300),
  date_time: z.string().datetime({ message: 'Valid ISO datetime required' }),
  end_time: z.string().datetime({ message: 'Valid ISO datetime required' }),
  venue_name: z.string().min(2, 'Venue name must be at least 2 characters'),
  venue_address: z.string().min(5, 'Venue address must be at least 5 characters'),
  category: z.enum(EVENT_CATEGORIES),
  price: z.number().min(0, 'Price cannot be negative'),
  capacity: z.number().int().positive().nullable(),
  image_url: z.string().url().nullable().or(z.literal('')).transform(v => v || null),
  dress_code: z.string().nullable().transform(v => v || null),
  is_published: z.boolean(),
}).refine(
  (data) => new Date(data.end_time) > new Date(data.date_time),
  { message: 'End time must be after start time', path: ['end_time'] }
)

const notificationSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(200),
  body: z.string().min(1, 'Body is required'),
  recipient_type: z.enum(['all', 'event_attendees', 'waitlisted', 'custom'] as const),
  type: z.enum(['reminder', 'announcement', 'waitlist', 'event_update'] as const),
  recipient_event_id: z.string().uuid().nullable().optional(),
})

// ── Form data → typed object helper ──────────────────────────────────────────

/** Normalise datetime-local value (YYYY-MM-DDTHH:mm) to full ISO 8601 with Z suffix. */
function normaliseDatetime(value: string): string {
  if (!value) return ''
  // Already has timezone info — return as-is
  if (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)) return value
  // Append seconds + Z for Zod .datetime() validation
  return value.includes(':') && value.split(':').length === 2
    ? `${value}:00.000Z`
    : `${value}.000Z`
}

function parseEventFormData(formData: FormData) {
  const priceInPounds = parseFloat(formData.get('price') as string) || 0
  const priceInPence = Math.round(priceInPounds * 100)

  const capacityRaw = formData.get('capacity') as string
  const capacity = capacityRaw && capacityRaw.trim() !== ''
    ? parseInt(capacityRaw, 10)
    : null

  return {
    title: (formData.get('title') as string) ?? '',
    description: (formData.get('description') as string) ?? '',
    short_description: (formData.get('short_description') as string) ?? '',
    date_time: normaliseDatetime((formData.get('date_time') as string) ?? ''),
    end_time: normaliseDatetime((formData.get('end_time') as string) ?? ''),
    venue_name: (formData.get('venue_name') as string) ?? '',
    venue_address: (formData.get('venue_address') as string) ?? '',
    category: (formData.get('category') as string) ?? '',
    price: priceInPence,
    capacity,
    image_url: (formData.get('image_url') as string) || null,
    dress_code: (formData.get('dress_code') as string) || null,
    is_published: formData.get('is_published') === 'true',
  }
}

// ── Dashboard Aggregations ───────────────────────────────────────────────────

export async function getDashboardStats() {
  const { supabase } = await requireAdmin()

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

  const [membersRes, eventsRes, revenueRes, ratingRes] = await Promise.all([
    // Total active members
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null),

    // Upcoming published events
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('is_published', true)
      .is('deleted_at', null)
      .gt('date_time', now.toISOString()),

    // Revenue this month: sum price_at_booking for confirmed bookings
    // where the event date_time falls in the current month
    supabase
      .from('bookings')
      .select('price_at_booking, event:events!inner(date_time)')
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .gte('events.date_time', startOfMonth)
      .lte('events.date_time', endOfMonth),

    // Average rating across all visible reviews
    supabase
      .from('event_reviews')
      .select('rating')
      .eq('is_visible', true),
  ])

  const totalMembers = membersRes.count ?? 0
  const upcomingEvents = eventsRes.count ?? 0

  const revenueThisMonth = (revenueRes.data ?? []).reduce(
    (sum, b) => sum + (b.price_at_booking ?? 0), 0
  )

  const ratings = ratingRes.data ?? []
  const averageRating = ratings.length > 0
    ? parseFloat((ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(2))
    : 0

  return { totalMembers, upcomingEvents, revenueThisMonth, averageRating }
}

export async function getMonthlyBookings() {
  const { supabase } = await requireAdmin()

  // Get bookings from last 12 months
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

  const { data: bookings } = await supabase
    .from('bookings')
    .select('created_at')
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .gte('created_at', twelveMonthsAgo.toISOString())
    .order('created_at', { ascending: true })

  // Group by month
  const monthCounts = new Map<string, number>()

  // Pre-fill last 12 months with zeros
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const key = d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short' })
    monthCounts.set(key, 0)
  }

  for (const b of bookings ?? []) {
    const d = new Date(b.created_at)
    const key = d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short' })
    monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1)
  }

  return Array.from(monthCounts.entries()).map(([month, count]) => ({ month, count }))
}

export async function getRecentActivity() {
  const { supabase } = await requireAdmin()

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, status, created_at,
      profile:profiles!bookings_user_id_fkey(full_name),
      event:events!bookings_event_id_fkey(title)
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) throw new Error('Failed to fetch recent activity')

  return (data ?? []).map((b) => ({
    id: b.id,
    status: b.status,
    created_at: b.created_at,
    user_name: extractField<{ full_name: string }>(b.profile, 'full_name') ?? 'Unknown',
    event_title: extractField<{ title: string }>(b.event, 'title') ?? 'Unknown',
  }))
}

// ── Event CRUD ───────────────────────────────────────────────────────────────

export async function createEvent(formData: FormData) {
  const { supabase } = await requireAdmin()

  const raw = parseEventFormData(formData)
  const parsed = eventFormSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Validation failed' }
  }

  const data = parsed.data

  // Generate unique slug
  const slug = await uniqueSlug(data.title, async (s) => {
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('slug', s)
      .maybeSingle()
    return !!existing
  })

  const { data: event, error } = await supabase
    .from('events')
    .insert({
      slug,
      title: data.title,
      description: data.description,
      short_description: data.short_description,
      date_time: data.date_time,
      end_time: data.end_time,
      venue_name: data.venue_name,
      venue_address: data.venue_address,
      category: data.category as EventCategory,
      price: data.price,
      capacity: data.capacity,
      image_url: data.image_url,
      dress_code: data.dress_code,
      is_published: data.is_published,
    })
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/admin/events')
  revalidatePath('/events')

  return { event }
}

export async function updateEvent(eventId: string, formData: FormData) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  const raw = parseEventFormData(formData)
  const parsed = eventFormSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Validation failed' }
  }

  const data = parsed.data

  // Get current slug to check if title changed
  const { data: currentEvent } = await supabase
    .from('events')
    .select('slug, title')
    .eq('id', eventId)
    .single()

  if (!currentEvent) return { error: 'Event not found' }

  // Re-generate slug only if title changed
  let slug = currentEvent.slug
  if (data.title !== currentEvent.title) {
    slug = await uniqueSlug(data.title, async (s) => {
      const { data: existing } = await supabase
        .from('events')
        .select('id')
        .eq('slug', s)
        .neq('id', eventId)
        .maybeSingle()
      return !!existing
    })
  }

  const { data: event, error } = await supabase
    .from('events')
    .update({
      slug,
      title: data.title,
      description: data.description,
      short_description: data.short_description,
      date_time: data.date_time,
      end_time: data.end_time,
      venue_name: data.venue_name,
      venue_address: data.venue_address,
      category: data.category as EventCategory,
      price: data.price,
      capacity: data.capacity,
      image_url: data.image_url,
      dress_code: data.dress_code,
      is_published: data.is_published,
    })
    .eq('id', eventId)
    .select()
    .single()

  if (error) return { error: error.message }

  revalidatePath('/admin/events')
  revalidatePath('/events')
  revalidatePath(`/events/${slug}`)

  return { event }
}

export async function softDeleteEvent(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  // Check for confirmed bookings
  const { count } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)

  if (count && count > 0) {
    return {
      error: `Cannot delete: ${count} confirmed booking${count > 1 ? 's' : ''} exist. Cancel the event instead.`,
    }
  }

  const { error } = await supabase
    .from('events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', eventId)

  if (error) return { error: error.message }

  revalidatePath('/admin/events')
  revalidatePath('/events')

  return { success: true }
}

export async function toggleEventPublished(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  const { data: current } = await supabase
    .from('events')
    .select('is_published, slug')
    .eq('id', eventId)
    .single()

  if (!current) return { error: 'Event not found' }

  const { error } = await supabase
    .from('events')
    .update({ is_published: !current.is_published })
    .eq('id', eventId)

  if (error) return { error: error.message }

  revalidatePath('/admin/events')
  revalidatePath('/events')
  revalidatePath(`/events/${current.slug}`)

  return { success: true, is_published: !current.is_published }
}

export async function cancelEvent(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  const { data: current } = await supabase
    .from('events')
    .select('slug')
    .eq('id', eventId)
    .single()

  if (!current) return { error: 'Event not found' }

  const { error } = await supabase
    .from('events')
    .update({ is_cancelled: true })
    .eq('id', eventId)

  if (error) return { error: error.message }

  revalidatePath('/admin/events')
  revalidatePath('/events')
  revalidatePath(`/events/${current.slug}`)

  return { success: true }
}

// ── Event CRUD Helpers ───────────────────────────────────────────────────────

export async function getAdminEvents() {
  const { supabase } = await requireAdmin()

  // Admin sees all events including drafts/cancelled via event_with_stats view
  // RLS allows admin to see all events (including unpublished)
  const { data, error } = await supabase
    .from('event_with_stats')
    .select('*')
    .order('date_time', { ascending: false })

  if (error) throw new Error('Failed to fetch events')

  return (data ?? []) as EventWithStats[]
}

export async function getAdminEventById(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) throw new Error('Event ID is required')

  const [eventRes, inclusionsRes, hostsRes] = await Promise.all([
    supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single(),

    supabase
      .from('event_inclusions')
      .select('id, label, icon, sort_order')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true }),

    supabase
      .from('event_hosts')
      .select(`
        id, role_label, sort_order,
        profile:profiles!event_hosts_profile_id_fkey(id, full_name, avatar_url, bio, job_title, company)
      `)
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true }),
  ])

  if (eventRes.error || !eventRes.data) throw new Error('Event not found')

  return {
    ...eventRes.data,
    inclusions: inclusionsRes.data ?? [],
    hosts: hostsRes.data ?? [],
  }
}

export async function upsertEventInclusions(
  eventId: string,
  inclusions: { label: string; icon?: string }[]
) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  // Delete existing inclusions for this event
  const { error: deleteError } = await supabase
    .from('event_inclusions')
    .delete()
    .eq('event_id', eventId)

  if (deleteError) return { error: deleteError.message }

  // Insert new ones
  if (inclusions.length > 0) {
    const rows = inclusions.map((inc, i) => ({
      event_id: eventId,
      label: inc.label,
      icon: inc.icon ?? null,
      sort_order: i,
    }))

    const { error: insertError } = await supabase
      .from('event_inclusions')
      .insert(rows)

    if (insertError) return { error: insertError.message }
  }

  revalidatePath('/admin/events')

  return { success: true }
}

export async function upsertEventHosts(eventId: string, hostIds: string[]) {
  const { supabase } = await requireAdmin()

  if (!eventId) return { error: 'Event ID is required' }

  // Delete existing hosts for this event
  const { error: deleteError } = await supabase
    .from('event_hosts')
    .delete()
    .eq('event_id', eventId)

  if (deleteError) return { error: deleteError.message }

  // Insert new ones
  if (hostIds.length > 0) {
    const rows = hostIds.map((profileId, i) => ({
      event_id: eventId,
      profile_id: profileId,
      role_label: 'Host',
      sort_order: i,
    }))

    const { error: insertError } = await supabase
      .from('event_hosts')
      .insert(rows)

    if (insertError) return { error: insertError.message }
  }

  revalidatePath('/admin/events')

  return { success: true }
}

// ── Booking / Waitlist Management ────────────────────────────────────────────

export async function getEventBookings(
  eventId: string,
  statusFilter?: string
) {
  const { supabase } = await requireAdmin()

  if (!eventId) throw new Error('Event ID is required')

  let query = supabase
    .from('bookings')
    .select(`
      id, status, waitlist_position, price_at_booking, booked_at, created_at,
      profile:profiles!bookings_user_id_fkey(id, full_name, email, avatar_url)
    `)
    .eq('event_id', eventId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query

  if (error) throw new Error('Failed to fetch bookings')

  return data ?? []
}

export async function promoteFromWaitlist(bookingId: string) {
  const { supabase } = await requireAdmin()

  if (!bookingId) return { error: 'Booking ID is required' }

  // 1. Fetch the booking — must be waitlisted and active
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, event_id, user_id, status')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (bookingError || !booking) return { error: 'Booking not found' }
  if (booking.status !== 'waitlisted') return { error: 'Booking is not waitlisted' }

  // 2. Fetch the event and check capacity
  const { data: event } = await supabase
    .from('events')
    .select('id, slug, capacity')
    .eq('id', booking.event_id)
    .single()

  if (!event) return { error: 'Event not found' }

  // Count current confirmed bookings
  const { count: confirmedCount } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', booking.event_id)
    .eq('status', 'confirmed')
    .is('deleted_at', null)

  if (event.capacity !== null && (confirmedCount ?? 0) >= event.capacity) {
    return { error: 'Event is at full capacity — cannot promote' }
  }

  // 3. Update booking to confirmed
  const { error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'confirmed', waitlist_position: null })
    .eq('id', bookingId)

  if (updateError) return { error: updateError.message }

  // 4. Recompute waitlist positions
  await supabase.rpc('recompute_waitlist_positions', {
    p_event_id: booking.event_id,
  })

  // 5. Get promoted user's name for the success message
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', booking.user_id)
    .single()

  revalidatePath('/admin/events')
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return {
    success: true,
    promotedName: profile?.full_name ?? 'Member',
  }
}

export async function exportEventAttendeesCSV(eventId: string) {
  const { supabase } = await requireAdmin()

  if (!eventId) throw new Error('Event ID is required')

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      booked_at,
      profile:profiles!bookings_user_id_fkey(full_name, email)
    `)
    .eq('event_id', eventId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .order('booked_at', { ascending: true })

  if (error) throw new Error('Failed to fetch attendees')

  const rows = (data ?? []).map((b) => {
    const profile = extractJoin<{ full_name: string; email: string }>(b.profile)
    return {
      name: profile?.full_name ?? '',
      email: profile?.email ?? '',
      booked_at: b.booked_at,
    }
  })

  const header = 'Name,Email,Booked At'
  const csvRows = rows.map(
    (r) => `"${r.name}","${r.email}","${r.booked_at}"`
  )

  return [header, ...csvRows].join('\n')
}

// ── Member Management ────────────────────────────────────────────────────────

export async function getAdminMembers(search?: string, sort?: string) {
  const { supabase } = await requireAdmin()

  // Get profiles with booking counts
  // We'll fetch profiles then compute booking stats
  let query = supabase
    .from('profiles')
    .select('*')
    .is('deleted_at', null)

  if (search && search.trim()) {
    const term = `%${search.trim()}%`
    query = query.or(`full_name.ilike.${term},email.ilike.${term}`)
  }

  switch (sort) {
    case 'alphabetical':
      query = query.order('full_name', { ascending: true })
      break
    case 'most_active':
      // Sort by created_at desc as a proxy; we'll re-sort after getting booking counts
      query = query.order('created_at', { ascending: false })
      break
    case 'newest':
    default:
      query = query.order('created_at', { ascending: false })
      break
  }

  const { data: profiles, error } = await query

  if (error) throw new Error('Failed to fetch members')

  if (!profiles || profiles.length === 0) return [] as MemberWithStats[]

  // Fetch booking counts for all members in one query
  const profileIds = profiles.map((p) => p.id)

  const { data: bookings } = await supabase
    .from('bookings')
    .select('user_id, status')
    .in('user_id', profileIds)
    .is('deleted_at', null)

  // Aggregate booking stats per user
  const statsMap = new Map<string, { attended: number; confirmed: number; waitlisted: number }>()

  for (const b of bookings ?? []) {
    const stats = statsMap.get(b.user_id) ?? { attended: 0, confirmed: 0, waitlisted: 0 }
    if (b.status === 'confirmed') {
      stats.confirmed++
      stats.attended++ // confirmed = attended for our purposes
    } else if (b.status === 'waitlisted') {
      stats.waitlisted++
    }
    statsMap.set(b.user_id, stats)
  }

  const result: MemberWithStats[] = profiles.map((p) => {
    const stats = statsMap.get(p.id) ?? { attended: 0, confirmed: 0, waitlisted: 0 }
    return {
      ...p,
      events_attended: stats.attended,
      events_confirmed: stats.confirmed,
      events_waitlisted: stats.waitlisted,
    } as MemberWithStats
  })

  // Re-sort by most_active if needed (by events_attended desc)
  if (sort === 'most_active') {
    result.sort((a, b) => b.events_attended - a.events_attended)
  }

  return result
}

export async function exportMembersCSV(search?: string) {
  const { supabase } = await requireAdmin()

  let query = supabase
    .from('profiles')
    .select('full_name, email, job_title, company, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (search && search.trim()) {
    const term = `%${search.trim()}%`
    query = query.or(`full_name.ilike.${term},email.ilike.${term}`)
  }

  const { data, error } = await query

  if (error) throw new Error('Failed to fetch members')

  const header = 'Name,Email,Job Title,Company,Joined'
  const csvRows = (data ?? []).map(
    (m) =>
      `"${m.full_name ?? ''}","${m.email ?? ''}","${m.job_title ?? ''}","${m.company ?? ''}","${m.created_at}"`
  )

  return [header, ...csvRows].join('\n')
}

// ── Review Moderation ────────────────────────────────────────────────────────

export async function getAdminReviews(filter?: 'all' | 'visible' | 'hidden') {
  const { supabase } = await requireAdmin()

  let query = supabase
    .from('event_reviews')
    .select(`
      id, rating, review_text, is_visible, created_at,
      author:profiles!event_reviews_user_id_fkey(id, full_name, avatar_url, email),
      event:events!event_reviews_event_id_fkey(id, slug, title)
    `)
    .order('created_at', { ascending: false })

  if (filter === 'visible') {
    query = query.eq('is_visible', true)
  } else if (filter === 'hidden') {
    query = query.eq('is_visible', false)
  }

  const { data, error } = await query

  if (error) throw new Error('Failed to fetch reviews')

  return data ?? []
}

export async function toggleReviewVisibility(reviewId: string) {
  const { supabase } = await requireAdmin()

  if (!reviewId) return { error: 'Review ID is required' }

  // Get current state + event slug for revalidation
  const { data: review } = await supabase
    .from('event_reviews')
    .select('is_visible, event:events!event_reviews_event_id_fkey(slug)')
    .eq('id', reviewId)
    .single()

  if (!review) return { error: 'Review not found' }

  const { error } = await supabase
    .from('event_reviews')
    .update({ is_visible: !review.is_visible })
    .eq('id', reviewId)

  if (error) return { error: error.message }

  const eventSlug = extractJoin<{ slug: string }>(review.event)?.slug
  revalidatePath('/admin/reviews')
  if (eventSlug) revalidatePath(`/events/${eventSlug}`)

  return { success: true, is_visible: !review.is_visible }
}

// ── Notifications (Mocked) ──────────────────────────────────────────────────

export async function sendNotification(formData: FormData) {
  const { supabase, userId } = await requireAdmin()

  const raw = {
    subject: (formData.get('subject') as string) ?? '',
    body: (formData.get('body') as string) ?? '',
    recipient_type: (formData.get('recipient_type') as string) ?? 'all',
    type: (formData.get('type') as string) ?? 'announcement',
    recipient_event_id: (formData.get('recipient_event_id') as string) || null,
  }

  const parsed = notificationSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Validation failed' }
  }

  const data = parsed.data

  const { error } = await supabase
    .from('notifications')
    .insert({
      sent_by: userId,
      recipient_type: data.recipient_type as NotificationRecipient,
      recipient_event_id: data.recipient_event_id ?? null,
      type: data.type as NotificationType,
      subject: data.subject,
      body: data.body,
    })

  if (error) return { error: error.message }

  // Mock email log
  console.log(`[MOCK EMAIL] To: ${data.recipient_type}, Subject: ${data.subject}`)

  revalidatePath('/admin/notifications')

  return { success: true }
}

export async function getNotificationHistory() {
  const { supabase } = await requireAdmin()

  const { data, error } = await supabase
    .from('notifications')
    .select(`
      id, subject, body, type, recipient_type, recipient_event_id, sent_at,
      sender:profiles!notifications_sent_by_fkey(id, full_name, avatar_url)
    `)
    .order('sent_at', { ascending: false })

  if (error) throw new Error('Failed to fetch notifications')

  return data ?? []
}
