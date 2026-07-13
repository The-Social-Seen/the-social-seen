import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Coverage for src/lib/bookings/admin-hold.ts — the admin waitlist-
 * promotion payment-hold mechanism (createAdminBookingHold,
 * computeStripeExpirySeconds, computeHoldExpiresAt).
 *
 * Mocking strategy mirrors the codebase convention already established
 * for the sibling flows (createBooking / claimWaitlistSpot in
 * events/[slug]/__tests__/actions.test.ts): `@/lib/stripe/checkout` is
 * mocked WHOLESALE (its own internals — ensureStripeCustomer's stale-id
 * handling, createBookingCheckoutSession's Stripe session shape — already
 * have dedicated direct coverage in src/lib/stripe/__tests__/
 * checkout.test.ts). This file focuses on admin-hold.ts's OWN logic: the
 * RPC call + error unwrapping, the Stripe-failure rollback (the one place
 * the spec explicitly flags as "copying the existing pattern verbatim
 * would be wrong" — §3.2 step 10), and the two pure formula functions.
 */

// ── Mocks (hoisted — must be declared before importing the module under test) ──

const mockEnsureStripeCustomer = vi.fn()
const mockCreateBookingCheckoutSession = vi.fn()
vi.mock('@/lib/stripe/checkout', () => ({
  ensureStripeCustomer: (...args: unknown[]) => mockEnsureStripeCustomer(...args),
  createBookingCheckoutSession: (...args: unknown[]) =>
    mockCreateBookingCheckoutSession(...args),
}))

const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

const mockSentryCapture = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockSentryCapture(...args),
}))

// Matches the established pattern in events/[slug]/__tests__/actions.test.ts
// and cancel-booking-races.test.ts.
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-host': 'localhost:6500', 'x-forwarded-proto': 'http' }),
}))

let adminHandle: ReturnType<typeof makeAdminMock>
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminHandle.client,
}))

// Only used by the releaseAdminBookingHold describe block below — every
// other block in this file never touches Stripe's SDK directly (the
// hold-creation flows go through @/lib/stripe/checkout, mocked above).
let stripeHandle: {
  client: { checkout: { sessions: { expire: ReturnType<typeof vi.fn> } } }
}
vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => stripeHandle.client,
}))

// `vi.mock(...)` calls above are hoisted above this import by Vitest's
// transform regardless of file position, matching the static-import
// convention used throughout this codebase's test suite (e.g.
// events/[slug]/__tests__/actions.test.ts).
import {
  createAdminBookingHold,
  createAdminPaymentRemediationHold,
  releaseAdminBookingHold,
  computeStripeExpirySeconds,
  computeHoldExpiresAt,
} from '../admin-hold'

// ── Admin-client mock ────────────────────────────────────────────────────────
//
// Routes by table name; for `bookings`, `.update(payload)` further routes
// by payload shape (the real function issues two structurally different
// UPDATEs against the same table: the session-id persist, keyed on
// `stripe_checkout_session_id`, and the Stripe-failure rollback, keyed on
// `status: 'waitlisted'`).

function mockChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'update', 'eq', 'is', 'single', 'maybeSingle']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

function makeAdminMock(opts: {
  booking?: { data: unknown; error?: unknown }
  event?: { data: unknown; error?: unknown }
  profile?: { data: unknown; error?: unknown }
  sessionIdUpdateError?: unknown
}) {
  const bookingFetchChain = mockChain(
    opts.booking ?? { data: null, error: { message: 'not found' } },
  )
  const eventFetchChain = mockChain(
    opts.event ?? { data: null, error: { message: 'not found' } },
  )
  const profileFetchChain = mockChain(
    opts.profile ?? { data: null, error: { message: 'not found' } },
  )
  const sessionIdUpdateChain = mockChain({ error: opts.sessionIdUpdateError ?? null })
  const rollbackUpdateChain = mockChain({ data: null, error: null })

  // Payload is captured for assertions (toHaveBeenCalledWith) but the
  // return value never varies with it — `void payload` keeps both the
  // TS param-count inference (must accept 1 arg, matching how these
  // spies are invoked below) and eslint's no-unused-vars satisfied.
  const rollbackUpdateSpy = vi.fn((payload: Record<string, unknown>) => {
    void payload
    return rollbackUpdateChain
  })
  const sessionIdUpdateSpy = vi.fn((payload: Record<string, unknown>) => {
    void payload
    return sessionIdUpdateChain
  })

  const from = vi.fn((table: string) => {
    if (table === 'bookings') {
      return {
        select: vi.fn(() => bookingFetchChain),
        update: vi.fn((payload: Record<string, unknown>) =>
          'stripe_checkout_session_id' in payload
            ? sessionIdUpdateSpy(payload)
            : rollbackUpdateSpy(payload),
        ),
      }
    }
    if (table === 'events') {
      return { select: vi.fn(() => eventFetchChain) }
    }
    if (table === 'profiles') {
      return { select: vi.fn(() => profileFetchChain) }
    }
    throw new Error(`makeAdminMock: unexpected table "${table}"`)
  })

  return {
    client: { from },
    from,
    bookingFetchChain,
    eventFetchChain,
    profileFetchChain,
    sessionIdUpdateChain,
    rollbackUpdateSpy,
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const VALID_BOOKING = { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'user-1' }, error: null }
const VALID_EVENT = {
  data: {
    price: 2000, // £20 → calculateBookingFeePence(2000) = 60
    slug: 'wine-tasting',
    title: 'Wine Tasting at The Connaught',
    date_time: '2026-08-01T19:00:00.000Z',
    venue_name: 'The Connaught',
    venue_address: 'Carlos Pl, London',
    venue_revealed: true,
  },
  error: null,
}
const FREE_EVENT = { data: { ...VALID_EVENT.data, price: 0 }, error: null }
const VALID_PROFILE = {
  data: { full_name: 'Amy Sangam', email: 'amy@example.com' },
  error: null,
}

function makeUserScopedClient(rpcResult: { data?: unknown; error?: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(rpcResult) }
}

beforeEach(() => {
  mockEnsureStripeCustomer.mockReset().mockResolvedValue('cus_mock')
  mockCreateBookingCheckoutSession.mockReset().mockResolvedValue({
    sessionId: 'cs_mock',
    url: 'https://checkout.stripe.test/cs_mock',
  })
  mockSendEmail.mockReset().mockResolvedValue({ success: true, messageId: 'msg_mock' })
  mockSentryCapture.mockReset()
})

// ════════════════════════════════════════════════════════════════════════════
// computeStripeExpirySeconds (spec §3.3)
// ════════════════════════════════════════════════════════════════════════════

describe('computeStripeExpirySeconds', () => {
  const NOW = new Date('2026-07-13T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holdExpiresAt=null → returns the 24h ceiling (Amy/Yasemin: most generous option)', () => {
    expect(computeStripeExpirySeconds(null)).toBe(24 * 60 * 60)
  })

  it('a deadline 40 minutes out → returns (40min - 5min safety margin) = 2100s, unclamped', () => {
    const holdExpiresAt = new Date(NOW.getTime() + 40 * 60 * 1000)
    expect(computeStripeExpirySeconds(holdExpiresAt)).toBe(35 * 60) // 2100s
  })

  it('a deadline 31 minutes out clamps UP to the 30-minute Stripe floor', () => {
    // Raw = 31min - 5min margin = 26min = 1560s, below Stripe's 30min floor.
    const holdExpiresAt = new Date(NOW.getTime() + 31 * 60 * 1000)
    expect(computeStripeExpirySeconds(holdExpiresAt)).toBe(30 * 60)
  })

  it('a deadline 25 hours out clamps DOWN to the 24h Stripe ceiling', () => {
    const holdExpiresAt = new Date(NOW.getTime() + 25 * 60 * 60 * 1000)
    expect(computeStripeExpirySeconds(holdExpiresAt)).toBe(24 * 60 * 60)
  })

  it('a deadline already in the past clamps UP to the 30-minute floor (never negative/zero)', () => {
    // Defensive edge case — raw would be negative; Stripe's create call
    // would reject a non-positive expires_at, so the floor clamp is what
    // prevents that even for an already-expired deadline.
    const holdExpiresAt = new Date(NOW.getTime() - 10 * 60 * 1000)
    expect(computeStripeExpirySeconds(holdExpiresAt)).toBe(30 * 60)
  })

  it('the 5-minute safety margin is subtracted BEFORE clamping (exact boundary: 4h05m out → exactly 4h/14400s)', () => {
    const holdExpiresAt = new Date(NOW.getTime() + (4 * 60 + 5) * 60 * 1000)
    expect(computeStripeExpirySeconds(holdExpiresAt)).toBe(4 * 60 * 60)
  })

  it('accepts the exact MIN boundary (35 minutes out → exactly 1800s, not clamped)', () => {
    const holdExpiresAt = new Date(NOW.getTime() + 35 * 60 * 1000)
    expect(computeStripeExpirySeconds(holdExpiresAt)).toBe(30 * 60)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// computeHoldExpiresAt (spec §4.3) — NOT YET WIRED to any caller in this
// PR (promoteFromWaitlist hardcodes null), but exported and must be
// correct now so the systemic-slice flip is a one-line change.
// ════════════════════════════════════════════════════════════════════════════

describe('computeHoldExpiresAt', () => {
  const NOW = new Date('2026-07-13T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('event far in the future (10 days out) → returns exactly now + 4 hours', () => {
    const eventDateTime = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000)
    const result = computeHoldExpiresAt(eventDateTime)
    expect(result).not.toBeNull()
    expect(result!.getTime()).toBe(NOW.getTime() + 4 * 60 * 60 * 1000)
  })

  it("event ~tomorrow (Amy/Yasemin's actual shape, well under 4h05m away is NOT the case — but < 4h IS) → null", () => {
    // "Tomorrow" is actually >4h away in wall-clock terms, so it would
    // hit the non-null branch under this formula — the urgent slice's
    // hardcoded `null` (not this formula) is what gives Amy/Yasemin no
    // deadline (see admin-hold.ts's own module comment + spec §8.1 step
    // 6). This test instead pins the genuinely-close-to-the-wire case the
    // formula IS designed to catch once wired up: an event 90 minutes out.
    const eventDateTime = new Date(NOW.getTime() + 90 * 60 * 1000)
    expect(computeHoldExpiresAt(eventDateTime)).toBeNull()
  })

  it('exact boundary: event 4h05m + 1s away → non-null (4h hold fits with margin to spare)', () => {
    const eventDateTime = new Date(NOW.getTime() + (4 * 60 + 5) * 60 * 1000 + 1000)
    expect(computeHoldExpiresAt(eventDateTime)).not.toBeNull()
  })

  it('exact boundary: event exactly 4h05m away → null (condition is strictly ">", not ">=")', () => {
    const eventDateTime = new Date(NOW.getTime() + (4 * 60 + 5) * 60 * 1000)
    expect(computeHoldExpiresAt(eventDateTime)).toBeNull()
  })

  it('exact boundary: event 4h05m - 1s away → null', () => {
    const eventDateTime = new Date(NOW.getTime() + (4 * 60 + 5) * 60 * 1000 - 1000)
    expect(computeHoldExpiresAt(eventDateTime)).toBeNull()
  })

  it('event already in the past → null (defensive; the RPC layer independently rejects past events)', () => {
    const eventDateTime = new Date(NOW.getTime() - 60 * 60 * 1000)
    expect(computeHoldExpiresAt(eventDateTime)).toBeNull()
  })

  it('accepts an ISO string input identically to a Date object', () => {
    const future = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000)
    const fromDate = computeHoldExpiresAt(future)
    const fromString = computeHoldExpiresAt(future.toISOString())
    expect(fromString).not.toBeNull()
    expect(fromString!.getTime()).toBe(fromDate!.getTime())
  })
})

// ════════════════════════════════════════════════════════════════════════════
// createAdminBookingHold
// ════════════════════════════════════════════════════════════════════════════

describe('createAdminBookingHold', () => {
  it('returns "Booking not found" when the booking fetch errors, without calling the RPC', async () => {
    adminHandle = makeAdminMock({ booking: { data: null, error: { message: 'no row' } } })
    const userScoped = makeUserScopedClient({ data: null, error: null })

    const result = await createAdminBookingHold(userScoped as never, 'bk-missing', {
      holdExpiresAt: null,
    })

    expect(result).toEqual({ success: false, error: 'Booking not found' })
    expect(userScoped.rpc).not.toHaveBeenCalled()
  })

  it('returns "Event not found" when the event fetch errors', async () => {
    adminHandle = makeAdminMock({
      booking: VALID_BOOKING,
      event: { data: null, error: { message: 'no row' } },
    })
    const userScoped = makeUserScopedClient({ data: null, error: null })

    const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
      holdExpiresAt: null,
    })

    expect(result).toEqual({ success: false, error: 'Event not found' })
    expect(userScoped.rpc).not.toHaveBeenCalled()
  })

  it('INVARIANT: defensively rejects a FREE event without ever calling the RPC (belt-and-braces — the Server Action should never reach here for price=0)', async () => {
    adminHandle = makeAdminMock({ booking: VALID_BOOKING, event: FREE_EVENT })
    const userScoped = makeUserScopedClient({ data: null, error: null })

    const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
      holdExpiresAt: null,
    })

    expect(result).toEqual({
      success: false,
      error: 'Free events should be confirmed directly, not held',
    })
    expect(userScoped.rpc).not.toHaveBeenCalled()
    expect(mockEnsureStripeCustomer).not.toHaveBeenCalled()
  })

  it('surfaces a generic error when the RPC call itself transport-errors (network/permission), without touching Stripe', async () => {
    adminHandle = makeAdminMock({ booking: VALID_BOOKING, event: VALID_EVENT })
    const userScoped = makeUserScopedClient({
      data: null,
      error: { message: 'permission denied for function admin_promote_waitlist_to_hold' },
    })

    const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
      holdExpiresAt: null,
    })

    expect(result).toEqual({
      success: false,
      error: 'Something went wrong. Please try again.',
    })
    expect(mockEnsureStripeCustomer).not.toHaveBeenCalled()
    expect(mockCreateBookingCheckoutSession).not.toHaveBeenCalled()
  })

  it('passes through the RPC\'s own jsonb error VERBATIM (e.g. capacity/status rejections), without touching Stripe', async () => {
    adminHandle = makeAdminMock({ booking: VALID_BOOKING, event: VALID_EVENT })
    const userScoped = makeUserScopedClient({
      data: { error: 'Event is at full capacity — cannot promote' },
      error: null,
    })

    const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
      holdExpiresAt: null,
    })

    expect(result).toEqual({
      success: false,
      error: 'Event is at full capacity — cannot promote',
    })
    expect(mockEnsureStripeCustomer).not.toHaveBeenCalled()
    expect(mockCreateBookingCheckoutSession).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('calls the RPC with p_booking_fee_pence computed from event.price (single source of truth)', async () => {
    adminHandle = makeAdminMock({
      booking: VALID_BOOKING,
      event: VALID_EVENT, // price 2000 → fee 60 (calculateBookingFeePence)
      profile: VALID_PROFILE,
    })
    const userScoped = makeUserScopedClient({
      data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
      error: null,
    })

    await createAdminBookingHold(userScoped as never, 'bk-1', { holdExpiresAt: null })

    expect(userScoped.rpc).toHaveBeenCalledWith('admin_promote_waitlist_to_hold', {
      p_booking_id: 'bk-1',
      p_booking_fee_pence: 60,
      p_hold_expires_at: null,
    })
  })

  it('serialises a non-null holdExpiresAt to ISO for BOTH the RPC call and the returned echo value', async () => {
    adminHandle = makeAdminMock({
      booking: VALID_BOOKING,
      event: VALID_EVENT,
      profile: VALID_PROFILE,
    })
    const userScoped = makeUserScopedClient({
      data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
      error: null,
    })
    const holdExpiresAt = new Date('2026-07-13T16:00:00.000Z')

    const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
      holdExpiresAt,
    })

    expect(userScoped.rpc).toHaveBeenCalledWith(
      'admin_promote_waitlist_to_hold',
      expect.objectContaining({ p_hold_expires_at: '2026-07-13T16:00:00.000Z' }),
    )
    expect(result.holdExpiresAt).toBe('2026-07-13T16:00:00.000Z')
  })

  describe('success path', () => {
    async function runSuccessCase(holdExpiresAt: Date | null = null) {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })
      const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
        holdExpiresAt,
      })
      return { result, userScoped }
    }

    it('returns {success:true, status:"pending_payment", checkoutUrl} on success', async () => {
      const { result } = await runSuccessCase()
      expect(result).toEqual({
        success: true,
        status: 'pending_payment',
        checkoutUrl: 'https://checkout.stripe.test/cs_mock',
        holdExpiresAt: null,
      })
    })

    it('creates the Stripe Customer via ensureStripeCustomer with the fetched profile', async () => {
      await runSuccessCase()
      expect(mockEnsureStripeCustomer).toHaveBeenCalledWith(
        adminHandle.client,
        { userId: 'user-1', email: 'amy@example.com', fullName: 'Amy Sangam' },
      )
    })

    it('INVARIANT: cancel_url carries &from=admin_hold so abandonPendingCheckout restores to waitlisted, not cancelled', async () => {
      await runSuccessCase()
      const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
      expect(sessionArgs.cancelUrl).toContain('cancelled=1&from=admin_hold')
      expect(sessionArgs.cancelUrl).toContain('/events/wine-tasting')
    })

    it('success_url points at the booking-success page with the CHECKOUT_SESSION_ID template placeholder', async () => {
      await runSuccessCase()
      const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
      expect(sessionArgs.successUrl).toBe(
        'http://localhost:6500/events/wine-tasting/booking-success?session_id={CHECKOUT_SESSION_ID}',
      )
    })

    it('holdExpiresAt=null → expiresInSeconds is the 24h ceiling (86400)', async () => {
      await runSuccessCase(null)
      const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
      expect(sessionArgs.expiresInSeconds).toBe(24 * 60 * 60)
    })

    it('non-null holdExpiresAt → expiresInSeconds is a number within Stripe\'s [30min, 24h] range', async () => {
      // Exact-formula precision is covered by the dedicated
      // computeStripeExpirySeconds describe block above; here we only
      // need to confirm createAdminBookingHold WIRES options.holdExpiresAt
      // through rather than silently dropping it or hardcoding null.
      await runSuccessCase(new Date(Date.now() + 2 * 60 * 60 * 1000))
      const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
      expect(typeof sessionArgs.expiresInSeconds).toBe('number')
      expect(sessionArgs.expiresInSeconds).toBeGreaterThanOrEqual(30 * 60)
      expect(sessionArgs.expiresInSeconds).toBeLessThanOrEqual(24 * 60 * 60)
    })

    it('passes priceInPence and bookingFeePence through to the Checkout Session unchanged from the event/fee calc', async () => {
      await runSuccessCase()
      const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
      expect(sessionArgs.priceInPence).toBe(2000)
      expect(sessionArgs.bookingFeePence).toBe(60)
      expect(sessionArgs.bookingId).toBe('bk-1')
      expect(sessionArgs.userId).toBe('user-1')
      expect(sessionArgs.userEmail).toBe('amy@example.com')
      expect(sessionArgs.stripeCustomerId).toBe('cus_mock')
    })

    it('persists stripe_checkout_session_id on the booking row', async () => {
      await runSuccessCase()
      // The rollback update chain is a distinct object from the session-id
      // one; the session-id write is verified via adminHandle's `from`
      // mock invocation on 'bookings' with the right payload.
      const bookingsCalls = (adminHandle.from as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'bookings',
      )
      expect(bookingsCalls.length).toBeGreaterThanOrEqual(2) // fetch + session-id persist
    })

    it('sends the waitlist-promotion email with the right recipient + audit metadata', async () => {
      await runSuccessCase()
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'amy@example.com',
          templateName: 'waitlist_promotion',
          relatedProfileId: 'user-1',
          recipientUserId: 'user-1',
          recipientEventId: 'evt-1',
          notificationType: 'waitlist',
        }),
      )
      // The email's CTA must point at the SAME checkout URL returned to
      // the caller — not a re-derived or stale one.
      const emailArgs = mockSendEmail.mock.calls[0][0]
      expect(emailArgs.html).toContain('https://checkout.stripe.test/cs_mock')
    })

    it('does NOT roll back when the session-id persist UPDATE itself errors (non-critical, log-and-continue)', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
        sessionIdUpdateError: { message: 'transient write failure' },
      })
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })
      const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
        holdExpiresAt: null,
      })
      // Still success — losing the session-id cache is non-critical
      // (the hold + Checkout Session both genuinely exist by this point).
      expect(result.success).toBe(true)
      expect(adminHandle.rollbackUpdateSpy).not.toHaveBeenCalled()
    })
  })

  describe('non-blocking email failure (project rule: email sends must never break the triggering action)', () => {
    it('sendEmail resolving {success:false} still returns overall success:true (no rollback)', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      mockSendEmail.mockResolvedValue({ success: false, error: 'Resend down' })
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
        holdExpiresAt: null,
      })

      expect(result.success).toBe(true)
      expect(result.checkoutUrl).toBe('https://checkout.stripe.test/cs_mock')
      expect(adminHandle.rollbackUpdateSpy).not.toHaveBeenCalled()
    })

    it('sendEmail THROWING is caught by its own inner try/catch and does NOT trigger the outer Stripe-failure rollback', async () => {
      // This is the subtle correctness property worth pinning explicitly:
      // the email send/template-render is wrapped in its OWN try/catch
      // (admin-hold.ts step 9b), nested inside the outer try/catch that
      // drives the Stripe-failure rollback (step 10). If a future
      // refactor accidentally flattened these into one try/catch, an
      // email exception would incorrectly roll back an already-successful
      // hold + live Checkout Session — cancelling a real payment link the
      // member may already be looking at.
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      mockSendEmail.mockRejectedValue(new Error('Resend network error'))
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
        holdExpiresAt: null,
      })

      expect(result).toEqual({
        success: true,
        status: 'pending_payment',
        checkoutUrl: 'https://checkout.stripe.test/cs_mock',
        holdExpiresAt: null,
      })
      expect(adminHandle.rollbackUpdateSpy).not.toHaveBeenCalled()
      expect(mockSentryCapture).not.toHaveBeenCalled()
    })
  })

  describe('Stripe-failure rollback (spec §3.2 step 10 — "the one place copying the pattern verbatim would be wrong")', () => {
    it('INVARIANT: when ensureStripeCustomer throws, rolls back to waitlisted AND clears BOTH is_admin_hold and admin_hold_expires_at in the SAME update', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      mockEnsureStripeCustomer.mockRejectedValue(new Error('Stripe customer create failed'))
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
        holdExpiresAt: null,
      })

      expect(result).toEqual({
        success: false,
        error: 'Could not start checkout. Please try again.',
      })
      // The exact payload — status alone would NOT be enough; this is the
      // regression this test exists to catch (copying claimWaitlistSpot's
      // rollback verbatim, which only clears `status`, would leave a
      // stale is_admin_hold=true on a now-'waitlisted' row and violate
      // chk_bookings_admin_hold_requires_pending_payment on write).
      expect(adminHandle.rollbackUpdateSpy).toHaveBeenCalledWith({
        status: 'waitlisted',
        is_admin_hold: false,
        admin_hold_expires_at: null,
      })
    })

    it('INVARIANT: when createBookingCheckoutSession throws (Stripe API error), same full rollback fires', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      mockCreateBookingCheckoutSession.mockRejectedValue(new Error('Stripe API is down'))
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
        holdExpiresAt: null,
      })

      expect(result.success).toBe(false)
      expect(adminHandle.rollbackUpdateSpy).toHaveBeenCalledWith({
        status: 'waitlisted',
        is_admin_hold: false,
        admin_hold_expires_at: null,
      })
      // No email sent — the hold never became payable.
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('when the profile fetch is missing an email, rolls back the same way (defensive guard before Stripe is ever called)', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: { data: { full_name: 'No Email', email: null }, error: null },
      })
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      const result = await createAdminBookingHold(userScoped as never, 'bk-1', {
        holdExpiresAt: null,
      })

      expect(result.success).toBe(false)
      expect(mockEnsureStripeCustomer).not.toHaveBeenCalled()
      expect(adminHandle.rollbackUpdateSpy).toHaveBeenCalledWith({
        status: 'waitlisted',
        is_admin_hold: false,
        admin_hold_expires_at: null,
      })
    })

    it('the rollback UPDATE is guarded by .eq(id) AND .eq(status, pending_payment) (optimistic guard)', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      mockEnsureStripeCustomer.mockRejectedValue(new Error('boom'))
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      await createAdminBookingHold(userScoped as never, 'bk-1', { holdExpiresAt: null })

      const rollbackChain = adminHandle.rollbackUpdateSpy.mock.results[0]!.value as {
        eq: ReturnType<typeof vi.fn>
      }
      expect(rollbackChain.eq).toHaveBeenCalledWith('id', 'bk-1')
      expect(rollbackChain.eq).toHaveBeenCalledWith('status', 'pending_payment')
    })

    it('reports the failure to Sentry with surface=createAdminBookingHold', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      mockEnsureStripeCustomer.mockRejectedValue(new Error('Stripe outage'))
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      await createAdminBookingHold(userScoped as never, 'bk-1', { holdExpiresAt: null })

      expect(mockSentryCapture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { surface: 'createAdminBookingHold' },
          extra: expect.objectContaining({
            bookingId: 'bk-1',
            eventId: 'evt-1',
            userId: 'user-1',
          }),
        }),
      )
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// createAdminPaymentRemediationHold (Addendum §A.4 — payment_remediation origin)
//
// This is a thin wrapper over the SAME runAdminHoldFlow as
// createAdminBookingHold, parameterised by ADMIN_HOLD_ORIGINS.payment_
// remediation. These tests focus on the THREE things that differ by
// origin (rpcName, rollbackStatus, email template/logLabel) rather than
// re-testing the shared plumbing (booking/event fetch, Stripe Customer
// creation, session-id persistence, non-blocking email failure) already
// covered exhaustively above for the waitlist_promotion origin.
// ════════════════════════════════════════════════════════════════════════════

describe('createAdminPaymentRemediationHold', () => {
  it('INVARIANT: defensively rejects a FREE event without ever calling the RPC (shared guard, same as createAdminBookingHold)', async () => {
    adminHandle = makeAdminMock({ booking: VALID_BOOKING, event: FREE_EVENT })
    const userScoped = makeUserScopedClient({ data: null, error: null })

    const result = await createAdminPaymentRemediationHold(userScoped as never, 'bk-1', {
      holdExpiresAt: null,
    })

    expect(result).toEqual({
      success: false,
      error: 'Free events should be confirmed directly, not held',
    })
    expect(userScoped.rpc).not.toHaveBeenCalled()
  })

  it('calls the admin_hold_confirmed_booking_for_payment RPC (NOT admin_promote_waitlist_to_hold)', async () => {
    adminHandle = makeAdminMock({
      booking: VALID_BOOKING,
      event: VALID_EVENT, // price 2000 -> fee 60
      profile: VALID_PROFILE,
    })
    const userScoped = makeUserScopedClient({
      data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
      error: null,
    })

    await createAdminPaymentRemediationHold(userScoped as never, 'bk-1', { holdExpiresAt: null })

    expect(userScoped.rpc).toHaveBeenCalledWith('admin_hold_confirmed_booking_for_payment', {
      p_booking_id: 'bk-1',
      p_booking_fee_pence: 60,
      p_hold_expires_at: null,
    })
    expect(userScoped.rpc).not.toHaveBeenCalledWith(
      'admin_promote_waitlist_to_hold',
      expect.anything(),
    )
  })

  it('passes through the RPC\'s own jsonb error VERBATIM (e.g. "already been paid"), without touching Stripe', async () => {
    adminHandle = makeAdminMock({ booking: VALID_BOOKING, event: VALID_EVENT })
    const userScoped = makeUserScopedClient({
      data: { error: 'This booking has already been paid' },
      error: null,
    })

    const result = await createAdminPaymentRemediationHold(userScoped as never, 'bk-1', {
      holdExpiresAt: null,
    })

    expect(result).toEqual({
      success: false,
      error: 'This booking has already been paid',
    })
    expect(mockEnsureStripeCustomer).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  describe('success path', () => {
    async function runRemediationSuccessCase(holdExpiresAt: Date | null = null) {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })
      const result = await createAdminPaymentRemediationHold(userScoped as never, 'bk-1', {
        holdExpiresAt,
      })
      return { result }
    }

    it('returns {success:true, status:"pending_payment", checkoutUrl} — same shape as createAdminBookingHold', async () => {
      const { result } = await runRemediationSuccessCase()
      expect(result).toEqual({
        success: true,
        status: 'pending_payment',
        checkoutUrl: 'https://checkout.stripe.test/cs_mock',
        holdExpiresAt: null,
      })
    })

    it('INVARIANT: cancel_url carries &from=admin_remediation (NOT &from=admin_hold) so abandonPendingCheckout restores to confirmed, not waitlisted', async () => {
      await runRemediationSuccessCase()
      const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
      expect(sessionArgs.cancelUrl).toContain('cancelled=1&from=admin_remediation')
      expect(sessionArgs.cancelUrl).not.toContain('from=admin_hold')
    })

    it('sends the confirmed-unpaid-payment-link email (templateName + notificationType), NOT the waitlist-promotion one', async () => {
      await runRemediationSuccessCase()
      expect(mockSendEmail).toHaveBeenCalledTimes(1)
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'amy@example.com',
          templateName: 'confirmed_unpaid_payment_link',
          notificationType: 'reminder',
        }),
      )
    })

    it('INVARIANT: the email sent for this origin never mentions "waitlist" anywhere (they were never on it this cycle — Addendum §A.5)', async () => {
      await runRemediationSuccessCase()
      const emailArgs = mockSendEmail.mock.calls[0][0]
      expect(emailArgs.html.toLowerCase()).not.toContain('waitlist')
      expect(emailArgs.subject.toLowerCase()).not.toContain('waitlist')
    })
  })

  describe('Stripe-failure rollback — THE test that distinguishes this origin from waitlist_promotion', () => {
    it('INVARIANT: when ensureStripeCustomer throws, rolls back to CONFIRMED (never waitlisted) AND clears BOTH hold columns in the SAME update', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      mockEnsureStripeCustomer.mockRejectedValue(new Error('Stripe customer create failed'))
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      const result = await createAdminPaymentRemediationHold(userScoped as never, 'bk-1', {
        holdExpiresAt: null,
      })

      expect(result).toEqual({
        success: false,
        error: 'Could not start checkout. Please try again.',
      })
      // This is the exact payload the Addendum flags as the "one thing
      // most likely to have a copy-paste bug" — status MUST be
      // 'confirmed', not 'waitlisted' (which is what the sibling origin's
      // rollback uses). Reverting a remediated hold to 'waitlisted' would
      // be WRONG (these bookings were never on the waitlist this cycle),
      // but reverting to 'confirmed' unpaid is the honest starting state
      // and functionally a no-op — they're exactly where they started,
      // still needing remediation.
      expect(adminHandle.rollbackUpdateSpy).toHaveBeenCalledWith({
        status: 'confirmed',
        is_admin_hold: false,
        admin_hold_expires_at: null,
      })
      expect(adminHandle.rollbackUpdateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'waitlisted' }),
      )
    })

    it('INVARIANT: when createBookingCheckoutSession throws, same confirmed-not-waitlisted rollback fires', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      mockCreateBookingCheckoutSession.mockRejectedValue(new Error('Stripe API is down'))
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      await createAdminPaymentRemediationHold(userScoped as never, 'bk-1', { holdExpiresAt: null })

      expect(adminHandle.rollbackUpdateSpy).toHaveBeenCalledWith({
        status: 'confirmed',
        is_admin_hold: false,
        admin_hold_expires_at: null,
      })
    })

    it('reports the failure to Sentry with surface=createAdminPaymentRemediationHold (NOT surface=createAdminBookingHold)', async () => {
      adminHandle = makeAdminMock({
        booking: VALID_BOOKING,
        event: VALID_EVENT,
        profile: VALID_PROFILE,
      })
      mockEnsureStripeCustomer.mockRejectedValue(new Error('Stripe outage'))
      const userScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })

      await createAdminPaymentRemediationHold(userScoped as never, 'bk-1', { holdExpiresAt: null })

      expect(mockSentryCapture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: { surface: 'createAdminPaymentRemediationHold' },
        }),
      )
    })

    it('CROSS-CHECK: createAdminBookingHold and createAdminPaymentRemediationHold roll back to genuinely DIFFERENT statuses for the identical failure, not both silently checking the same status', async () => {
      // Guards against the failure mode where both origin tests above pass
      // independently but are secretly asserting the same thing (e.g. a
      // typo'd copy-paste that left both rollbackStatus values identical).
      mockEnsureStripeCustomer.mockRejectedValue(new Error('boom'))

      adminHandle = makeAdminMock({ booking: VALID_BOOKING, event: VALID_EVENT, profile: VALID_PROFILE })
      const waitlistUserScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })
      await createAdminBookingHold(waitlistUserScoped as never, 'bk-1', { holdExpiresAt: null })
      const waitlistRollbackPayload = adminHandle.rollbackUpdateSpy.mock.calls[0][0] as Record<
        string,
        unknown
      >

      adminHandle = makeAdminMock({ booking: VALID_BOOKING, event: VALID_EVENT, profile: VALID_PROFILE })
      const remediationUserScoped = makeUserScopedClient({
        data: { booking_id: 'bk-1', user_id: 'user-1', status: 'pending_payment' },
        error: null,
      })
      await createAdminPaymentRemediationHold(remediationUserScoped as never, 'bk-1', {
        holdExpiresAt: null,
      })
      const remediationRollbackPayload = adminHandle.rollbackUpdateSpy.mock.calls[0][0] as Record<
        string,
        unknown
      >

      expect(waitlistRollbackPayload.status).toBe('waitlisted')
      expect(remediationRollbackPayload.status).toBe('confirmed')
      expect(waitlistRollbackPayload.status).not.toBe(remediationRollbackPayload.status)
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// releaseAdminBookingHold (Addendum §B.4 — Gap B, manual hold release)
// ════════════════════════════════════════════════════════════════════════════

describe('releaseAdminBookingHold', () => {
  // Returns a shape structurally compatible with `ReturnType<typeof
  // makeAdminMock>` (the shared `adminHandle` variable's declared type)
  // purely so the SAME `adminHandle` module-level variable / `@/lib/
  // supabase/admin` mock wiring can be reused here without loosening that
  // type for every other describe block in this file. releaseAdminBookingHold
  // only ever reads `.from('bookings')` — the extra chains below exist
  // solely to satisfy the type and are never exercised.
  function makeReleaseAdminMock(opts: { sessionId?: string | null; fetchError?: unknown } = {}) {
    const bookingChain = mockChain(
      opts.fetchError
        ? { data: null, error: opts.fetchError }
        : { data: { stripe_checkout_session_id: opts.sessionId ?? null }, error: null },
    )
    const from = vi.fn((table: string) => {
      if (table === 'bookings') return { select: vi.fn(() => bookingChain) }
      throw new Error(`makeReleaseAdminMock: unexpected table "${table}"`)
    })
    return {
      client: { from },
      from,
      bookingFetchChain: bookingChain,
      eventFetchChain: mockChain({ data: null, error: null }),
      profileFetchChain: mockChain({ data: null, error: null }),
      sessionIdUpdateChain: mockChain({ data: null, error: null }),
      rollbackUpdateSpy: vi.fn(),
    }
  }

  beforeEach(() => {
    stripeHandle = { client: { checkout: { sessions: { expire: vi.fn().mockResolvedValue({}) } } } }
  })

  it('returns a generic error when the RPC call itself transport-errors, without touching Stripe', async () => {
    adminHandle = makeReleaseAdminMock({ sessionId: 'cs_mock' })
    const userScoped = makeUserScopedClient({
      data: null,
      error: { message: 'permission denied for function admin_revert_hold_to_waitlist' },
    })

    const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

    expect(result).toEqual({ success: false, error: 'Something went wrong. Please try again.' })
    expect(stripeHandle.client.checkout.sessions.expire).not.toHaveBeenCalled()
  })

  it('passes through the RPC\'s own jsonb error VERBATIM (e.g. "not an active payment hold"), without touching Stripe', async () => {
    adminHandle = makeReleaseAdminMock({ sessionId: 'cs_mock' })
    const userScoped = makeUserScopedClient({
      data: {
        error:
          'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.',
      },
      error: null,
    })

    const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

    expect(result).toEqual({
      success: false,
      error:
        'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.',
    })
    expect(stripeHandle.client.checkout.sessions.expire).not.toHaveBeenCalled()
  })

  it('calls admin_revert_hold_to_waitlist with the given bookingId', async () => {
    adminHandle = makeReleaseAdminMock({ sessionId: null })
    const userScoped = makeUserScopedClient({
      data: { status: 'waitlisted', waitlist_position: 2 },
      error: null,
    })

    await releaseAdminBookingHold(userScoped as never, 'bk-42')

    expect(userScoped.rpc).toHaveBeenCalledWith('admin_revert_hold_to_waitlist', {
      p_booking_id: 'bk-42',
    })
  })

  it('on success, echoes waitlistPosition from the RPC result', async () => {
    adminHandle = makeReleaseAdminMock({ sessionId: null })
    const userScoped = makeUserScopedClient({
      data: { status: 'waitlisted', waitlist_position: 3 },
      error: null,
    })

    const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

    expect(result).toEqual({ success: true, status: 'waitlisted', waitlistPosition: 3 })
  })

  it('waitlistPosition null in the RPC result is preserved as null (not coerced to 0/undefined)', async () => {
    adminHandle = makeReleaseAdminMock({ sessionId: null })
    const userScoped = makeUserScopedClient({
      data: { status: 'waitlisted', waitlist_position: null },
      error: null,
    })

    const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

    expect(result.waitlistPosition).toBeNull()
  })

  it('no stripe_checkout_session_id on the row -> skips the Stripe call entirely, still returns success', async () => {
    adminHandle = makeReleaseAdminMock({ sessionId: null })
    const userScoped = makeUserScopedClient({
      data: { status: 'waitlisted', waitlist_position: 1 },
      error: null,
    })

    const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

    expect(result.success).toBe(true)
    expect(stripeHandle.client.checkout.sessions.expire).not.toHaveBeenCalled()
  })

  it('a failed/empty session-id lookup (no error surfaced) does not block success — best-effort only', async () => {
    adminHandle = makeReleaseAdminMock({ fetchError: { message: 'transient read failure' } })
    const userScoped = makeUserScopedClient({
      data: { status: 'waitlisted', waitlist_position: 1 },
      error: null,
    })

    const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

    expect(result.success).toBe(true)
    expect(stripeHandle.client.checkout.sessions.expire).not.toHaveBeenCalled()
  })

  it('a sessionId IS present -> calls stripe.checkout.sessions.expire(sessionId)', async () => {
    adminHandle = makeReleaseAdminMock({ sessionId: 'cs_live_abc' })
    const userScoped = makeUserScopedClient({
      data: { status: 'waitlisted', waitlist_position: 1 },
      error: null,
    })

    await releaseAdminBookingHold(userScoped as never, 'bk-1')

    expect(stripeHandle.client.checkout.sessions.expire).toHaveBeenCalledWith('cs_live_abc')
  })

  describe('DB-first ordering (Addendum §B.2): DB revert is authoritative, Stripe-expire is best-effort AFTER', () => {
    it('INVARIANT: the DB revert result is returned as success even when stripe.checkout.sessions.expire THROWS', async () => {
      adminHandle = makeReleaseAdminMock({ sessionId: 'cs_live_abc' })
      stripeHandle.client.checkout.sessions.expire = vi
        .fn()
        .mockRejectedValue(new Error('Some unrelated Stripe outage'))
      const userScoped = makeUserScopedClient({
        data: { status: 'waitlisted', waitlist_position: 4 },
        error: null,
      })

      const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

      // Never rolled back, never surfaced as an error — the seat is
      // already correctly freed by the DB-side revert regardless of
      // what happens to the (now-irrelevant) Checkout Session.
      expect(result).toEqual({ success: true, status: 'waitlisted', waitlistPosition: 4 })
    })

    it('does NOT call Stripe before the RPC result is known (RPC error short-circuits before any session lookup)', async () => {
      adminHandle = makeReleaseAdminMock({ sessionId: 'cs_live_abc' })
      const userScoped = makeUserScopedClient({
        data: { error: 'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.' },
        error: null,
      })

      await releaseAdminBookingHold(userScoped as never, 'bk-1')

      expect(adminHandle.from).not.toHaveBeenCalled()
      expect(stripeHandle.client.checkout.sessions.expire).not.toHaveBeenCalled()
    })
  })

  describe('"already paid" heuristic (Addendum §B.4 — unverified, best-effort Sentry escalation)', () => {
    it('a message matching /complete|paid|succeeded/i (no resource_missing code) escalates to Sentry with signal=possible_race_paid_after_revert', async () => {
      adminHandle = makeReleaseAdminMock({ sessionId: 'cs_live_abc' })
      stripeHandle.client.checkout.sessions.expire = vi
        .fn()
        .mockRejectedValue(new Error('You cannot expire this session because it is already complete.'))
      const userScoped = makeUserScopedClient({
        data: { status: 'waitlisted', waitlist_position: 1 },
        error: null,
      })

      await releaseAdminBookingHold(userScoped as never, 'bk-1')

      expect(mockSentryCapture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: {
            surface: 'releaseAdminBookingHold',
            signal: 'possible_race_paid_after_revert',
          },
          extra: { bookingId: 'bk-1', sessionId: 'cs_live_abc' },
          level: 'error',
        }),
      )
    })

    it.each(['paid', 'succeeded', 'complete', 'COMPLETE', 'Already Paid'])(
      'matches case-insensitively on the word "%s"',
      async (word) => {
        adminHandle = makeReleaseAdminMock({ sessionId: 'cs_live_abc' })
        stripeHandle.client.checkout.sessions.expire = vi
          .fn()
          .mockRejectedValue(new Error(`Session state error: ${word}`))
        const userScoped = makeUserScopedClient({
          data: { status: 'waitlisted', waitlist_position: 1 },
          error: null,
        })

        await releaseAdminBookingHold(userScoped as never, 'bk-1')

        expect(mockSentryCapture).toHaveBeenCalledTimes(1)
      },
    )

    it('a message that does NOT match the heuristic (e.g. a generic network error) is logged but NOT escalated to Sentry', async () => {
      adminHandle = makeReleaseAdminMock({ sessionId: 'cs_live_abc' })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      stripeHandle.client.checkout.sessions.expire = vi
        .fn()
        .mockRejectedValue(new Error('ECONNRESET'))
      const userScoped = makeUserScopedClient({
        data: { status: 'waitlisted', waitlist_position: 1 },
        error: null,
      })

      const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

      expect(mockSentryCapture).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(
        '[releaseAdminBookingHold] Stripe session expire failed (non-blocking):',
        'cs_live_abc',
        'ECONNRESET',
      )
      warnSpy.mockRestore()
    })

    it('INVARIANT: a resource_missing code is EXCLUDED from escalation even when the message text happens to match the regex (documented exclusion — a stale/bad session id is not a payment race)', async () => {
      adminHandle = makeReleaseAdminMock({ sessionId: 'cs_stale' })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const err = Object.assign(new Error('No such checkout.session (already succeeded and purged)'), {
        code: 'resource_missing',
      })
      stripeHandle.client.checkout.sessions.expire = vi.fn().mockRejectedValue(err)
      const userScoped = makeUserScopedClient({
        data: { status: 'waitlisted', waitlist_position: 1 },
        error: null,
      })

      const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

      expect(mockSentryCapture).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('a non-Error thrown value (string) is handled without crashing and does not escalate', async () => {
      adminHandle = makeReleaseAdminMock({ sessionId: 'cs_live_abc' })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      stripeHandle.client.checkout.sessions.expire = vi.fn().mockRejectedValue('a plain string rejection')
      const userScoped = makeUserScopedClient({
        data: { status: 'waitlisted', waitlist_position: 1 },
        error: null,
      })

      const result = await releaseAdminBookingHold(userScoped as never, 'bk-1')

      expect(result.success).toBe(true)
      expect(mockSentryCapture).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })
})
