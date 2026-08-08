import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for the two "Gap C" Server Actions
 * (SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md):
 *
 *   - `reinstateCancelledBooking` (§4.7) — reinstates an eligible reaped
 *     `cancelled` booking on a paid event that has room again.
 *   - `releaseReinstatedHold` (§4.7) — manually releases an active
 *     reinstatement hold back to `cancelled`.
 *
 * Mirrors actions-payment-remediation.test.ts's own structure/mocking
 * pattern exactly (same file this feature's own precedent doc — "Addendum
 * §A.6/§B.5" — was built from). Generic auth-guard coverage
 * (unauthenticated / non-admin) for both actions lives centrally in
 * actions.test.ts's `actionsRequiringAuth` array, matching this
 * directory's established split — this file focuses on each action's OWN
 * branching/wiring logic: does it pre-validate status/event.price
 * correctly, does it call the right admin-hold.ts helper with the right
 * args, does it propagate success/failure correctly, and does it
 * revalidate the right paths.
 *
 * `createAdminReinstatementHold` / `releaseReinstatedBookingHold`'s OWN
 * internals (RPC call, Stripe, the price-source deviation, the rollback)
 * are covered directly in src/lib/bookings/__tests__/admin-hold.test.ts —
 * deliberately not re-tested here.
 */

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    }),
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

const mockCreateAdminReinstatementHold = vi.fn()
const mockReleaseReinstatedBookingHold = vi.fn()
vi.mock('@/lib/bookings/admin-hold', () => ({
  createAdminReinstatementHold: (...args: unknown[]) =>
    mockCreateAdminReinstatementHold(...args),
  releaseReinstatedBookingHold: (...args: unknown[]) => mockReleaseReinstatedBookingHold(...args),
}))

import { revalidatePath } from 'next/cache'
import { reinstateCancelledBooking, releaseReinstatedHold } from '../actions'

// ── Helpers (mirrors actions-payment-remediation.test.ts) ──────────────────

function authenticateAdmin(userId = 'admin-1') {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
}

function mockChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'is', 'single', 'maybeSingle']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

/** First from() call is always requireAdmin's profiles.role read. */
function mockAdminWithSequence(
  responses: Array<{ data?: unknown; error?: unknown }>,
  userId = 'admin-1',
) {
  authenticateAdmin(userId)
  let callCount = 0
  mockFrom.mockImplementation(() => {
    if (callCount === 0) {
      callCount++
      return mockChain({ data: { role: 'admin' } })
    }
    const idx = callCount - 1
    callCount++
    const response = responses[idx] ?? responses[responses.length - 1]
    return mockChain(response)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// reinstateCancelledBooking
// ════════════════════════════════════════════════════════════════════════════

describe('reinstateCancelledBooking — input validation', () => {
  it('returns an error for an empty bookingId without calling createAdminReinstatementHold', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))

    const result = await reinstateCancelledBooking('')

    expect(result).toEqual({ error: 'Booking ID is required' })
    expect(mockCreateAdminReinstatementHold).not.toHaveBeenCalled()
  })
})

describe('reinstateCancelledBooking — pre-validation (belt-and-braces before the RPC)', () => {
  it('returns "Booking not found" when the booking fetch errors', async () => {
    mockAdminWithSequence([{ data: null, error: { message: 'no row' } }])

    const result = await reinstateCancelledBooking('bk-1')

    expect(result).toEqual({ error: 'Booking not found' })
    expect(mockCreateAdminReinstatementHold).not.toHaveBeenCalled()
  })

  it.each(['confirmed', 'waitlisted', 'pending_payment', 'no_show'])(
    'rejects a booking with status=%s ("Only cancelled bookings can be reinstated")',
    async (status) => {
      mockAdminWithSequence([
        { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status } },
      ])

      const result = await reinstateCancelledBooking('bk-1')

      expect(result).toEqual({ error: 'Only cancelled bookings can be reinstated' })
      expect(mockCreateAdminReinstatementHold).not.toHaveBeenCalled()
    },
  )

  it('returns "Event not found" when the event fetch fails', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'cancelled' } },
      { data: null, error: { message: 'no row' } },
    ])

    const result = await reinstateCancelledBooking('bk-1')

    expect(result).toEqual({ error: 'Event not found' })
    expect(mockCreateAdminReinstatementHold).not.toHaveBeenCalled()
  })

  it('rejects a FREE event ("This is a free event — reinstate by booking directly, not via this tool")', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'cancelled' } },
      { data: { id: 'evt-1', slug: 'free-run-club', price: 0 } },
    ])

    const result = await reinstateCancelledBooking('bk-1')

    expect(result).toEqual({
      error: 'This is a free event — reinstate by booking directly, not via this tool',
    })
    expect(mockCreateAdminReinstatementHold).not.toHaveBeenCalled()
  })
})

describe('reinstateCancelledBooking — calls createAdminReinstatementHold correctly', () => {
  it('calls createAdminReinstatementHold(supabase, bookingId, { holdExpiresAt: null }) — hardcoded null per design doc §6', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'cancelled' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
      { data: { full_name: 'Amaya Kaur' } },
    ])
    mockCreateAdminReinstatementHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    await reinstateCancelledBooking('bk-1')

    expect(mockCreateAdminReinstatementHold).toHaveBeenCalledWith(
      expect.anything(),
      'bk-1',
      { holdExpiresAt: null },
    )
  })
})

describe('reinstateCancelledBooking — success response + revalidation', () => {
  it('returns {success:true, status:"pending_payment", memberName, holdExpiresAt}', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'cancelled' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
      { data: { full_name: 'Amaya Kaur' } },
    ])
    mockCreateAdminReinstatementHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    const result = await reinstateCancelledBooking('bk-1')

    expect(result).toEqual({
      success: true,
      memberName: 'Amaya Kaur',
      status: 'pending_payment',
      holdExpiresAt: null,
    })
  })

  it('falls back to "Member" as memberName when the profile fetch fails', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'cancelled' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
      { data: null, error: { message: 'not found' } },
    ])
    mockCreateAdminReinstatementHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    const result = await reinstateCancelledBooking('bk-1')

    expect(result.memberName).toBe('Member')
  })

  it('revalidates /admin/events, the nested /admin/events/<id>/bookings, /events/<slug>, and /bookings', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'cancelled' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
      { data: { full_name: 'Amaya Kaur' } },
    ])
    mockCreateAdminReinstatementHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    await reinstateCancelledBooking('bk-1')

    expect(revalidatePath).toHaveBeenCalledWith('/admin/events')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/events/evt-1/bookings')
    expect(revalidatePath).toHaveBeenCalledWith('/events/wine-tasting')
    expect(revalidatePath).toHaveBeenCalledWith('/bookings')
  })
})

describe('reinstateCancelledBooking — failure propagation', () => {
  it("propagates createAdminReinstatementHold's error VERBATIM (e.g. the deleted-profile / capacity rejections) and does not fetch a profile or revalidate", async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'cancelled' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
    ])
    mockCreateAdminReinstatementHold.mockResolvedValue({
      success: false,
      error: "This member's account has been deleted — cannot reinstate",
    })

    const result = await reinstateCancelledBooking('bk-1')

    expect(result).toEqual({ error: "This member's account has been deleted — cannot reinstate" })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('propagates a capacity-full rejection VERBATIM', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'cancelled' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
    ])
    mockCreateAdminReinstatementHold.mockResolvedValue({
      success: false,
      error: 'Event is at full capacity — cannot reinstate',
    })

    const result = await reinstateCancelledBooking('bk-1')

    expect(result).toEqual({ error: 'Event is at full capacity — cannot reinstate' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// releaseReinstatedHold
// ════════════════════════════════════════════════════════════════════════════

describe('releaseReinstatedHold — input validation', () => {
  it('returns an error for an empty bookingId', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))

    const result = await releaseReinstatedHold('')

    expect(result).toEqual({ error: 'Booking ID is required' })
    expect(mockReleaseReinstatedBookingHold).not.toHaveBeenCalled()
  })
})

describe('releaseReinstatedHold — pre-fetch + RPC call', () => {
  it('returns "Booking not found" when the booking fetch errors, without calling releaseReinstatedBookingHold', async () => {
    mockAdminWithSequence([{ data: null, error: { message: 'no row' } }])

    const result = await releaseReinstatedHold('bk-1')

    expect(result).toEqual({ error: 'Booking not found' })
    expect(mockReleaseReinstatedBookingHold).not.toHaveBeenCalled()
  })

  it('calls releaseReinstatedBookingHold(supabase, bookingId) — NOT releaseAdminBookingHold', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: { slug: 'wine-tasting' } },
      { data: { full_name: 'Amaya Kaur' } },
    ])
    mockReleaseReinstatedBookingHold.mockResolvedValue({ success: true, status: 'cancelled' })

    await releaseReinstatedHold('bk-1')

    expect(mockReleaseReinstatedBookingHold).toHaveBeenCalledWith(expect.anything(), 'bk-1')
  })
})

describe('releaseReinstatedHold — success response + revalidation', () => {
  it('returns {success:true, status:"cancelled", memberName} — no waitlistPosition field', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: { slug: 'wine-tasting' } },
      { data: { full_name: 'Amaya Kaur' } },
    ])
    mockReleaseReinstatedBookingHold.mockResolvedValue({ success: true, status: 'cancelled' })

    const result = await releaseReinstatedHold('bk-1')

    expect(result).toEqual({
      success: true,
      memberName: 'Amaya Kaur',
      status: 'cancelled',
    })
    expect(result).not.toHaveProperty('waitlistPosition')
  })

  it('falls back to "Member" as memberName when the profile fetch fails', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: { slug: 'wine-tasting' } },
      { data: null, error: { message: 'not found' } },
    ])
    mockReleaseReinstatedBookingHold.mockResolvedValue({ success: true, status: 'cancelled' })

    const result = await releaseReinstatedHold('bk-1')

    expect(result.memberName).toBe('Member')
  })

  it('revalidates /admin/events, the nested /admin/events/<id>/bookings, /events/<slug>, and /bookings', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: { slug: 'wine-tasting' } },
      { data: { full_name: 'Amaya Kaur' } },
    ])
    mockReleaseReinstatedBookingHold.mockResolvedValue({ success: true, status: 'cancelled' })

    await releaseReinstatedHold('bk-1')

    expect(revalidatePath).toHaveBeenCalledWith('/admin/events')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/events/evt-1/bookings')
    expect(revalidatePath).toHaveBeenCalledWith('/events/wine-tasting')
    expect(revalidatePath).toHaveBeenCalledWith('/bookings')
  })

  it('when the event fetch has no slug (e.g. lookup failure), skips the /events/<slug> revalidation but still revalidates the other three', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: null, error: { message: 'not found' } },
      { data: { full_name: 'Amaya Kaur' } },
    ])
    mockReleaseReinstatedBookingHold.mockResolvedValue({ success: true, status: 'cancelled' })

    await releaseReinstatedHold('bk-1')

    expect(revalidatePath).toHaveBeenCalledWith('/admin/events')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/events/evt-1/bookings')
    expect(revalidatePath).toHaveBeenCalledWith('/bookings')
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringMatching(/^\/events\//))
  })
})

describe('releaseReinstatedHold — failure propagation', () => {
  it("propagates releaseReinstatedBookingHold's error VERBATIM (e.g. \"not an active reinstatement hold\") and does not revalidate", async () => {
    mockAdminWithSequence([{ data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } }])
    mockReleaseReinstatedBookingHold.mockResolvedValue({
      success: false,
      error:
        'This booking is not an active reinstatement hold — it may have already been paid, cancelled, or released.',
    })

    const result = await releaseReinstatedHold('bk-1')

    expect(result).toEqual({
      error:
        'This booking is not an active reinstatement hold — it may have already been paid, cancelled, or released.',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
