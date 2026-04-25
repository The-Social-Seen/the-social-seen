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

// `after()` is a Next.js App Router primitive for post-response work.
// It requires a request scope at runtime — not available under Vitest —
// so mock to immediately invoke the callback so the fire-and-forget
// behaviour is still exercised by tests.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (fn: () => unknown | Promise<unknown>) => {
      // Invoke immediately so email/notification side-effects still fire
      // in tests. Swallow returned promise — callers use `after` for
      // fire-and-forget, test assertions awaiting mockSendEmail work
      // via Vitest's microtask draining.
      void Promise.resolve(fn())
    },
  }
})

// Mock the email send wrapper — createBooking fires a fire-and-forget
// confirmation email via static import. Intercept here so tests don't
// hit the real Resend API.
const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

import {
  createBooking,
  cancelBooking,
  claimWaitlistSpot,
  leaveWaitlist,
} from '../actions'

// ── Stripe refund mock (P2-7b) ─────────────────────────────────────────────
// cancelBooking calls stripe.refunds.create when cancellation is >48h out
// on a paid booking. Default to a successful refund id; tests override
// with mockRejectedValueOnce to simulate Stripe outages.
const mockStripeRefundCreate = vi.fn()
vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => ({
    refunds: { create: (...args: unknown[]) => mockStripeRefundCreate(...args) },
  }),
}))

// cancelBooking's "notify waitlisters of open spot" helper uses the admin
// client. Stub it with a minimal chainable thenable so the queries
// resolve to empty data (no waitlisters to email in these tests).
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    const chain: Record<string, unknown> = {}
    const methods = ['select', 'eq', 'is', 'single', 'maybeSingle', 'limit', 'order']
    for (const m of methods) {
      ;(chain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi
        .fn()
        .mockReturnValue(chain)
    }
    ;(chain as Record<string, unknown>).then = (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null })
    return { from: vi.fn(() => chain) }
  },
}))

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-host': 'localhost:6500', 'x-forwarded-proto': 'http' }),
}))

vi.mock('@/lib/stripe/checkout', () => ({
  ensureStripeCustomer: vi.fn().mockResolvedValue('cus_mock'),
  createBookingCheckoutSession: vi.fn().mockResolvedValue({
    sessionId: 'cs_mock',
    url: 'https://checkout.stripe.test/cs_mock',
  }),
}))

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

  // ── 48h refund policy (P2-7b) ───────────────────────────────────────────

  /**
   * Stub the 3-step Supabase chain: booking fetch → event fetch → update.
   * Each step gets its own `.then` response.
   */
  function stubCancelSequence(opts: {
    booking: Record<string, unknown>
    event: { date_time: string; slug: string; refund_window_hours?: number }
    updateResult?: { data: unknown; error: unknown }
  }) {
    // Default refund_window_hours to 48 (the standard policy) so tests
    // that don't care about per-event configuration get the legacy
    // behaviour. Tests covering "non-refundable" policy pass 0 explicitly.
    const eventWithDefaults = {
      refund_window_hours: 48,
      ...opts.event,
    }
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      const chain: Record<string, ReturnType<typeof vi.fn>> = {}
      const methods = ['select', 'update', 'eq', 'is', 'single', 'neq', 'order', 'limit']
      for (const m of methods) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }
      if (callCount === 1) {
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: opts.booking, error: null }),
        )
      } else if (callCount === 2) {
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: eventWithDefaults, error: null }),
        )
      } else {
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve(opts.updateResult ?? { data: { id: 'bk-1' }, error: null }),
        )
      }
      return chain
    })
  }

  it('issues a Stripe refund when paid booking cancelled >48h before event', async () => {
    authenticateUser('user-1')
    mockStripeRefundCreate.mockResolvedValueOnce({ id: 're_abc' })

    stubCancelSequence({
      booking: {
        id: 'bk-1',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 3500,
        stripe_payment_id: 'pi_xyz',
        refunded_amount_pence: 0,
      },
      event: {
        date_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        slug: 'wine',
      },
    })

    const result = await cancelBooking('bk-1')

    expect(result.success).toBe(true)
    expect(result.refundEligible).toBe(true)
    expect(result.refundedPence).toBe(3500)
    expect(mockStripeRefundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_xyz' }),
      // I2 fix: idempotency key ties the refund to the booking so a
      // double-click can't double-spend.
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^refund-booking-/),
      }),
    )
  })

  it('does NOT refund paid booking cancelled ≤48h before event', async () => {
    authenticateUser('user-1')
    stubCancelSequence({
      booking: {
        id: 'bk-1',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 3500,
        stripe_payment_id: 'pi_xyz',
        refunded_amount_pence: 0,
      },
      event: {
        date_time: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        slug: 'wine',
      },
    })

    const result = await cancelBooking('bk-1')
    expect(result.success).toBe(true)
    expect(result.refundEligible).toBe(false)
    expect(result.refundedPence).toBe(0)
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
  })

  it('does NOT refund paid booking when event is non-refundable (refund_window_hours = 0)', async () => {
    authenticateUser('user-1')
    stubCancelSequence({
      booking: {
        id: 'bk-1',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 3500,
        stripe_payment_id: 'pi_xyz',
        refunded_amount_pence: 0,
      },
      event: {
        // 7 days out — well beyond the default 48h window — but the
        // event is configured non-refundable, so no refund issues.
        date_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        slug: 'supper-club',
        refund_window_hours: 0,
      },
    })

    const result = await cancelBooking('bk-1')
    expect(result.success).toBe(true)
    expect(result.refundEligible).toBe(false)
    expect(result.refundedPence).toBe(0)
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
  })

  it('refunds paid booking when cancelled outside a custom 168h (7-day) window', async () => {
    authenticateUser('user-1')
    mockStripeRefundCreate.mockResolvedValueOnce({ id: 're_custom' })
    stubCancelSequence({
      booking: {
        id: 'bk-1',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 8500,
        stripe_payment_id: 'pi_custom',
        refunded_amount_pence: 0,
      },
      event: {
        // 10 days out, custom 7-day window → eligible.
        date_time: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        slug: 'long-lead-event',
        refund_window_hours: 168,
      },
    })

    const result = await cancelBooking('bk-1')
    expect(result.success).toBe(true)
    expect(result.refundEligible).toBe(true)
    expect(result.refundedPence).toBe(8500)
    expect(mockStripeRefundCreate).toHaveBeenCalled()
  })

  it('does NOT refund paid booking inside a custom 168h (7-day) window', async () => {
    authenticateUser('user-1')
    stubCancelSequence({
      booking: {
        id: 'bk-1',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 8500,
        stripe_payment_id: 'pi_custom',
        refunded_amount_pence: 0,
      },
      event: {
        // 5 days out with a 7-day window → ineligible.
        date_time: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        slug: 'long-lead-event',
        refund_window_hours: 168,
      },
    })

    const result = await cancelBooking('bk-1')
    expect(result.success).toBe(true)
    expect(result.refundEligible).toBe(false)
    expect(result.refundedPence).toBe(0)
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
  })

  it('does NOT refund free-event bookings (no stripe_payment_id)', async () => {
    authenticateUser('user-1')
    stubCancelSequence({
      booking: {
        id: 'bk-1',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 0,
        stripe_payment_id: null,
        refunded_amount_pence: 0,
      },
      event: {
        date_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        slug: 'run-club',
      },
    })

    const result = await cancelBooking('bk-1')
    expect(result.success).toBe(true)
    expect(result.refundEligible).toBe(false)
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
  })

  it('aborts cancellation when Stripe refund throws (user keeps their spot)', async () => {
    authenticateUser('user-1')
    mockStripeRefundCreate.mockRejectedValueOnce(new Error('Stripe is down'))
    stubCancelSequence({
      booking: {
        id: 'bk-1',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 3500,
        stripe_payment_id: 'pi_xyz',
        refunded_amount_pence: 0,
      },
      event: {
        date_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        slug: 'wine',
      },
    })

    const result = await cancelBooking('bk-1')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/refund/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// claimWaitlistSpot (P2-7b)
// ════════════════════════════════════════════════════════════════════════════

describe('claimWaitlistSpot', () => {
  it('rejects empty eventId', async () => {
    const result = await claimWaitlistSpot('')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Event ID is required')
  })

  it('rejects unauthenticated callers', async () => {
    unauthenticateUser()
    const result = await claimWaitlistSpot('evt-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Authentication required')
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('returns success and no checkoutUrl for a free-event claim', async () => {
    authenticateUser('user-1')
    mockRpc.mockResolvedValueOnce({
      data: { booking_id: 'bk-42', status: 'confirmed' },
      error: null,
    })

    const result = await claimWaitlistSpot('evt-1')

    expect(mockRpc).toHaveBeenCalledWith('claim_waitlist_spot', {
      p_user_id: 'user-1',
      p_event_id: 'evt-1',
    })
    expect(result.success).toBe(true)
    expect(result.status).toBe('confirmed')
    expect(result.checkoutUrl).toBeUndefined()
  })

  it('surfaces the RPC race-lost error verbatim', async () => {
    authenticateUser('user-1')
    mockRpc.mockResolvedValueOnce({
      data: {
        error: "Someone else just claimed this spot. You're still on the waitlist.",
      },
      error: null,
    })

    const result = await claimWaitlistSpot('evt-1')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/someone else/i)
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
