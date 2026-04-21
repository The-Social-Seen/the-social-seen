import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
// All mocks must be set up before importing the route module.

const constructEventMock = vi.fn()

vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
  }),
}))

// Supabase admin client builder — chainable query mock.
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
    client: {
      from: vi.fn(() => chain),
    },
  }
}

let supabaseHandle: ReturnType<typeof makeSupabaseMock>

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => supabaseHandle.client,
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
}))

// ── Helpers ────────────────────────────────────────────────────────────────

async function importRoute() {
  vi.resetModules()
  supabaseHandle = makeSupabaseMock()
  const mod = await import('../route')
  return mod.POST
}

// The route handler's NextRequest parameter is structurally compatible
// with a plain Request for the APIs this route uses (text(), headers).
// Cast to satisfy the type checker.
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/stripe/webhook', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock')
    constructEventMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects when stripe-signature header is missing', async () => {
    const POST = await importRoute()
    const res = await POST(makeRequest('{}', null))
    expect(res.status).toBe(400)
  })

  it('rejects when the signature does not verify', async () => {
    const POST = await importRoute()
    constructEventMock.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature')
    })
    const res = await POST(makeRequest('{}', 't=1,v1=bad'))
    expect(res.status).toBe(401)
  })

  it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock')
    // STRIPE_WEBHOOK_SECRET deliberately unset
    const POST = await importRoute()
    const res = await POST(makeRequest('{}', 't=1,v1=anything'))
    expect(res.status).toBe(500)
  })

  it('ACKs 200 for an event type we do not handle', async () => {
    const POST = await importRoute()
    constructEventMock.mockReturnValue({
      type: 'customer.subscription.created',
      data: { object: {} },
    })
    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ received: true })
  })

  it('confirms the matching booking on checkout.session.completed', async () => {
    const POST = await importRoute()

    // Arrange: the chain returns a confirmed booking row from the UPDATE.
    supabaseHandle = makeSupabaseMock()
    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'b1', user_id: 'u1', event_id: 'e1' },
      error: null,
    })
    // The email-send path triggers two SELECTs (profile, event); both
    // resolve to minimal valid rows so the handler completes.
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'Charlotte', email: 'ch@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'Wine & Wisdom',
        slug: 'wine-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Cellar',
        venue_address: '1 Bank End',
        venue_revealed: true,
      },
      error: null,
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    // Assert: the UPDATE was gated on status=pending_payment (idempotency).
    expect(supabaseHandle.chain.update).toHaveBeenCalledWith({
      status: 'confirmed',
      stripe_payment_id: 'pi_456',
      // P2-7b: position is preserved through pending_payment so we can
      // restore it on Stripe failure; webhook clears it once the seat
      // is confirmed and queue position is no longer meaningful.
      waitlist_position: null,
    })
    expect(supabaseHandle.chain.eq).toHaveBeenCalledWith('id', 'b1')
    expect(supabaseHandle.chain.eq).toHaveBeenCalledWith('status', 'pending_payment')
  })

  it('treats duplicate payment_intent (23505) as already-processed', async () => {
    const POST = await importRoute()

    supabaseHandle = makeSupabaseMock()
    // Simulate the UNIQUE constraint trip from a webhook re-delivery.
    supabaseHandle.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    // Still 200 — Stripe must not retry a duplicate.
    expect(res.status).toBe(200)
  })

  it('no-ops when booking_id metadata is missing', async () => {
    const POST = await importRoute()

    supabaseHandle = makeSupabaseMock()
    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: {}, // no booking_id
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    // No DB update attempted.
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
  })

  it('ignores payment_status other than "paid"', async () => {
    const POST = await importRoute()

    supabaseHandle = makeSupabaseMock()
    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'unpaid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
  })

  it('returns 200 even when the DB handler throws (no Stripe retries for app bugs)', async () => {
    const POST = await importRoute()

    supabaseHandle = makeSupabaseMock()
    // Force the UPDATE to blow up unexpectedly.
    supabaseHandle.maybeSingle.mockRejectedValue(new Error('db is on fire'))

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
  })

  // ── charge.refunded (P2-7b) ────────────────────────────────────────────

  function chargeRefundedEvent(opts: { refundId: string; paymentIntent: string; amount: number }) {
    return {
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_123',
          payment_intent: opts.paymentIntent,
          refunds: {
            data: [
              {
                id: opts.refundId,
                amount: opts.amount,
                created: 1_700_000_000,
              },
            ],
          },
        },
      },
    }
  }

  it('charge.refunded: reconciles an admin-dashboard refund to its booking', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // 1st maybeSingle: idempotency check (no existing row with this refund_id).
    // 2nd maybeSingle: find-by-payment-intent (returns the booking).
    supabaseHandle.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // idempotency: none
      .mockResolvedValueOnce({
        data: { id: 'b1', status: 'confirmed' },
        error: null,
      })

    constructEventMock.mockReturnValue(
      chargeRefundedEvent({ refundId: 're_abc', paymentIntent: 'pi_456', amount: 3500 }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    // UPDATE sets status=cancelled and writes refund audit fields.
    const updateCalls = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls.length).toBe(1)
    const payload = updateCalls[0][0]
    expect(payload.status).toBe('cancelled')
    expect(payload.stripe_refund_id).toBe('re_abc')
    expect(payload.refunded_amount_pence).toBe(3500)
    expect(payload.cancelled_at).toBeTruthy()
    expect(payload.refunded_at).toBeTruthy()
  })

  it('charge.refunded: no-ops when the refund id has already been reconciled', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // Idempotency check returns an existing row — we've seen this refund before.
    supabaseHandle.maybeSingle.mockResolvedValueOnce({
      data: { id: 'b1' },
      error: null,
    })

    constructEventMock.mockReturnValue(
      chargeRefundedEvent({ refundId: 're_abc', paymentIntent: 'pi_456', amount: 3500 }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    // No UPDATE should fire when we short-circuit on idempotency.
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
  })

  it('charge.refunded: no-ops when no matching booking is found for the PaymentIntent', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // idempotency: none
      .mockResolvedValueOnce({ data: null, error: null }) // find-by-PI: none

    constructEventMock.mockReturnValue(
      chargeRefundedEvent({ refundId: 're_xyz', paymentIntent: 'pi_unknown', amount: 3500 }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
  })

  it('charge.refunded: picks the latest refund when multiple are in the payload', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { id: 'b1', status: 'confirmed' },
        error: null,
      })

    constructEventMock.mockReturnValue({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_123',
          payment_intent: 'pi_456',
          refunds: {
            data: [
              { id: 're_old', amount: 1000, created: 1_500_000_000 },
              { id: 're_new', amount: 3500, created: 1_700_000_000 },
            ],
          },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    const payload = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.stripe_refund_id).toBe('re_new')
    expect(payload.refunded_amount_pence).toBe(3500)
  })

  it('charge.refunded: no-ops when the payload has no refunds', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    constructEventMock.mockReturnValue({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_123',
          payment_intent: 'pi_456',
          refunds: { data: [] },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
  })
})
