import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { splitBookings } from '../bookings'
import type { BookingWithEvent } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBooking(
  overrides: Partial<BookingWithEvent> & { status: BookingWithEvent['status']; date_time: string }
): BookingWithEvent {
  return {
    id: overrides.id ?? 'bk-1',
    user_id: 'user-1',
    event_id: 'evt-1',
    status: overrides.status,
    waitlist_position: null,
    price_at_booking: 0,
    booked_at: '2026-01-01T12:00:00Z',
    created_at: '2026-01-01T12:00:00Z',
    updated_at: '2026-01-01T12:00:00Z',
    deleted_at: null,
    event: {
      id: 'evt-1',
      slug: 'test-event',
      title: 'Test Event',
      date_time: overrides.date_time,
      end_time: '',
      venue_name: 'Venue',
      short_description: 'A short description',
      venue_address: '1 London Rd',
      image_url: '',
      category: 'drinks',
      dress_code: null,
    },
  }
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.setSystemTime(new Date('2026-04-11T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('splitBookings', () => {
  it('T3-9: confirmed + future date_time → appears in upcoming only', () => {
    const booking = makeBooking({ status: 'confirmed', date_time: '2036-01-01T19:00:00Z' })
    const result = splitBookings([booking])

    expect(result.upcoming).toHaveLength(1)
    expect(result.past).toHaveLength(0)
    expect(result.waitlisted).toHaveLength(0)
  })

  it('T3-10: confirmed + past date_time → appears in past only', () => {
    const booking = makeBooking({ status: 'confirmed', date_time: '2016-01-01T19:00:00Z' })
    const result = splitBookings([booking])

    expect(result.past).toHaveLength(1)
    expect(result.upcoming).toHaveLength(0)
    expect(result.waitlisted).toHaveLength(0)
  })

  it('T3-11: no_show + past date_time → appears in past', () => {
    const booking = makeBooking({ status: 'no_show', date_time: '2016-01-01T19:00:00Z' })
    const result = splitBookings([booking])

    expect(result.past).toHaveLength(1)
    expect(result.upcoming).toHaveLength(0)
    expect(result.waitlisted).toHaveLength(0)
  })

  it('T3-12: waitlisted → appears in waitlisted only', () => {
    const booking = makeBooking({ status: 'waitlisted', date_time: '2036-01-01T19:00:00Z' })
    const result = splitBookings([booking])

    expect(result.waitlisted).toHaveLength(1)
    expect(result.upcoming).toHaveLength(0)
    expect(result.past).toHaveLength(0)
  })

  it('T3-13: cancelled → absent from all three lists', () => {
    const booking = makeBooking({ status: 'cancelled', date_time: '2036-01-01T19:00:00Z' })
    const result = splitBookings([booking])

    expect(result.upcoming).toHaveLength(0)
    expect(result.past).toHaveLength(0)
    expect(result.waitlisted).toHaveLength(0)
  })
})
