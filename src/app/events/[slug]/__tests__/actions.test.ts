import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: mockRpc,
    }),
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock the email send wrapper — createBooking fires a fire-and-forget
// confirmation email via static import. Intercept here so tests don't
// hit the real Resend API.
const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

import { createBooking, cancelBooking, leaveWaitlist } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateUser(userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function unauthenticateUser() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Not authenticated' },
  })
}

/**
 * Build a chainable mock that mirrors Supabase's PostgREST builder pattern.
 * Each chained method returns the same proxy, and await/then resolves to `response`.
 */
function mockSupabaseChain(response: { data?: unknown; error?: unknown; count?: number | null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'single', 'maybeSingle',
    'order', 'limit',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // When the chain is awaited, resolve to the response
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  mockFrom.mockReturnValue(chain)
  return chain
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// createBooking
// ════════════════════════════════════════════════════════════════════════════

describe('createBooking', () => {
  it('returns error when eventId is empty', async () => {
    const result = await createBooking('')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Event ID is required')
  })

  it('returns error when user is not authenticated', async () => {
    unauthenticateUser()
    const result = await createBooking('evt-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Authentication required')
  })

  it('returns booking details on successful confirmed booking', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-1', status: 'confirmed', waitlist_position: null },
      error: null,
    })

    const result = await createBooking('evt-1')

    expect(result.success).toBe(true)
    expect(result.bookingId).toBe('bk-1')
    expect(result.status).toBe('confirmed')
    expect(result.waitlistPosition).toBeNull()
    expect(mockRpc).toHaveBeenCalledWith('book_event', {
      p_user_id: 'user-1',
      p_event_id: 'evt-1',
    })
  })

  it('returns waitlist position when event is full', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-2', status: 'waitlisted', waitlist_position: 3 },
      error: null,
    })

    const result = await createBooking('evt-1')

    expect(result.success).toBe(true)
    expect(result.status).toBe('waitlisted')
    expect(result.waitlistPosition).toBe(3)
  })

  it('returns RPC-level error (event not found)', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: { error: 'Event not found' },
      error: null,
    })

    const result = await createBooking('evt-missing')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Event not found')
  })

  it('returns RPC-level error (already booked)', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: { error: 'Already booked for this event' },
      error: null,
    })

    const result = await createBooking('evt-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Already booked for this event')
  })

  it('returns generic error when RPC call fails', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Database connection error' },
    })

    const result = await createBooking('evt-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Something went wrong. Please try again.')
  })

  // ── Booking confirmation email integration ──────────────────────────────

  it('fires booking confirmation email after a confirmed booking', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-1', status: 'confirmed', waitlist_position: null },
      error: null,
    })
    // Profile + event lookups in sendBookingConfirmationEmail share the
    // same chain mock; return enough data for the template to render.
    mockSupabaseChain({
      data: {
        full_name: 'Charlotte Moreau',
        email: 'charlotte@example.com',
        title: 'Wine & Wisdom',
        slug: 'wine-and-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Quo Vadis',
        venue_address: '26-29 Dean St, London',
      },
      error: null,
    })
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg_1' })

    const result = await createBooking('evt-1')

    expect(result.success).toBe(true)
    // Fire-and-forget — give the microtask queue a chance to drain.
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'charlotte@example.com',
        templateName: 'booking_confirmation',
        relatedProfileId: 'user-1',
      }),
    )
  })

  it('fires booking confirmation email after a waitlisted booking', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-2', status: 'waitlisted', waitlist_position: 3 },
      error: null,
    })
    mockSupabaseChain({
      data: {
        full_name: 'Charlotte Moreau',
        email: 'charlotte@example.com',
        title: 'Wine & Wisdom',
        slug: 'wine-and-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Quo Vadis',
        venue_address: '26-29 Dean St, London',
      },
      error: null,
    })
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg_2' })

    await createBooking('evt-1')
    await new Promise((r) => setTimeout(r, 0))

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'booking_confirmation',
        // Status tag confirms the waitlisted variant of the template was used
        tags: expect.arrayContaining([
          { name: 'status', value: 'waitlisted' },
        ]),
      }),
    )
  })

  it('does NOT fire email when book_event returns an error', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: { error: 'Event not found' },
      error: null,
    })

    await createBooking('evt-missing')
    await new Promise((r) => setTimeout(r, 0))

    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('still returns success when the confirmation email fails', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-3', status: 'confirmed', waitlist_position: null },
      error: null,
    })
    mockSupabaseChain({
      data: {
        full_name: 'Charlotte Moreau',
        email: 'charlotte@example.com',
        title: 'Wine & Wisdom',
        slug: 'wine-and-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Quo Vadis',
        venue_address: '26-29 Dean St, London',
      },
      error: null,
    })
    mockSendEmail.mockResolvedValue({
      success: false,
      error: 'Resend down',
    })

    const result = await createBooking('evt-1')

    // Email failure must NOT roll back the booking — user gets a clean success.
    expect(result.success).toBe(true)
    expect(result.bookingId).toBe('bk-3')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// cancelBooking
// ════════════════════════════════════════════════════════════════════════════

describe('cancelBooking', () => {
  it('returns error when bookingId is empty', async () => {
    const result = await cancelBooking('')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Booking ID is required')
  })

  it('returns error when user is not authenticated', async () => {
    unauthenticateUser()
    const result = await cancelBooking('bk-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Authentication required')
  })

  it('cancels a confirmed booking successfully', async () => {
    authenticateUser('user-1')

    // First call: fetch booking
    // Second call: fetch event
    // Third call: update booking
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      const chain: Record<string, ReturnType<typeof vi.fn>> = {}
      const methods = ['select', 'update', 'eq', 'is', 'single', 'neq', 'order', 'limit']
      for (const m of methods) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }

      if (callCount === 1) {
        // Booking fetch
        chain.then = vi.fn((resolve: (v: unknown) => void) => resolve({
          data: { id: 'bk-1', user_id: 'user-1', event_id: 'evt-1', status: 'confirmed' },
          error: null,
        }))
      } else if (callCount === 2) {
        // Event fetch
        chain.then = vi.fn((resolve: (v: unknown) => void) => resolve({
          data: { date_time: '2027-12-01T19:00:00Z', slug: 'future-event' },
          error: null,
        }))
      } else {
        // Update booking
        chain.then = vi.fn((resolve: (v: unknown) => void) => resolve({
          data: { id: 'bk-1' },
          error: null,
        }))
      }

      return chain
    })

    const result = await cancelBooking('bk-1')

    expect(result.success).toBe(true)
  })

  it('returns error when booking belongs to another user', async () => {
    authenticateUser('user-2')

    mockSupabaseChain({
      data: { id: 'bk-1', user_id: 'user-1', event_id: 'evt-1', status: 'confirmed' },
      error: null,
    })

    const result = await cancelBooking('bk-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Unauthorised')
  })

  it('returns error when booking status is not confirmed', async () => {
    authenticateUser('user-1')

    mockSupabaseChain({
      data: { id: 'bk-1', user_id: 'user-1', event_id: 'evt-1', status: 'waitlisted' },
      error: null,
    })

    const result = await cancelBooking('bk-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Only confirmed bookings can be cancelled')
  })

  it('returns error when booking not found', async () => {
    authenticateUser()
    mockSupabaseChain({ data: null, error: { message: 'not found' } })

    const result = await cancelBooking('bk-missing')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Booking not found')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// leaveWaitlist
// ════════════════════════════════════════════════════════════════════════════

describe('leaveWaitlist', () => {
  it('returns error when bookingId is empty', async () => {
    const result = await leaveWaitlist('')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Booking ID is required')
  })

  it('returns error when user is not authenticated', async () => {
    unauthenticateUser()
    const result = await leaveWaitlist('bk-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Authentication required')
  })

  it('leaves waitlist successfully and calls recompute RPC', async () => {
    authenticateUser('user-1')

    // Mock the recompute_waitlist_positions RPC (W-1 fix: single bulk update)
    mockRpc.mockResolvedValue({ data: null, error: null })

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      const chain: Record<string, ReturnType<typeof vi.fn>> = {}
      const methods = ['select', 'update', 'eq', 'is', 'single', 'neq', 'order', 'limit']
      for (const m of methods) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }

      if (callCount === 1) {
        // Booking fetch
        chain.then = vi.fn((resolve: (v: unknown) => void) => resolve({
          data: { id: 'bk-1', user_id: 'user-1', event_id: 'evt-1', status: 'waitlisted' },
          error: null,
        }))
      } else if (callCount === 2) {
        // Event fetch
        chain.then = vi.fn((resolve: (v: unknown) => void) => resolve({
          data: { date_time: '2027-12-01T19:00:00Z', slug: 'future-event' },
          error: null,
        }))
      } else {
        // Update (cancel) booking
        chain.then = vi.fn((resolve: (v: unknown) => void) => resolve({
          data: { id: 'bk-1' },
          error: null,
        }))
      }

      return chain
    })

    const result = await leaveWaitlist('bk-1')

    expect(result.success).toBe(true)
    // Verify the bulk recompute RPC was called with correct event ID
    expect(mockRpc).toHaveBeenCalledWith('recompute_waitlist_positions', {
      p_event_id: 'evt-1',
    })
  })

  it('returns error when booking belongs to another user', async () => {
    authenticateUser('user-2')

    mockSupabaseChain({
      data: { id: 'bk-1', user_id: 'user-1', event_id: 'evt-1', status: 'waitlisted' },
      error: null,
    })

    const result = await leaveWaitlist('bk-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Unauthorised')
  })

  it('returns error when booking is not waitlisted', async () => {
    authenticateUser('user-1')

    mockSupabaseChain({
      data: { id: 'bk-1', user_id: 'user-1', event_id: 'evt-1', status: 'confirmed' },
      error: null,
    })

    const result = await leaveWaitlist('bk-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Only waitlisted bookings can leave the waitlist')
  })
})
