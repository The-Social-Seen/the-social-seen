/**
 * Direct unit-test coverage for src/lib/stripe/checkout.ts.
 *
 * Closes the test gap that allowed the 2026-04-27 stale-customer-id
 * outage to ship — actions.test.ts mocks both helpers wholesale, so
 * neither helper had real branch coverage. These tests pin all four
 * `ensureStripeCustomer` branches plus the `allow_promotion_codes`
 * field on `createBookingCheckoutSession`.
 *
 * The most important assertion is in test 4: when retrieve() throws a
 * non-resource_missing error, supabase.update MUST NOT be called with
 * { stripe_customer_id: null }. A regression that broadens the catch
 * would wipe valid ids during a transient Stripe outage. That guard
 * is the difference between the defensive fix and the bug it replaces.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureStripeCustomer, createBookingCheckoutSession } from '../checkout'

// Hoist the spy refs so vi.mock (also hoisted) can close over them and
// individual tests can configure return values per case.
const { mockRetrieve, mockCreateCustomer, mockCreateSession } = vi.hoisted(
  () => ({
    mockRetrieve: vi.fn(),
    mockCreateCustomer: vi.fn(),
    mockCreateSession: vi.fn(),
  }),
)

vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => ({
    customers: {
      retrieve: mockRetrieve,
      create: mockCreateCustomer,
    },
    checkout: {
      sessions: {
        create: mockCreateSession,
      },
    },
  }),
}))

// Hand-rolled Supabase admin client mock. Chains
//   .from('profiles').select(...).eq(...).single()        for the read
//   .from('profiles').update(payload).eq(...)              for the write
// `update` returns a SEPARATE object whose `.eq` is the awaited resolver,
// so we can assert on `supabase.update.mock.calls[i][0]` for the payload.
function makeSupabaseMock(profile: { stripe_customer_id: string | null }) {
  const updateSpy = vi.fn().mockResolvedValue({ error: null })
  const supabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: profile, error: null }),
    update: vi.fn().mockReturnValue({
      eq: updateSpy,
    }),
  }
  return { supabase, updateSpy }
}

const args = {
  userId: 'user-1',
  email: 'charlotte@example.com',
  fullName: 'Charlotte Example',
}

beforeEach(() => {
  mockRetrieve.mockReset()
  mockCreateCustomer.mockReset()
  mockCreateSession.mockReset()
})

describe('ensureStripeCustomer', () => {
  it('reuses a valid saved customer id without calling create', async () => {
    const { supabase } = makeSupabaseMock({ stripe_customer_id: 'cus_VALID' })
    mockRetrieve.mockResolvedValue({ id: 'cus_VALID', deleted: false })

    const result = await ensureStripeCustomer(
      supabase as unknown as SupabaseClient,
      args,
    )

    expect(result).toBe('cus_VALID')
    expect(mockRetrieve).toHaveBeenCalledTimes(1)
    expect(mockRetrieve).toHaveBeenCalledWith('cus_VALID')
    expect(mockCreateCustomer).not.toHaveBeenCalled()
    // No column write — the saved id was valid and reused as-is.
    expect(supabase.update).not.toHaveBeenCalled()
  })

  it('clears the stale id and creates fresh on resource_missing', async () => {
    const { supabase, updateSpy } = makeSupabaseMock({
      stripe_customer_id: 'cus_OLD',
    })
    mockRetrieve.mockRejectedValue(
      Object.assign(new Error('No such customer: cus_OLD'), {
        code: 'resource_missing',
      }),
    )
    mockCreateCustomer.mockResolvedValue({ id: 'cus_NEW' })

    const result = await ensureStripeCustomer(
      supabase as unknown as SupabaseClient,
      args,
    )

    expect(result).toBe('cus_NEW')
    expect(mockRetrieve).toHaveBeenCalledTimes(1)
    expect(mockRetrieve).toHaveBeenCalledWith('cus_OLD')
    expect(mockCreateCustomer).toHaveBeenCalledTimes(1)

    // Two writes happen: (1) stale-clear, (2) persist new id.
    expect(supabase.update).toHaveBeenCalledTimes(2)
    expect(supabase.update).toHaveBeenNthCalledWith(1, {
      stripe_customer_id: null,
    })
    expect(supabase.update).toHaveBeenNthCalledWith(2, {
      stripe_customer_id: 'cus_NEW',
    })
    // Both updates were filtered by id and awaited.
    expect(updateSpy).toHaveBeenCalledTimes(2)
    expect(updateSpy).toHaveBeenCalledWith('id', 'user-1')
  })

  it('clears the saved id when retrieve returns a DeletedCustomer', async () => {
    const { supabase } = makeSupabaseMock({ stripe_customer_id: 'cus_DELETED' })
    // Stripe responds 200 OK with a DeletedCustomer body — no exception
    // thrown, but the id is no longer usable. Behavioural twin of the
    // resource_missing branch.
    mockRetrieve.mockResolvedValue({ id: 'cus_DELETED', deleted: true })
    mockCreateCustomer.mockResolvedValue({ id: 'cus_FRESH' })

    const result = await ensureStripeCustomer(
      supabase as unknown as SupabaseClient,
      args,
    )

    expect(result).toBe('cus_FRESH')
    expect(mockCreateCustomer).toHaveBeenCalledTimes(1)
    // Same two-write pattern as the resource_missing case.
    expect(supabase.update).toHaveBeenCalledTimes(2)
    expect(supabase.update).toHaveBeenNthCalledWith(1, {
      stripe_customer_id: null,
    })
    expect(supabase.update).toHaveBeenNthCalledWith(2, {
      stripe_customer_id: 'cus_FRESH',
    })
  })

  it('propagates other Stripe errors WITHOUT clearing the column', async () => {
    // KEY regression-guard. A regression that broadens the catch (e.g.
    // catches all errors and treats them as stale) would wipe valid ids
    // during a transient Stripe outage. This test fails loudly if that
    // ever ships.
    const { supabase } = makeSupabaseMock({ stripe_customer_id: 'cus_VALID' })
    const rateLimitError = Object.assign(new Error('rate limited'), {
      code: 'rate_limit',
    })
    mockRetrieve.mockRejectedValue(rateLimitError)

    await expect(
      ensureStripeCustomer(supabase as unknown as SupabaseClient, args),
    ).rejects.toThrow('rate limited')

    expect(mockRetrieve).toHaveBeenCalledTimes(1)
    // No fallback create — the error short-circuited the function.
    expect(mockCreateCustomer).not.toHaveBeenCalled()
    // CRITICAL: column was NOT nulled. The saved id is preserved so the
    // next request (after the transient outage clears) can reuse it.
    expect(supabase.update).not.toHaveBeenCalled()
    // Belt-and-braces: even if some future change routes a write through
    // a different path, assert no payload of `{ stripe_customer_id: null }`
    // was ever sent.
    expect(supabase.update).not.toHaveBeenCalledWith({
      stripe_customer_id: null,
    })
  })

  it('creates a fresh customer when no saved id exists', async () => {
    const { supabase } = makeSupabaseMock({ stripe_customer_id: null })
    mockCreateCustomer.mockResolvedValue({ id: 'cus_FIRST' })

    const result = await ensureStripeCustomer(
      supabase as unknown as SupabaseClient,
      args,
    )

    expect(result).toBe('cus_FIRST')
    // No id to validate, so no retrieve round-trip.
    expect(mockRetrieve).not.toHaveBeenCalled()
    expect(mockCreateCustomer).toHaveBeenCalledTimes(1)
    expect(mockCreateCustomer).toHaveBeenCalledWith({
      email: 'charlotte@example.com',
      name: 'Charlotte Example',
      metadata: { supabase_user_id: 'user-1' },
    })
    // Single write — the persist of the fresh id.
    expect(supabase.update).toHaveBeenCalledTimes(1)
    expect(supabase.update).toHaveBeenCalledWith({
      stripe_customer_id: 'cus_FIRST',
    })
  })
})

describe('createBookingCheckoutSession', () => {
  it('passes allow_promotion_codes: true and pins the full session-create shape', async () => {
    mockCreateSession.mockResolvedValue({
      id: 'cs_TEST',
      url: 'https://checkout.stripe.com/test',
    })

    const result = await createBookingCheckoutSession({
      bookingId: 'booking-1',
      userId: 'user-1',
      userEmail: 'charlotte@example.com',
      eventId: 'event-1',
      eventTitle: 'Wine Tasting at The Connaught',
      eventSlug: 'wine-tasting-connaught',
      priceInPence: 4500,
      successUrl: 'https://thesocialseen.test/events/wine-tasting-connaught/booking-success',
      cancelUrl: 'https://thesocialseen.test/events/wine-tasting-connaught',
      stripeCustomerId: 'cus_VALID',
    })

    expect(result).toEqual({
      sessionId: 'cs_TEST',
      url: 'https://checkout.stripe.com/test',
    })

    expect(mockCreateSession).toHaveBeenCalledTimes(1)
    const sessionArgs = mockCreateSession.mock.calls[0][0]

    // The point of this PR: promotion codes enabled.
    expect(sessionArgs.allow_promotion_codes).toBe(true)

    // Representative existing fields — confirm the new field didn't
    // shoulder anything important out.
    expect(sessionArgs.mode).toBe('payment')
    expect(sessionArgs.customer).toBe('cus_VALID')
    expect(sessionArgs.success_url).toBe(
      'https://thesocialseen.test/events/wine-tasting-connaught/booking-success',
    )
    expect(sessionArgs.cancel_url).toBe(
      'https://thesocialseen.test/events/wine-tasting-connaught',
    )
    expect(sessionArgs.line_items).toHaveLength(1)
    expect(sessionArgs.line_items[0].price_data.currency).toBe('gbp')
    expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(4500)
    expect(sessionArgs.metadata).toEqual({
      booking_id: 'booking-1',
      user_id: 'user-1',
      event_id: 'event-1',
      event_slug: 'wine-tasting-connaught',
    })
    expect(sessionArgs.payment_intent_data.metadata).toEqual({
      booking_id: 'booking-1',
      user_id: 'user-1',
      event_id: 'event-1',
    })
    expect(typeof sessionArgs.expires_at).toBe('number')

    // Sabotage-check: pin the entire top-level key set. A future
    // contributor who silently adds (or removes) a top-level field on
    // the session-create call will fail this assertion. Intentional
    // additions (e.g. customer_creation, automatic_tax, tax_id_collection)
    // SHOULD update this expected list as part of the same PR — that's
    // the contract this test enforces.
    expect(Object.keys(sessionArgs).sort()).toEqual([
      'allow_promotion_codes',
      'cancel_url',
      'customer',
      'customer_update',
      'expires_at',
      'line_items',
      'metadata',
      'mode',
      'payment_intent_data',
      'success_url',
    ])
  })
})
