/**
 * getEventBookings — collapse to one row per attendee.
 *
 * A member can have multiple booking rows for the same event (e.g.
 * cancelled a checkout, then rebooked and got confirmed) — each row
 * preserves its own Stripe/refund trail and is never deleted or merged at
 * the DB layer. But the admin bookings list previously displayed every
 * row, so the same person could show up under both the "Cancelled" and
 * "Confirmed" tabs simultaneously — confusing ("did she cancel or
 * confirm?"). getEventBookings now collapses to the single most recent
 * row per attendee (by created_at) before returning, so every tab/view
 * reflects only where each person currently stands. This is a display-only
 * change — no row is ever deleted, updated, or merged; the underlying
 * historical rows are untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: mockRpc,
    })
  ),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/utils/slugify', () => ({
  slugify: vi.fn((s: string) => s.toLowerCase()),
  uniqueSlug: vi.fn(async (s: string) => s.toLowerCase()),
}))

import { getEventBookings } from '../admin/actions'

function makeChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of [
    'select', 'eq', 'neq', 'is', 'or', 'order', 'single', 'maybeSingle',
    'insert', 'update', 'delete', 'in', 'limit', 'gt', 'gte', 'lte',
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ error: null, ...response })
  )
  return chain
}

function mockAdmin(tableData: unknown[]) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
  let call = 0
  mockFrom.mockImplementation(() => {
    call++
    if (call === 1) return makeChain({ data: { role: 'admin' } })
    return makeChain({ data: tableData, error: null })
  })
  mockRpc.mockResolvedValue({ data: [], error: null })
}

/** Query already orders by created_at ascending — fixtures follow that. */
const bookingRow = (
  id: string,
  profileId: string,
  status: string,
  createdAt: string,
  name = 'Marcella'
) => ({
  id,
  status,
  waitlist_position: null,
  price_at_booking: 1000,
  booking_fee_pence: 40,
  stripe_fee_pence: 0,
  booked_at: createdAt,
  created_at: createdAt,
  stripe_payment_id: null,
  stripe_refund_id: null,
  refunded_amount_pence: null,
  cancelled_at: status === 'cancelled' ? createdAt : null,
  cancellation_reason: null,
  profile: { id: profileId, full_name: name, email: `${name}@x.com`, avatar_url: null },
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getEventBookings — collapse to one row per attendee', () => {
  it('an attendee with a cancelled attempt followed by a later confirmed booking shows ONLY the confirmed row', async () => {
    mockAdmin([
      bookingRow('bk-1', 'usr-1', 'cancelled', '2026-08-13T09:53:58Z'),
      bookingRow('bk-2', 'usr-1', 'confirmed', '2026-08-13T10:21:11Z'),
    ])
    const rows = await getEventBookings('evt-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('bk-2')
    expect(rows[0].status).toBe('confirmed')
  })

  it('an attendee who cancelled and never rebooked still shows their cancelled row (not silently dropped)', async () => {
    mockAdmin([bookingRow('bk-1', 'usr-1', 'cancelled', '2026-08-13T09:53:58Z')])
    const rows = await getEventBookings('evt-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('cancelled')
  })

  it('does not collapse rows belonging to DIFFERENT attendees', async () => {
    mockAdmin([
      bookingRow('bk-1', 'usr-1', 'confirmed', '2026-08-13T09:00:00Z', 'Marcella'),
      bookingRow('bk-2', 'usr-2', 'confirmed', '2026-08-13T09:05:00Z', 'Saurabh'),
    ])
    const rows = await getEventBookings('evt-1')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.profile?.full_name).sort()).toEqual(['Marcella', 'Saurabh'])
  })

  it('with 3+ attempts for the same attendee, only the most recent (last created_at) survives', async () => {
    mockAdmin([
      bookingRow('bk-1', 'usr-1', 'cancelled', '2026-05-20T11:00:00Z'),
      bookingRow('bk-2', 'usr-1', 'cancelled', '2026-08-13T09:56:18Z'),
      bookingRow('bk-3', 'usr-1', 'confirmed', '2026-08-13T10:21:28Z'),
    ])
    const rows = await getEventBookings('evt-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('bk-3')
  })

  it('a statusFilter is applied to the COLLAPSED list, not the raw rows — filtering to "cancelled" must NOT return someone whose current status is confirmed', async () => {
    const rows = [
      bookingRow('bk-1', 'usr-1', 'cancelled', '2026-08-13T09:53:58Z'),
      bookingRow('bk-2', 'usr-1', 'confirmed', '2026-08-13T10:21:11Z'),
    ]
    mockAdmin(rows)
    const cancelledTab = await getEventBookings('evt-1', 'cancelled')
    expect(cancelledTab).toHaveLength(0)

    // Fresh mock — requireAdmin's own .from() call is per-invocation.
    mockAdmin(rows)
    const confirmedTab = await getEventBookings('evt-1', 'confirmed')
    expect(confirmedTab).toHaveLength(1)
    expect(confirmedTab[0].id).toBe('bk-2')
  })

  it('rows with no resolvable profile are never collapsed against each other', async () => {
    const orphan = (id: string, createdAt: string) => ({
      id,
      status: 'confirmed',
      waitlist_position: null,
      price_at_booking: 1000,
      booking_fee_pence: 40,
      stripe_fee_pence: 0,
      booked_at: createdAt,
      created_at: createdAt,
      stripe_payment_id: null,
      stripe_refund_id: null,
      refunded_amount_pence: null,
      cancelled_at: null,
      cancellation_reason: null,
      profile: null,
    })
    mockAdmin([orphan('bk-1', '2026-08-13T09:00:00Z'), orphan('bk-2', '2026-08-13T09:05:00Z')])
    const rows = await getEventBookings('evt-1')
    expect(rows).toHaveLength(2)
  })
})
