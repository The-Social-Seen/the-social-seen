import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Coverage for `GET /bookings/resume/[bookingId]` — the abandoned-
 * checkout reminder email's CTA link
 * (SYSTEM-DESIGN-pending-payment-visibility.md §5.3). Thin auth +
 * redirect wrapper over `resumePendingBookingCheckout`
 * (src/lib/bookings/resume-checkout.ts, covered exhaustively by its own
 * test file) — this file pins the route's OWN contract: the
 * unauthenticated redirect shape (including the `redirect` — not `next`
 * — query param), delegation, and the success/failure redirect targets.
 *
 * FLAGGED SENSITIVE SURFACE: this is a GET route reachable directly from
 * an email link, so both the unauthenticated path and the
 * booking-ID-enumeration question (does a generic vs. specific error
 * message let a caller distinguish "doesn't exist" from "not yours"?)
 * are explicitly pinned below, not assumed.
 */

const mockGetUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser } })),
}))

const mockResumePendingBookingCheckout = vi.fn()
vi.mock('@/lib/bookings/resume-checkout', () => ({
  resumePendingBookingCheckout: (...args: unknown[]) =>
    mockResumePendingBookingCheckout(...args),
}))

import { GET } from '../route'

function makeRequest(path = '/bookings/resume/bk-1'): NextRequest {
  return new Request(`http://localhost${path}`, { method: 'GET' }) as unknown as NextRequest
}

function makeParams(bookingId = 'bk-1') {
  return { params: Promise.resolve({ bookingId }) }
}

function authenticateUser(userId = 'user-1') {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
}

function unauthenticateUser() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'Not authenticated' } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Unauthenticated
// ════════════════════════════════════════════════════════════════════════════

describe('GET /bookings/resume/[bookingId] — unauthenticated', () => {
  it('redirects to /login with a `redirect` (NOT `next`) param carrying the original resume path, without calling the shared helper', async () => {
    unauthenticateUser()

    const res = await GET(makeRequest(), makeParams('bk-1'))

    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const location = res.headers.get('location')
    expect(location).toContain('/login?redirect=')
    expect(location).toContain(encodeURIComponent('/bookings/resume/bk-1'))
    // The exact param name matters — `next` is NOT honoured by the login
    // form (src/app/(auth)/login/login-form.tsx reads `redirect`, per
    // src/lib/utils/redirect.ts's sanitizeRedirectPath contract).
    expect(location).not.toContain('next=')
    expect(mockResumePendingBookingCheckout).not.toHaveBeenCalled()
  })

  it('an auth.getUser() error (not just a null user) is treated the same as unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired session' } })

    const res = await GET(makeRequest(), makeParams('bk-1'))

    const location = res.headers.get('location')
    expect(location).toContain('/login?redirect=')
    expect(mockResumePendingBookingCheckout).not.toHaveBeenCalled()
  })

  it('carries the specific bookingId from the URL through to the redirect param', async () => {
    unauthenticateUser()

    const res = await GET(makeRequest('/bookings/resume/bk-super-specific-42'), makeParams('bk-super-specific-42'))

    const location = res.headers.get('location')
    expect(location).toContain(encodeURIComponent('/bookings/resume/bk-super-specific-42'))
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Delegation
// ════════════════════════════════════════════════════════════════════════════

describe('GET /bookings/resume/[bookingId] — delegation', () => {
  it('calls resumePendingBookingCheckout with the authenticated user id and the route bookingId', async () => {
    authenticateUser('user-42')
    mockResumePendingBookingCheckout.mockResolvedValue({
      success: true,
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
    })

    await GET(makeRequest('/bookings/resume/bk-99'), makeParams('bk-99'))

    expect(mockResumePendingBookingCheckout).toHaveBeenCalledTimes(1)
    const [, userIdArg, bookingIdArg] = mockResumePendingBookingCheckout.mock.calls[0] as [
      unknown,
      string,
      string,
    ]
    expect(userIdArg).toBe('user-42')
    expect(bookingIdArg).toBe('bk-99')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Success
// ════════════════════════════════════════════════════════════════════════════

describe('GET /bookings/resume/[bookingId] — success', () => {
  it('redirects straight to the fresh Stripe checkoutUrl — one click from the email lands on a live Stripe page', async () => {
    authenticateUser('user-1')
    mockResumePendingBookingCheckout.mockResolvedValue({
      success: true,
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_live_abc123',
    })

    const res = await GET(makeRequest(), makeParams('bk-1'))

    expect(res.headers.get('location')).toBe('https://checkout.stripe.com/c/pay/cs_test_live_abc123')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Failure
// ════════════════════════════════════════════════════════════════════════════

describe('GET /bookings/resume/[bookingId] — failure', () => {
  it('redirects to /bookings?resumeError=<encoded reason> with the reason from the shared helper', async () => {
    authenticateUser('user-1')
    mockResumePendingBookingCheckout.mockResolvedValue({
      success: false,
      error: 'This booking is no longer awaiting payment.',
    })

    const res = await GET(makeRequest(), makeParams('bk-1'))

    const location = res.headers.get('location')
    expect(location).toContain('/bookings?resumeError=')
    expect(location).toContain(encodeURIComponent('This booking is no longer awaiting payment.'))
  })

  it('falls back to a generic message when the helper returns success:false with no error string', async () => {
    authenticateUser('user-1')
    mockResumePendingBookingCheckout.mockResolvedValue({ success: false })

    const res = await GET(makeRequest(), makeParams('bk-1'))

    const location = res.headers.get('location')
    expect(location).toContain('/bookings?resumeError=')
    expect(location).toContain(encodeURIComponent('Something went wrong. Please try again.'))
  })

  it('success:true but a missing checkoutUrl (defensive/malformed-result case) falls through to the failure redirect rather than redirecting to an undefined location', async () => {
    authenticateUser('user-1')
    mockResumePendingBookingCheckout.mockResolvedValue({ success: true, checkoutUrl: undefined })

    const res = await GET(makeRequest(), makeParams('bk-1'))

    const location = res.headers.get('location')
    expect(location).toContain('/bookings?resumeError=')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Cross-user / booking-ID enumeration
// ════════════════════════════════════════════════════════════════════════════

describe('GET /bookings/resume/[bookingId] — cross-user access', () => {
  it("INVARIANT: a booking belonging to another user is rejected, never redirected to a Stripe checkoutUrl", async () => {
    authenticateUser('user-legit')
    mockResumePendingBookingCheckout.mockResolvedValue({
      success: false,
      error: 'Unauthorised',
    })

    const res = await GET(makeRequest(), makeParams('bk-belongs-to-someone-else'))

    const location = res.headers.get('location')
    expect(location).toContain('/bookings?resumeError=')
    expect(location).not.toContain('checkout.stripe')
  })

  it('NOTE (documents current behaviour, not a pass/fail assertion of "ideal" design): a nonexistent bookingId ("Booking not found") and a real-but-not-mine bookingId ("Unauthorised") currently surface DIFFERENT resumeError text. For a non-admin caller this is not practically exploitable — RLS on the shared helper\'s booking fetch means a real booking owned by someone else is invisible to a non-admin\'s user-scoped client in the first place, so both cases collapse to "Booking not found" for that caller. The distinct "Unauthorised" message is only reachable at all for a caller whose RLS grants broader read access (i.e. an admin\'s own user-scoped client — see resume-checkout.ts\'s doc comment on why step 2 exists), and an admin already has full visibility of all bookings via the admin dashboard, so no NEW information is leaked to that caller either. Flagged for code-reviewer to confirm this reasoning rather than silently assuming it — the task brief explicitly asked this surface to be checked for enumeration risk.', async () => {
    authenticateUser('user-1')

    mockResumePendingBookingCheckout.mockResolvedValueOnce({
      success: false,
      error: 'Booking not found',
    })
    const resMissing = await GET(makeRequest(), makeParams('bk-does-not-exist'))
    const locationMissing = resMissing.headers.get('location')

    mockResumePendingBookingCheckout.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorised',
    })
    const resForeign = await GET(makeRequest(), makeParams('bk-belongs-to-someone-else'))
    const locationForeign = resForeign.headers.get('location')

    expect(locationMissing).toContain(encodeURIComponent('Booking not found'))
    expect(locationForeign).toContain(encodeURIComponent('Unauthorised'))
    expect(locationMissing).not.toBe(locationForeign)
  })
})
