'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import type { BookingStatus } from '@/types'

// ── Result type ────────���─────────────────────────────��──────────────────────

interface ActionResult {
  success: boolean
  error?: string
  bookingId?: string
  status?: BookingStatus
  waitlistPosition?: number | null
}

// ── createBooking ───────────────────────────────────────────────────────────

/**
 * Create a booking via the book_event() RPC function.
 * Handles race-condition-safe booking with row locking.
 */
export async function createBooking(eventId: string): Promise<ActionResult> {
  if (!eventId) {
    return { success: false, error: 'Event ID is required' }
  }

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Call the race-condition-safe RPC function
  const { data, error } = await supabase.rpc('book_event', {
    p_user_id: user.id,
    p_event_id: eventId,
  })

  if (error) {
    console.error('[createBooking]', error.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  // book_event() returns jsonb — check for error key
  const result = data as Record<string, unknown>
  if (result.error) {
    return { success: false, error: result.error as string }
  }

  // Revalidate affected pages
  revalidatePath('/events')
  revalidatePath('/bookings')
  revalidatePath('/profile')

  return {
    success: true,
    bookingId: result.booking_id as string,
    status: result.status as BookingStatus,
    waitlistPosition: (result.waitlist_position as number | null) ?? null,
  }
}

// ── cancelBooking ────────────────���──────────────────────────────────────────

/**
 * Cancel a confirmed booking. Sets status to 'cancelled'.
 * Per architect spec: no auto-promote, no deleted_at.
 */
export async function cancelBooking(bookingId: string): Promise<ActionResult> {
  if (!bookingId) {
    return { success: false, error: 'Booking ID is required' }
  }

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Fetch booking to validate ownership and status
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, user_id, event_id, status')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !booking) {
    return { success: false, error: 'Booking not found' }
  }

  // Defence-in-depth: verify ownership (RLS also covers this)
  if (booking.user_id !== user.id) {
    return { success: false, error: 'Unauthorised' }
  }

  if (booking.status !== 'confirmed') {
    return { success: false, error: 'Only confirmed bookings can be cancelled' }
  }

  // Check event hasn't passed
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('date_time, slug')
    .eq('id', booking.event_id)
    .single()

  if (eventError || !event) {
    return { success: false, error: 'Event not found' }
  }

  if (new Date(event.date_time) < new Date()) {
    return { success: false, error: 'Cannot cancel a booking for a past event' }
  }

  // Optimistic lock: WHERE status = 'confirmed' guards against race condition
  const { data: updated, error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' as BookingStatus })
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .select('id')
    .single()

  if (updateError || !updated) {
    return { success: false, error: 'Booking was already cancelled or modified' }
  }

  revalidatePath('/events')
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')
  revalidatePath('/profile')

  return { success: true }
}

// ── leaveWaitlist ──────────���─────────────────────────────��──────────────────

/**
 * Leave the waitlist for an event. Sets status to 'cancelled' and
 * recomputes waitlist positions for remaining waitlisted bookings.
 */
export async function leaveWaitlist(bookingId: string): Promise<ActionResult> {
  if (!bookingId) {
    return { success: false, error: 'Booking ID is required' }
  }

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Fetch booking to validate ownership and status
  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('id, user_id, event_id, status')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !booking) {
    return { success: false, error: 'Booking not found' }
  }

  if (booking.user_id !== user.id) {
    return { success: false, error: 'Unauthorised' }
  }

  if (booking.status !== 'waitlisted') {
    return { success: false, error: 'Only waitlisted bookings can leave the waitlist' }
  }

  // Check event hasn't passed
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('date_time, slug')
    .eq('id', booking.event_id)
    .single()

  if (eventError || !event) {
    return { success: false, error: 'Event not found' }
  }

  if (new Date(event.date_time) < new Date()) {
    return { success: false, error: 'Cannot leave waitlist for a past event' }
  }

  // Cancel the waitlisted booking
  const { data: updated, error: updateError } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' as BookingStatus, waitlist_position: null })
    .eq('id', bookingId)
    .eq('status', 'waitlisted')
    .is('deleted_at', null)
    .select('id')
    .single()

  if (updateError || !updated) {
    return { success: false, error: 'Booking was already cancelled or modified' }
  }

  // Recompute waitlist positions: single bulk decrement for all positions
  // above the leaving user's former position
  await supabase.rpc('recompute_waitlist_positions', {
    p_event_id: booking.event_id,
  })

  revalidatePath('/events')
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')
  revalidatePath('/profile')

  return { success: true }
}
