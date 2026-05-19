import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Admin-mid-checkout race (spec §9 "Extra" — `SYSTEM-DESIGN-refund-fee-
 * deduction.md`). Scenario:
 *
 *   1. User starts paid booking → row is `pending_payment`, Stripe
 *      Checkout Session is live.
 *   2. Admin cancels the event via `cancelEventAndRefundBookings` →
 *      pending_payment rows flipped to `cancelled` by that loop.
 *   3. User completes Stripe Checkout (the Session was still live).
 *      Stripe POSTs `checkout.session.completed` to our webhook.
 *   4. Our webhook UPDATE has `.eq('status', 'pending_payment')` —
 *      the row is now `cancelled`, so it no-ops. The user has been
 *      charged but no booking is confirmed.
 *
 * There's no clean fix at this layer (the architect deliberately
 * scoped this as a documented runbook entry — see
 * docs/FOLLOW-UPS.md "Admin-cancel orphan-payment race"). The MINIMUM
 * we need is a clear breadcrumb in the webhook logs so the operator
 * can find the orphan within the 30-minute Stripe Checkout Session
 * window and issue a manual refund.
 *
 * This test asserts:
 *   1. The webhook returns 200 (Stripe must not retry).
 *   2. No booking row is incorrectly mutated.
 *   3. The webhook logs the surface so the operator's runbook can
 *      grep for it.
 *
 * If this test fails after a refactor, the operator just lost their
 * only signal of an orphan payment.
 */

const constructEventMock = vi.fn()
const paymentIntentsRetrieveMock = vi.fn()

vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
    paymentIntents: { retrieve: paymentIntentsRetrieveMock },
  }),
}))

function makeSupabaseMock() {
  const single = vi.fn()
  const maybeSingle = vi.fn()
  const chain: Record<string, unknown> = {
    update: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single,
    maybeSingle,
  }
  return {
    chain,
    single,
    maybeSingle,
    client: { from: vi.fn(() => chain) },
  }
}

let supabaseHandle: ReturnType<typeof makeSupabaseMock>

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => supabaseHandle.client,
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
}))

async function importRoute() {
  vi.resetModules()
  supabaseHandle = makeSupabaseMock()
  const mod = await import('../route')
  return mod.POST
}

function makeRequest(body: string, sig: string | null): import('next/server').NextRequest {
  const headers = new Headers()
  if (sig) headers.set('stripe-signature', sig)
  const req = new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body,
    headers,
  })
  return req as unknown as import('next/server').NextRequest
}

describe('POST /api/stripe/webhook — admin-mid-checkout race (spec §9)', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock')
    constructEventMock.mockReset()
    paymentIntentsRetrieveMock.mockReset()
    paymentIntentsRetrieveMock.mockResolvedValue({
      id: 'pi_default',
      latest_charge: null,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('webhook UPDATE no-ops when the booking has already been admin-cancelled', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // The race condition: admin flipped status to 'cancelled' moments
    // before this webhook fires. Our UPDATE has
    // .eq('status', 'pending_payment') so it no-ops and maybeSingle
    // returns no row.
    supabaseHandle.maybeSingle.mockResolvedValue({
      data: null, // no row matched the pending_payment filter
      error: null,
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_orphan',
          payment_status: 'paid',
          payment_intent: 'pi_orphan',
          metadata: { booking_id: 'bk-already-cancelled' },
        },
      },
    })

    // Spy on console.info to capture the breadcrumb the runbook
    // depends on. console.info is the level used by the webhook for
    // "no pending_payment booking matched" — explicitly logged so
    // operators can grep for it.
    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))

    // 1. Webhook returns 200 — Stripe MUST NOT retry. Retries would
    //    spawn the breadcrumb N times and possibly land on a different
    //    Postgres connection where the race resolves differently.
    expect(res.status).toBe(200)

    // 2. Sanity: the UPDATE was attempted (the .eq('status',
    //    'pending_payment') is the optimistic guard), but no UPDATE
    //    happened on a row not in pending_payment state.
    expect(supabaseHandle.chain.update).toHaveBeenCalledTimes(1)

    // 3. The breadcrumb is in the logs. The runbook entry says the
    //    operator should look for this exact message after an admin
    //    event-cancel within the last 30 minutes.
    const allLogCalls = consoleInfoSpy.mock.calls.flat().join(' ')
    expect(allLogCalls).toMatch(/no pending_payment booking matched/i)
    expect(allLogCalls).toMatch(/bk-already-cancelled/)

    consoleInfoSpy.mockRestore()
  })

  it('webhook still returns 200 and logs even when payment_intent_data carries fee metadata', async () => {
    // Edge case: the original Checkout Session was created with
    // metadata.booking_fee_pence (refund-fee-deduction always adds
    // this). The admin-cancel race doesn't care about the fee, but
    // future code that branches on it must NOT crash the webhook —
    // a crash would mean Stripe retries, fee metadata gets re-emitted,
    // and the breadcrumb fires twice with no operator value.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_orphan_fee',
          payment_status: 'paid',
          payment_intent: 'pi_orphan_fee',
          metadata: {
            booking_id: 'bk-fee-orphan',
            user_id: 'user-1',
            event_id: 'evt-1',
            event_slug: 'wine-tasting',
            booking_fee_pence: '60', // Stripe coerces metadata to strings
          },
        },
      },
    })

    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    const logged = consoleInfoSpy.mock.calls.flat().join(' ')
    expect(logged).toMatch(/no pending_payment booking matched/i)
    expect(logged).toMatch(/bk-fee-orphan/)

    consoleInfoSpy.mockRestore()
  })

  it('webhook does not re-confirm a booking already in the cancelled state', async () => {
    // INVARIANT: even if the .eq('status', 'pending_payment') filter
    // is ever weakened (e.g. a future refactor switches to
    // .neq('status', 'cancelled')), the booking that was admin-cancelled
    // MUST NOT be flipped to 'confirmed' by the webhook. This test
    // would fail loudly if a refactor of the webhook handler removed
    // the status guard.
    //
    // We assert that the .eq('status', 'pending_payment') filter is
    // present on the update chain — that's the load-bearing guarantee.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_3',
          payment_status: 'paid',
          payment_intent: 'pi_3',
          metadata: { booking_id: 'bk-3' },
        },
      },
    })

    await POST(makeRequest('{}', 't=1,v1=sig'))

    // The .eq guard is wired: assert .eq was called with the literal
    // status filter. If a refactor drops this guard, the assertion
    // fails. (Other filters in the call chain are fine — we just need
    // the status one to be present.)
    const eqCalls = (supabaseHandle.chain.eq as ReturnType<typeof vi.fn>).mock.calls
    const hasStatusFilter = eqCalls.some(
      ([col, val]) => col === 'status' && val === 'pending_payment',
    )
    expect(hasStatusFilter).toBe(true)
  })
})
