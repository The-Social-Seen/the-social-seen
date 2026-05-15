/**
 * Unit tests for the orphan-pending_payment-booking reaper cron route.
 *
 * Coverage:
 *   - 4 auth branches (x-vercel-cron, valid Bearer, invalid/missing,
 *     misconfigured CRON_SECRET).
 *   - Predicate-shape pin: every Supabase chain call (.eq, .is, .is,
 *     .lt, .select) is asserted in order with exact args. The cutoff
 *     timestamp is asserted as ~35 min before now (1-second skew
 *     allowed for test execution time).
 *   - Success response shape { reaped, ranAt } across 1-row, multi-row,
 *     and zero-row outcomes.
 *   - Sentry instrumentation: addBreadcrumb on success, captureException
 *     on DB error — and crucially the OPPOSITE assertion in each
 *     direction (no breadcrumb on error path; no captureException on
 *     success path).
 *   - DB error path: 500 + 'Reaper run failed' text body.
 *   - Idempotency: zero rows reaped is a clean success, not an error.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Hoisted spy refs — used by both vi.mock factories below AND directly
// inspected from test bodies. Each chain method (.from, .update, .eq,
// .is, .lt) returns the same chain object so the builder composes;
// mockSelect is the terminator and is configured per-test to resolve
// with { data, error }.
const {
  mockFrom,
  mockUpdate,
  mockEq,
  mockIs,
  mockLt,
  mockSelect,
  mockBreadcrumb,
  mockCapture,
  mockCaptureMessage,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockUpdate: vi.fn(),
  mockEq: vi.fn(),
  mockIs: vi.fn(),
  mockLt: vi.fn(),
  mockSelect: vi.fn(),
  mockBreadcrumb: vi.fn(),
  mockCapture: vi.fn(),
  mockCaptureMessage: vi.fn(),
}))

// Shared chain object. Each spy is wired to return this chain so
// .from('bookings').update({...}).eq(...).is(...).is(...).lt(...)
// composes; .select(...) is the awaited terminator.
const chain = {
  from: mockFrom,
  update: mockUpdate,
  eq: mockEq,
  is: mockIs,
  lt: mockLt,
  select: mockSelect,
}
mockFrom.mockReturnValue(chain)
mockUpdate.mockReturnValue(chain)
mockEq.mockReturnValue(chain)
mockIs.mockReturnValue(chain)
mockLt.mockReturnValue(chain)

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => chain,
}))

vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: mockBreadcrumb,
  captureException: mockCapture,
  captureMessage: mockCaptureMessage,
}))

// Import the route AFTER vi.mock so the mocks are wired up.
import { GET } from '../route'

const SECRET = 'test-secret-32-bytes-or-whatever'

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost/api/admin/cron/reap-stale-bookings', {
    method: 'GET',
    headers,
  }) as unknown as NextRequest
}

beforeEach(() => {
  // Clear call history but preserve the mockReturnValue(chain) so the
  // builder still composes after a reset.
  mockFrom.mockClear()
  mockUpdate.mockClear()
  mockEq.mockClear()
  mockIs.mockClear()
  mockLt.mockClear()
  // Terminator: full reset, each test sets its own resolved value.
  mockSelect.mockReset()
  mockBreadcrumb.mockReset()
  mockCapture.mockReset()
  mockCaptureMessage.mockReset()
  process.env.CRON_SECRET = SECRET
})

// ── authentication ─────────────────────────────────────────────────────────

describe('authentication', () => {
  it('200 when x-vercel-cron header is set', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null })

    const res = await GET(makeRequest({ 'x-vercel-cron': '1' }))

    expect(res.status).toBe(200)
  })

  it('200 when Authorization: Bearer matches CRON_SECRET', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null })

    const res = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }))

    expect(res.status).toBe(200)
  })

  it('401 when neither x-vercel-cron nor valid Bearer', async () => {
    // Empty headers
    const res1 = await GET(makeRequest({}))
    expect(res1.status).toBe(401)
    expect(await res1.text()).toBe('Unauthorized')

    // Wrong Bearer token
    const res2 = await GET(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res2.status).toBe(401)
    expect(await res2.text()).toBe('Unauthorized')

    // Neither path should have reached the DB.
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('401 when CRON_SECRET is unset and no x-vercel-cron header', async () => {
    // Pin the safety guard: a misconfigured CRON_SECRET (env var
    // missing) MUST NOT auth-bypass. Without this guard a future
    // refactor that removes the `if (!expected) return false` line
    // would unconditionally allow `Bearer undefined` strings.
    delete process.env.CRON_SECRET

    const res = await GET(makeRequest({ authorization: 'Bearer anything' }))

    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
    // Pin the Sentry signal — a silent 401 is how the reaper sat dead
    // for 17 days after PR #77 (2026-05-15 Roza incident). Future
    // refactors must keep this alarm wired.
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining('CRON_SECRET'),
      expect.objectContaining({
        tags: expect.objectContaining({
          surface: 'reap-stale-bookings',
          reason: 'missing_secret',
        }),
        level: 'error',
      }),
    )
  })
})

// ── predicate shape and reaper behaviour ───────────────────────────────────

describe('predicate shape and reaper behaviour', () => {
  it('applies the four predicates in order and reaps the matching row', async () => {
    mockSelect.mockResolvedValue({ data: [{ id: 'bk_A' }], error: null })

    const beforeCall = Date.now()
    const res = await GET(makeRequest({ 'x-vercel-cron': '1' }))
    const afterCall = Date.now()

    expect(res.status).toBe(200)

    // .from('bookings')
    expect(mockFrom).toHaveBeenCalledTimes(1)
    expect(mockFrom).toHaveBeenCalledWith('bookings')

    // .update({ status: 'cancelled', cancelled_at: <ISO string> })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const updatePayload = mockUpdate.mock.calls[0][0]
    expect(updatePayload).toMatchObject({ status: 'cancelled' })
    expect(typeof updatePayload.cancelled_at).toBe('string')
    expect(() => new Date(updatePayload.cancelled_at).toISOString()).not.toThrow()

    // .eq('status', 'pending_payment')
    expect(mockEq).toHaveBeenCalledTimes(1)
    expect(mockEq).toHaveBeenCalledWith('status', 'pending_payment')

    // .is('stripe_payment_id', null) THEN .is('deleted_at', null) — order
    // matters because the chain is positional in the implementation.
    expect(mockIs).toHaveBeenCalledTimes(2)
    expect(mockIs.mock.calls[0]).toEqual(['stripe_payment_id', null])
    expect(mockIs.mock.calls[1]).toEqual(['deleted_at', null])

    // .lt('created_at', <cutoff ISO 35 min before now>)
    expect(mockLt).toHaveBeenCalledTimes(1)
    expect(mockLt.mock.calls[0][0]).toBe('created_at')
    const actualCutoff = new Date(mockLt.mock.calls[0][1] as string).getTime()
    const expectedCutoffLow = beforeCall - 35 * 60 * 1000
    const expectedCutoffHigh = afterCall - 35 * 60 * 1000
    expect(actualCutoff).toBeGreaterThanOrEqual(expectedCutoffLow)
    expect(actualCutoff).toBeLessThanOrEqual(expectedCutoffHigh)

    // .select('id')
    expect(mockSelect).toHaveBeenCalledTimes(1)
    expect(mockSelect).toHaveBeenCalledWith('id')

    // Response body { reaped: 1, ranAt: <ISO> }
    const body = await res.json()
    expect(body.reaped).toBe(1)
    expect(typeof body.ranAt).toBe('string')
    expect(() => new Date(body.ranAt).toISOString()).not.toThrow()
  })

  it('returns reaped count matching the data array length', async () => {
    mockSelect.mockResolvedValue({
      data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      error: null,
    })

    const res = await GET(makeRequest({ 'x-vercel-cron': '1' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reaped).toBe(3)
    expect(typeof body.ranAt).toBe('string')
  })

  it('returns reaped: 0 when no rows match (idempotency)', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null })

    const res = await GET(makeRequest({ 'x-vercel-cron': '1' }))

    // Zero matches is a clean success — the cron must be safely
    // re-entrant. A non-200 here would page the on-call engineer
    // on every scheduled tick for a non-event.
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reaped).toBe(0)
    expect(typeof body.ranAt).toBe('string')
  })
})

// ── error path and Sentry ──────────────────────────────────────────────────

describe('error path and Sentry', () => {
  it('returns 500 + captures Sentry on DB error', async () => {
    mockSelect.mockResolvedValue({
      data: null,
      error: { message: 'simulated DB failure' },
    })

    const res = await GET(makeRequest({ 'x-vercel-cron': '1' }))

    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Reaper run failed')

    // Sentry got the error.
    expect(mockCapture).toHaveBeenCalledTimes(1)
    const [capturedErr, capturedOptions] = mockCapture.mock.calls[0]
    expect(capturedErr).toBeInstanceOf(Error)
    expect((capturedErr as Error).message).toContain('simulated DB failure')
    expect(capturedOptions).toMatchObject({
      tags: { surface: 'reap-stale-bookings' },
      level: 'error',
    })
    // extra carries the timing context for incident triage.
    expect((capturedOptions as { extra: { startedAt: string; cutoff: string } }).extra)
      .toHaveProperty('startedAt')
    expect((capturedOptions as { extra: { startedAt: string; cutoff: string } }).extra)
      .toHaveProperty('cutoff')

    // Success-only breadcrumb must NOT fire on the error path —
    // otherwise the Sentry trace looks like a successful tick.
    expect(mockBreadcrumb).not.toHaveBeenCalled()
  })

  it('emits a Sentry breadcrumb on the success path', async () => {
    mockSelect.mockResolvedValue({ data: [{ id: 'a' }], error: null })

    const res = await GET(makeRequest({ 'x-vercel-cron': '1' }))

    expect(res.status).toBe(200)

    expect(mockBreadcrumb).toHaveBeenCalledTimes(1)
    const breadcrumb = mockBreadcrumb.mock.calls[0][0]
    expect(breadcrumb).toMatchObject({
      category: 'cron',
      message: 'reap-stale-bookings tick',
      level: 'info',
    })
    expect(breadcrumb.data).toMatchObject({ reaped: 1 })
    expect(typeof breadcrumb.data.cutoff).toBe('string')
    expect(typeof breadcrumb.data.startedAt).toBe('string')

    // Inverse guard: success path must NOT capture an exception.
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
