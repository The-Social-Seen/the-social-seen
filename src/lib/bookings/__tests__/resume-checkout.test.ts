import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for src/lib/bookings/resume-checkout.ts —
 * `resumePendingBookingCheckout`, the shared implementation behind both
 * the `resumePendingCheckout` Server Action
 * (src/app/(member)/bookings/actions.ts) and the
 * `GET /bookings/resume/[bookingId]` route handler (the reminder email's
 * CTA link). See SYSTEM-DESIGN-pending-payment-visibility.md §5.1 for
 * the 11-step algorithm this file pins.
 *
 * This is a FLAGGED SENSITIVE SURFACE (payment data + a new auth-gated
 * mutation that mints real Stripe Checkout Sessions) — every INVARIANT
 * test below defends a specific failure mode named in the spec, not just
 * a code path.
 *
 * Mocking strategy mirrors src/lib/bookings/__tests__/admin-hold.test.ts
 * (the closest sibling: also a user-scoped-client + admin-client +
 * @/lib/stripe/checkout + @/lib/stripe/server shape). `@/lib/stripe/
 * checkout`'s OWN internals (ensureStripeCustomer's stale-id handling,
 * createBookingCheckoutSession's Stripe session shape) already have
 * dedicated coverage in src/lib/stripe/__tests__/checkout.test.ts and are
 * mocked wholesale here; this file focuses on resume-checkout.ts's own
 * orchestration logic.
 */

// ── Mocks (hoisted — must be declared before importing the module under test) ──

const mockEnsureStripeCustomer = vi.fn()
const mockCreateBookingCheckoutSession = vi.fn()
vi.mock('@/lib/stripe/checkout', () => ({
  ensureStripeCustomer: (...args: unknown[]) => mockEnsureStripeCustomer(...args),
  createBookingCheckoutSession: (...args: unknown[]) =>
    mockCreateBookingCheckoutSession(...args),
}))

const mockSentryCapture = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockSentryCapture(...args),
}))

// Matches the established pattern in admin-hold.test.ts and
// events/[slug]/__tests__/actions.test.ts.
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-host': 'localhost:6500', 'x-forwarded-proto': 'http' }),
}))

let adminHandle: ReturnType<typeof makeAdminMock>
const mockCreateAdminClient = vi.fn(() => adminHandle.client)
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

let stripeHandle: {
  client: { checkout: { sessions: { expire: ReturnType<typeof vi.fn> } } }
}
vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => stripeHandle.client,
}))

// `vi.mock(...)` calls above are hoisted above this import by Vitest's
// transform regardless of file position, matching this codebase's
// established static-import convention.
import { resumePendingBookingCheckout } from '../resume-checkout'

// ── Chain builder (mirrors admin-hold.test.ts's mockChain) ──────────────────

function mockChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'update', 'eq', 'is', 'single']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

function makeUserScopedClient(bookingResult: { data?: unknown; error?: unknown }) {
  const chain = mockChain(bookingResult)
  return { client: { from: vi.fn(() => chain) }, chain }
}

function makeAdminMock(opts: {
  event?: { data: unknown; error?: unknown }
  profile?: { data: unknown; error?: unknown }
  sessionIdUpdate?: { data: unknown; error?: unknown }
}) {
  const eventFetchChain = mockChain(opts.event ?? { data: null, error: { message: 'not found' } })
  const profileFetchChain = mockChain(
    opts.profile ?? { data: null, error: { message: 'not found' } },
  )
  const sessionIdUpdateChain = mockChain(
    opts.sessionIdUpdate ?? { data: { id: 'bk-1' }, error: null },
  )

  const bookingsUpdateSpy = vi.fn((payload: Record<string, unknown>) => {
    void payload
    return sessionIdUpdateChain
  })

  const from = vi.fn((table: string) => {
    if (table === 'events') return { select: vi.fn(() => eventFetchChain) }
    if (table === 'profiles') return { select: vi.fn(() => profileFetchChain) }
    if (table === 'bookings') return { update: bookingsUpdateSpy }
    throw new Error(`makeAdminMock: unexpected table "${table}"`)
  })

  return {
    client: { from },
    from,
    eventFetchChain,
    profileFetchChain,
    sessionIdUpdateChain,
    bookingsUpdateSpy,
  }
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const FUTURE_ISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const PAST_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

function bookingFixture(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'bk-1',
      user_id: 'user-1',
      event_id: 'evt-1',
      status: 'pending_payment',
      is_admin_hold: false,
      price_at_booking: 2000,
      booking_fee_pence: 60,
      stripe_checkout_session_id: 'cs_old_abc',
      ...overrides,
    },
    error: null,
  }
}

const VALID_EVENT = {
  data: {
    title: 'Wine Tasting at The Connaught',
    slug: 'wine-tasting',
    date_time: FUTURE_ISO,
    is_cancelled: false,
    deleted_at: null,
  },
  error: null,
}

const VALID_PROFILE = {
  data: { full_name: 'Amaya Kaur', email: 'amaya@example.com' },
  error: null,
}

beforeEach(() => {
  mockEnsureStripeCustomer.mockReset().mockResolvedValue('cus_mock')
  mockCreateBookingCheckoutSession.mockReset().mockResolvedValue({
    sessionId: 'cs_new_abc',
    url: 'https://checkout.stripe.test/cs_new_abc',
  })
  mockSentryCapture.mockReset()
  mockCreateAdminClient.mockClear()
  stripeHandle = { client: { checkout: { sessions: { expire: vi.fn().mockResolvedValue({}) } } } }
  // Default admin handle — overridden per-test where the event/profile
  // fetch needs a different shape.
  adminHandle = makeAdminMock({ event: VALID_EVENT, profile: VALID_PROFILE })
})

// ════════════════════════════════════════════════════════════════════════════
// Input validation
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — input validation', () => {
  it('returns "Booking ID is required" for an empty bookingId, without touching Supabase', async () => {
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', '')

    expect(result).toEqual({ success: false, error: 'Booking ID is required' })
    expect(client.from).not.toHaveBeenCalled()
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Booking lookup
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — booking lookup', () => {
  it('returns "Booking not found" when the fetch errors, without ever creating the admin client', async () => {
    const { client } = makeUserScopedClient({ data: null, error: { message: 'no row' } })

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-missing')

    expect(result).toEqual({ success: false, error: 'Booking not found' })
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns "Booking not found" when the row is soft-deleted (excluded by .is(deleted_at, null), so the fetch itself returns no row)', async () => {
    const { client, chain } = makeUserScopedClient({ data: null, error: null })

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'Booking not found' })
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Ownership (defence in depth on top of RLS) — spec §5.1 step 2
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — ownership', () => {
  it('INVARIANT: a user can never resume a booking belonging to a different user, even when the row is readable (defence-in-depth on top of RLS)', async () => {
    const { client } = makeUserScopedClient(bookingFixture({ user_id: 'user-OTHER' }))

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'Unauthorised' })
    // The explicit check must short-circuit BEFORE any admin/event/Stripe
    // work — an admin's own user-scoped client could otherwise read (but
    // must not be allowed to *resume*) someone else's booking.
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
    expect(mockEnsureStripeCustomer).not.toHaveBeenCalled()
    expect(mockCreateBookingCheckoutSession).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Admin holds are explicitly out of scope — spec §1.3 / §5.1 step 3
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — admin holds excluded', () => {
  it('INVARIANT: is_admin_hold=true is rejected with the "managed by our team" message and NEVER mints a session', async () => {
    const { client } = makeUserScopedClient(bookingFixture({ is_admin_hold: true }))

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({
      success: false,
      error:
        'This booking is managed by our team — check your email for a payment link, or contact us.',
    })
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
    expect(mockCreateBookingCheckoutSession).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Status guard — spec §5.1 step 4
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — status guard', () => {
  it.each(['confirmed', 'cancelled', 'waitlisted', 'no_show'])(
    'rejects a booking whose status is already "%s"',
    async (status) => {
      const { client } = makeUserScopedClient(bookingFixture({ status }))

      const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

      expect(result).toEqual({
        success: false,
        error: 'This booking is no longer awaiting payment.',
      })
      expect(mockCreateAdminClient).not.toHaveBeenCalled()
    },
  )
})

// ════════════════════════════════════════════════════════════════════════════
// Event guards — spec §5.1 step 5
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — event guards', () => {
  it('rejects when the event fetch errors', async () => {
    const { client } = makeUserScopedClient(bookingFixture())
    adminHandle = makeAdminMock({ event: { data: null, error: { message: 'no row' } } })

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'This event has been cancelled.' })
    expect(mockCreateBookingCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects a cancelled event', async () => {
    const { client } = makeUserScopedClient(bookingFixture())
    adminHandle = makeAdminMock({
      event: { data: { ...VALID_EVENT.data, is_cancelled: true }, error: null },
      profile: VALID_PROFILE,
    })

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'This event has been cancelled.' })
    expect(mockCreateBookingCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects a soft-deleted event', async () => {
    const { client } = makeUserScopedClient(bookingFixture())
    adminHandle = makeAdminMock({
      event: { data: { ...VALID_EVENT.data, deleted_at: '2026-08-01T00:00:00Z' }, error: null },
      profile: VALID_PROFILE,
    })

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'This event has been cancelled.' })
    expect(mockCreateBookingCheckoutSession).not.toHaveBeenCalled()
  })

  it('rejects an event that has already taken place', async () => {
    const { client } = makeUserScopedClient(bookingFixture())
    adminHandle = makeAdminMock({
      event: { data: { ...VALID_EVENT.data, date_time: PAST_ISO }, error: null },
      profile: VALID_PROFILE,
    })

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'This event has already taken place.' })
    expect(mockCreateBookingCheckoutSession).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Happy path
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — happy path', () => {
  it('mints a fresh session and returns {success:true, checkoutUrl}', async () => {
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: true, checkoutUrl: 'https://checkout.stripe.test/cs_new_abc' })
  })

  it('best-effort expires the PRIOR session before minting the new one', async () => {
    const { client } = makeUserScopedClient(bookingFixture({ stripe_checkout_session_id: 'cs_old_abc' }))

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(stripeHandle.client.checkout.sessions.expire).toHaveBeenCalledWith('cs_old_abc')
  })

  it('no stripe_checkout_session_id on the row -> skips the best-effort expire entirely', async () => {
    const { client } = makeUserScopedClient(bookingFixture({ stripe_checkout_session_id: null }))

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(stripeHandle.client.checkout.sessions.expire).not.toHaveBeenCalled()
  })

  it('creates the Stripe Customer via ensureStripeCustomer with the fetched profile', async () => {
    const { client } = makeUserScopedClient(bookingFixture())

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(mockEnsureStripeCustomer).toHaveBeenCalledWith(adminHandle.client, {
      userId: 'user-1',
      email: 'amaya@example.com',
      fullName: 'Amaya Kaur',
    })
  })

  it('mints the session against the BOOKING ROW\'S OWN price/fee snapshot, not a freshly recomputed one', async () => {
    const { client } = makeUserScopedClient(
      bookingFixture({ price_at_booking: 4200, booking_fee_pence: 99 }),
    )

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
    expect(sessionArgs.priceInPence).toBe(4200)
    expect(sessionArgs.bookingFeePence).toBe(99)
  })

  it('passes bookingId/userId/eventId/eventTitle/eventSlug/userEmail/stripeCustomerId through unchanged', async () => {
    const { client } = makeUserScopedClient(bookingFixture())

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
    expect(sessionArgs.bookingId).toBe('bk-1')
    expect(sessionArgs.userId).toBe('user-1')
    expect(sessionArgs.eventId).toBe('evt-1')
    expect(sessionArgs.eventTitle).toBe('Wine Tasting at The Connaught')
    expect(sessionArgs.eventSlug).toBe('wine-tasting')
    expect(sessionArgs.userEmail).toBe('amaya@example.com')
    expect(sessionArgs.stripeCustomerId).toBe('cus_mock')
  })

  it('success_url points at the booking-success page with the CHECKOUT_SESSION_ID placeholder', async () => {
    const { client } = makeUserScopedClient(bookingFixture())

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
    expect(sessionArgs.successUrl).toBe(
      'http://localhost:6500/events/wine-tasting/booking-success?session_id={CHECKOUT_SESSION_ID}',
    )
  })

  it('cancel_url carries NO `from=` param (plain self-service resume, not a claim or admin-hold origin — spec §5.1 step 8)', async () => {
    const { client } = makeUserScopedClient(bookingFixture())

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    const sessionArgs = mockCreateBookingCheckoutSession.mock.calls[0][0]
    expect(sessionArgs.cancelUrl).toBe('http://localhost:6500/events/wine-tasting?cancelled=1')
    expect(sessionArgs.cancelUrl).not.toContain('from=')
  })

  it('persists the NEW stripe_checkout_session_id, guarded by id AND status=pending_payment (optimistic guard)', async () => {
    const { client } = makeUserScopedClient(bookingFixture())

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(adminHandle.bookingsUpdateSpy).toHaveBeenCalledWith({
      stripe_checkout_session_id: 'cs_new_abc',
    })
    const updateChain = adminHandle.bookingsUpdateSpy.mock.results[0]!.value as {
      eq: ReturnType<typeof vi.fn>
    }
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'bk-1')
    expect(updateChain.eq).toHaveBeenCalledWith('status', 'pending_payment')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Concurrency race — spec §5.1 step 10 (the reaper's tick lands in the gap)
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — concurrency race on the optimistic guard', () => {
  it("INVARIANT: when the optimistic UPDATE matches zero rows, the resume is rejected with the 'just cancelled' message rather than handing back a checkoutUrl for a booking no longer in pending_payment", async () => {
    adminHandle = makeAdminMock({
      event: VALID_EVENT,
      profile: VALID_PROFILE,
      sessionIdUpdate: { data: null, error: { message: 'no rows matched' } },
    })
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({
      success: false,
      error:
        "This booking was just cancelled — check your bookings, or re-book if you'd still like to attend.",
    })
  })

  it('INVARIANT: the just-minted (NEW) session is best-effort expired on a concurrency loss — never left dangling as a live, unreferenced Checkout Session', async () => {
    adminHandle = makeAdminMock({
      event: VALID_EVENT,
      profile: VALID_PROFILE,
      sessionIdUpdate: { data: null, error: { message: 'no rows matched' } },
    })
    const { client } = makeUserScopedClient(bookingFixture({ stripe_checkout_session_id: 'cs_old_abc' }))

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    // Called TWICE: once (step 6) for the prior session, once (step 10
    // failure path) for the just-minted session that must now be
    // abandoned rather than handed to the client.
    expect(stripeHandle.client.checkout.sessions.expire).toHaveBeenCalledTimes(2)
    expect(stripeHandle.client.checkout.sessions.expire).toHaveBeenNthCalledWith(1, 'cs_old_abc')
    expect(stripeHandle.client.checkout.sessions.expire).toHaveBeenNthCalledWith(2, 'cs_new_abc')
  })

  it('a concurrency loss still returns the generic rejection even if the best-effort expire of the new session ALSO throws (non-blocking there too)', async () => {
    adminHandle = makeAdminMock({
      event: VALID_EVENT,
      profile: VALID_PROFILE,
      sessionIdUpdate: { data: null, error: { message: 'no rows matched' } },
    })
    stripeHandle.client.checkout.sessions.expire = vi
      .fn()
      .mockRejectedValue(new Error('Stripe outage'))
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('just cancelled')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Best-effort expiry tolerance — mirrors releaseAdminBookingHold's pattern
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — best-effort expiry of the OLD session never blocks resume', () => {
  it('the OLD session expire throwing (generic error) does NOT prevent minting + persisting the new session', async () => {
    stripeHandle.client.checkout.sessions.expire = vi
      .fn()
      .mockRejectedValue(new Error('ECONNRESET'))
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: true, checkoutUrl: 'https://checkout.stripe.test/cs_new_abc' })
    expect(mockCreateBookingCheckoutSession).toHaveBeenCalled()
  })

  it('a message matching /complete|paid|succeeded/i (no resource_missing code) escalates to Sentry with signal=possible_race_paid_after_resume', async () => {
    stripeHandle.client.checkout.sessions.expire = vi
      .fn()
      .mockRejectedValue(new Error('You cannot expire this session because it is already complete.'))
    const { client } = makeUserScopedClient(bookingFixture({ stripe_checkout_session_id: 'cs_old_abc' }))

    await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(mockSentryCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: {
          surface: 'resumePendingBookingCheckout',
          signal: 'possible_race_paid_after_resume',
        },
        extra: { bookingId: 'bk-1', sessionId: 'cs_old_abc' },
        level: 'error',
      }),
    )
  })

  it('INVARIANT: a resource_missing code is excluded from escalation even when the message text matches the heuristic (a stale/bad session id is not a payment race)', async () => {
    const err = Object.assign(new Error('No such checkout.session (already succeeded and purged)'), {
      code: 'resource_missing',
    })
    stripeHandle.client.checkout.sessions.expire = vi.fn().mockRejectedValue(err)
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result.success).toBe(true)
    expect(mockSentryCapture).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Stripe / profile failure -> generic error + Sentry (outer try/catch)
// ════════════════════════════════════════════════════════════════════════════

describe('resumePendingBookingCheckout — Stripe/profile failures', () => {
  it('missing profile email throws inside the try block and surfaces the generic error (defensive guard before Stripe is called)', async () => {
    adminHandle = makeAdminMock({
      event: VALID_EVENT,
      profile: { data: { full_name: 'No Email', email: null }, error: null },
    })
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'Could not start checkout. Please try again.' })
    expect(mockEnsureStripeCustomer).not.toHaveBeenCalled()
  })

  it('profile fetch erroring surfaces the same generic error', async () => {
    adminHandle = makeAdminMock({
      event: VALID_EVENT,
      profile: { data: null, error: { message: 'no row' } },
    })
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'Could not start checkout. Please try again.' })
  })

  it('ensureStripeCustomer throwing surfaces the generic error and reports to Sentry with surface=resumePendingBookingCheckout', async () => {
    mockEnsureStripeCustomer.mockRejectedValue(new Error('Stripe customer create failed'))
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'Could not start checkout. Please try again.' })
    expect(mockSentryCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { surface: 'resumePendingBookingCheckout' },
        extra: expect.objectContaining({ bookingId: 'bk-1', eventId: 'evt-1', userId: 'user-1' }),
        level: 'error',
      }),
    )
  })

  it('createBookingCheckoutSession throwing surfaces the generic error and never attempts the session-id persist', async () => {
    mockCreateBookingCheckoutSession.mockRejectedValue(new Error('Stripe API is down'))
    const { client } = makeUserScopedClient(bookingFixture())

    const result = await resumePendingBookingCheckout(client as never, 'user-1', 'bk-1')

    expect(result).toEqual({ success: false, error: 'Could not start checkout. Please try again.' })
    expect(adminHandle.bookingsUpdateSpy).not.toHaveBeenCalled()
  })
})
