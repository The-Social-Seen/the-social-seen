import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for the two Addendum Server Actions (SYSTEM-DESIGN-admin-
 * waitlist-promotion-payment.md, "Addendum (2026-07-13, same day)"):
 *
 *   - `sendPaymentLinkForConfirmedBooking` (Gap A, §A.6) — remediates a
 *     `confirmed`-but-unpaid booking on a paid event.
 *   - `demoteAdminHold` (Gap B, §B.5) — manually releases an active
 *     `pending_payment` hold back to `waitlisted`.
 *
 * Generic auth-guard coverage (unauthenticated / non-admin) for both
 * actions lives centrally in `actions.test.ts`'s `actionsRequiringAuth`
 * array, matching this directory's established split (see
 * `actions-promote-waitlist-paid.test.ts`'s own header comment) — this
 * file focuses on each action's OWN branching/wiring logic: does it
 * pre-validate status/stripe_payment_id/event.price correctly, does it
 * call the right `admin-hold.ts` helper with the right args, does it
 * propagate success/failure correctly, and does it revalidate the right
 * paths (including the nested `/admin/events/<id>/bookings` path both
 * actions correctly add — a pre-existing gap in `promoteFromWaitlist`
 * flagged, but not fixed, by the Addendum §A.6/§B.5 note).
 *
 * `createAdminPaymentRemediationHold` / `releaseAdminBookingHold`'s OWN
 * internals (RPC call, Stripe, the rollback) are covered directly in
 * src/lib/bookings/__tests__/admin-hold.test.ts — deliberately not
 * re-tested here.
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

const mockCreateAdminPaymentRemediationHold = vi.fn()
const mockReleaseAdminBookingHold = vi.fn()
vi.mock('@/lib/bookings/admin-hold', () => ({
  createAdminPaymentRemediationHold: (...args: unknown[]) =>
    mockCreateAdminPaymentRemediationHold(...args),
  releaseAdminBookingHold: (...args: unknown[]) => mockReleaseAdminBookingHold(...args),
}))

import { revalidatePath } from 'next/cache'
import { sendPaymentLinkForConfirmedBooking, demoteAdminHold } from '../actions'

// ── Helpers (mirrors actions-promote-waitlist-paid.test.ts) ────────────────

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
// sendPaymentLinkForConfirmedBooking
// ════════════════════════════════════════════════════════════════════════════

describe('sendPaymentLinkForConfirmedBooking — input validation', () => {
  it('returns an error for an empty bookingId without calling requireAdmin\'s downstream reads', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))

    const result = await sendPaymentLinkForConfirmedBooking('')

    expect(result).toEqual({ error: 'Booking ID is required' })
    expect(mockCreateAdminPaymentRemediationHold).not.toHaveBeenCalled()
  })
})

describe('sendPaymentLinkForConfirmedBooking — pre-validation (belt-and-braces before the RPC)', () => {
  it('returns "Booking not found" when the booking fetch errors', async () => {
    mockAdminWithSequence([{ data: null, error: { message: 'no row' } }])

    const result = await sendPaymentLinkForConfirmedBooking('bk-1')

    expect(result).toEqual({ error: 'Booking not found' })
    expect(mockCreateAdminPaymentRemediationHold).not.toHaveBeenCalled()
  })

  it.each(['waitlisted', 'pending_payment', 'cancelled', 'no_show'])(
    'rejects a booking with status=%s ("Only confirmed bookings can be sent a payment link")',
    async (status) => {
      mockAdminWithSequence([
        { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status, stripe_payment_id: null } },
      ])

      const result = await sendPaymentLinkForConfirmedBooking('bk-1')

      expect(result).toEqual({ error: 'Only confirmed bookings can be sent a payment link' })
      expect(mockCreateAdminPaymentRemediationHold).not.toHaveBeenCalled()
    },
  )

  it('INVARIANT: rejects a booking that already has a stripe_payment_id — belt-and-braces double-charge guard BEFORE ever calling the RPC', async () => {
    mockAdminWithSequence([
      {
        data: {
          id: 'bk-1',
          event_id: 'evt-1',
          user_id: 'u-1',
          status: 'confirmed',
          stripe_payment_id: 'pi_already_paid',
        },
      },
    ])

    const result = await sendPaymentLinkForConfirmedBooking('bk-1')

    expect(result).toEqual({ error: 'This booking has already been paid' })
    expect(mockCreateAdminPaymentRemediationHold).not.toHaveBeenCalled()
  })

  it('returns "Event not found" when the event fetch fails', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'confirmed', stripe_payment_id: null } },
      { data: null, error: { message: 'no row' } },
    ])

    const result = await sendPaymentLinkForConfirmedBooking('bk-1')

    expect(result).toEqual({ error: 'Event not found' })
    expect(mockCreateAdminPaymentRemediationHold).not.toHaveBeenCalled()
  })

  it('rejects a FREE event ("This is a free event — nothing to remediate")', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'confirmed', stripe_payment_id: null } },
      { data: { id: 'evt-1', slug: 'free-run-club', price: 0 } },
    ])

    const result = await sendPaymentLinkForConfirmedBooking('bk-1')

    expect(result).toEqual({ error: 'This is a free event — nothing to remediate' })
    expect(mockCreateAdminPaymentRemediationHold).not.toHaveBeenCalled()
  })
})

describe('sendPaymentLinkForConfirmedBooking — calls createAdminPaymentRemediationHold correctly', () => {
  it('calls createAdminPaymentRemediationHold(supabase, bookingId, { holdExpiresAt: null }) — hardcoded null per Addendum §A.3', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'confirmed', stripe_payment_id: null } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockCreateAdminPaymentRemediationHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    await sendPaymentLinkForConfirmedBooking('bk-1')

    expect(mockCreateAdminPaymentRemediationHold).toHaveBeenCalledWith(
      expect.anything(),
      'bk-1',
      { holdExpiresAt: null },
    )
  })
})

describe('sendPaymentLinkForConfirmedBooking — success response + revalidation', () => {
  it('returns {success:true, status:"pending_payment", memberName, holdExpiresAt}', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'confirmed', stripe_payment_id: null } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockCreateAdminPaymentRemediationHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    const result = await sendPaymentLinkForConfirmedBooking('bk-1')

    expect(result).toEqual({
      success: true,
      memberName: 'Amy Sangam',
      status: 'pending_payment',
      holdExpiresAt: null,
    })
  })

  it('falls back to "Member" as memberName when the profile fetch fails', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'confirmed', stripe_payment_id: null } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
      { data: null, error: { message: 'not found' } },
    ])
    mockCreateAdminPaymentRemediationHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    const result = await sendPaymentLinkForConfirmedBooking('bk-1')

    expect(result.memberName).toBe('Member')
  })

  it('INVARIANT: revalidates the NESTED /admin/events/<id>/bookings path (the actual page this button lives on) in addition to the 3 paths promoteFromWaitlist revalidates', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'confirmed', stripe_payment_id: null } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockCreateAdminPaymentRemediationHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    await sendPaymentLinkForConfirmedBooking('bk-1')

    expect(revalidatePath).toHaveBeenCalledWith('/admin/events')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/events/evt-1/bookings')
    expect(revalidatePath).toHaveBeenCalledWith('/events/wine-tasting')
    expect(revalidatePath).toHaveBeenCalledWith('/bookings')
  })
})

describe('sendPaymentLinkForConfirmedBooking — failure propagation', () => {
  it('propagates createAdminPaymentRemediationHold\'s error VERBATIM and does not fetch a profile or revalidate', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'confirmed', stripe_payment_id: null } },
      { data: { id: 'evt-1', slug: 'wine-tasting', price: 2000 } },
    ])
    mockCreateAdminPaymentRemediationHold.mockResolvedValue({
      success: false,
      error: 'Could not start checkout. Please try again.',
    })

    const result = await sendPaymentLinkForConfirmedBooking('bk-1')

    expect(result).toEqual({ error: 'Could not start checkout. Please try again.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// demoteAdminHold
// ════════════════════════════════════════════════════════════════════════════

describe('demoteAdminHold — input validation', () => {
  it('returns an error for an empty bookingId', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))

    const result = await demoteAdminHold('')

    expect(result).toEqual({ error: 'Booking ID is required' })
    expect(mockReleaseAdminBookingHold).not.toHaveBeenCalled()
  })
})

describe('demoteAdminHold — pre-fetch + RPC call', () => {
  it('returns "Booking not found" when the booking fetch errors, without calling releaseAdminBookingHold', async () => {
    mockAdminWithSequence([{ data: null, error: { message: 'no row' } }])

    const result = await demoteAdminHold('bk-1')

    expect(result).toEqual({ error: 'Booking not found' })
    expect(mockReleaseAdminBookingHold).not.toHaveBeenCalled()
  })

  it('calls releaseAdminBookingHold(supabase, bookingId)', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: { slug: 'wine-tasting' } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockReleaseAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'waitlisted',
      waitlistPosition: 2,
    })

    await demoteAdminHold('bk-1')

    expect(mockReleaseAdminBookingHold).toHaveBeenCalledWith(expect.anything(), 'bk-1')
  })
})

describe('demoteAdminHold — success response + revalidation', () => {
  it('returns {success:true, status:"waitlisted", memberName, waitlistPosition}', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: { slug: 'wine-tasting' } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockReleaseAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'waitlisted',
      waitlistPosition: 2,
    })

    const result = await demoteAdminHold('bk-1')

    expect(result).toEqual({
      success: true,
      memberName: 'Amy Sangam',
      status: 'waitlisted',
      waitlistPosition: 2,
    })
  })

  it('waitlistPosition null from the RPC layer is preserved as null (not coerced)', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: { slug: 'wine-tasting' } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockReleaseAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'waitlisted',
      waitlistPosition: null,
    })

    const result = await demoteAdminHold('bk-1')

    expect(result.waitlistPosition).toBeNull()
  })

  it('falls back to "Member" as memberName when the profile fetch fails', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: { slug: 'wine-tasting' } },
      { data: null, error: { message: 'not found' } },
    ])
    mockReleaseAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'waitlisted',
      waitlistPosition: 1,
    })

    const result = await demoteAdminHold('bk-1')

    expect(result.memberName).toBe('Member')
  })

  it('revalidates /admin/events, the nested /admin/events/<id>/bookings, /events/<slug>, and /bookings', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: { slug: 'wine-tasting' } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockReleaseAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'waitlisted',
      waitlistPosition: 1,
    })

    await demoteAdminHold('bk-1')

    expect(revalidatePath).toHaveBeenCalledWith('/admin/events')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/events/evt-1/bookings')
    expect(revalidatePath).toHaveBeenCalledWith('/events/wine-tasting')
    expect(revalidatePath).toHaveBeenCalledWith('/bookings')
  })

  it('when the event fetch has no slug (e.g. lookup failure), skips the /events/<slug> revalidation but still revalidates the other three', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } },
      { data: null, error: { message: 'not found' } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockReleaseAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'waitlisted',
      waitlistPosition: 1,
    })

    await demoteAdminHold('bk-1')

    expect(revalidatePath).toHaveBeenCalledWith('/admin/events')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/events/evt-1/bookings')
    expect(revalidatePath).toHaveBeenCalledWith('/bookings')
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringMatching(/^\/events\//))
  })
})

describe('demoteAdminHold — failure propagation', () => {
  it('propagates releaseAdminBookingHold\'s error VERBATIM (e.g. "not an active payment hold") and does not revalidate', async () => {
    mockAdminWithSequence([{ data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1' } }])
    mockReleaseAdminBookingHold.mockResolvedValue({
      success: false,
      error:
        'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.',
    })

    const result = await demoteAdminHold('bk-1')

    expect(result).toEqual({
      error:
        'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
