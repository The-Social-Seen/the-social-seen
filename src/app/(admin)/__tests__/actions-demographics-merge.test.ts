/**
 * Server-Action coverage for the admin-gender-batch-rpc feature — the
 * demographics (gender) merge onto `getEventBookings` via the new
 * `fetchDemographicsMap()` helper / `admin_get_user_demographics` RPC, per
 * docs/SYSTEM-DESIGN-admin-gender-batch-rpc.md §5 and §7 item 12.
 *
 * ── Relationship to the sibling phone-merge coverage ─────────────────────────
 * `actions-phone-merge.test.ts` already pins the equivalent contract for
 * `phone_number` / `admin_get_user_phones` on this same action (merge, null
 * fallback, single-RPC-call, de-dupe, error-surfaces, auth rejects). This file
 * mirrors that exact test shape for the NEW `gender` / `admin_get_user_
 * demographics` pairing, and additionally asserts the two RPCs run
 * side-by-side without one masking the other (spec §5.2 — "profileIds is
 * computed once and reused for both maps").
 *
 * ── INVARIANT this file defends ──────────────────────────────────────────────
 * `gender` is admin-only PII. It must (a) only ever reach `getEventBookings`
 * via the `admin_get_user_demographics` RPC — NEVER a `.select()` — (b) be
 * merged by id with a `?? null` fallback so an absent/soft-deleted/gender-
 * unset member shows no gender (literal `null`, never `undefined` and never a
 * thrown error from a partial map), and (c) be unreachable by unauthenticated
 * or non-admin callers (the action throws before any merge is attempted).
 *
 * NOTE: these tests mock Supabase. The DB-layer admin gate on the RPC itself
 * is asserted statically (plus skip-marked DB-integration cases) in
 * src/lib/supabase/__tests__/migration-admin-get-user-demographics-batch.test.ts.
 * Together those plus this file cover the data contract end-to-end at the
 * layers available without a live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock (identical shape to actions-phone-merge.test.ts) ───────────

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

// ── Chainable PostgREST builder mock ─────────────────────────────────────────

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

/**
 * Admin caller whose first `.from('profiles')` is the requireAdmin role
 * lookup; every subsequent `.from(...)` returns `tableData`. `rpc()` is
 * dispatched by function name so the phone and demographics RPCs can be
 * stubbed independently (mirrors real behaviour where both are called
 * side-by-side in getEventBookings).
 */
function mockAdmin(
  tableData: unknown[],
  opts: { phones?: unknown[]; demographics?: unknown[] } = {}
) {
  const { phones = [], demographics = [] } = opts
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
  let call = 0
  mockFrom.mockImplementation(() => {
    call++
    if (call === 1) return makeChain({ data: { role: 'admin' } })
    return makeChain({ data: tableData, error: null })
  })
  mockRpc.mockImplementation((fn: string) => {
    if (fn === 'admin_get_user_phones') return Promise.resolve({ data: phones, error: null })
    if (fn === 'admin_get_user_demographics')
      return Promise.resolve({ data: demographics, error: null })
    return Promise.resolve({ data: [], error: null })
  })
}

function mockMember() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mockFrom.mockImplementation(() => makeChain({ data: { role: 'member' } }))
  mockRpc.mockResolvedValue({ data: [], error: null })
}

function mockUnauthenticated() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'no session' },
  })
  mockFrom.mockImplementation(() => makeChain({ data: null }))
  mockRpc.mockResolvedValue({ data: [], error: null })
}

/** Convenience: the demographics RPC calls (or empty array). */
function demographicsRpcCalls() {
  return mockRpc.mock.calls.filter((c) => c[0] === 'admin_get_user_demographics')
}

function phoneRpcCalls() {
  return mockRpc.mock.calls.filter((c) => c[0] === 'admin_get_user_phones')
}

const bookingRow = (id: string, profileId: string, name = 'Charlotte') => ({
  id,
  status: 'confirmed',
  waitlist_position: null,
  price_at_booking: 0,
  booking_fee_pence: 0,
  stripe_fee_pence: 0,
  booked_at: '2026-04-10T12:00:00.000Z',
  created_at: '2026-04-10T12:00:00.000Z',
  stripe_payment_id: null,
  stripe_refund_id: null,
  refunded_amount_pence: null,
  cancelled_at: null,
  cancellation_reason: null,
  profile: { id: profileId, full_name: name, email: `${name}@x.com`, avatar_url: null },
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// getEventBookings — gender merge onto profile.gender
// ════════════════════════════════════════════════════════════════════════════

describe('getEventBookings — demographics (gender) merge', () => {
  it('merges the RPC gender onto each row.profile.gender', async () => {
    mockAdmin(
      [bookingRow('bk-1', 'usr-1', 'Charlotte'), bookingRow('bk-2', 'usr-2', 'James')],
      {
        demographics: [
          { user_id: 'usr-1', gender: 'female', age_range: '30-34' },
          { user_id: 'usr-2', gender: 'male', age_range: '35-39' },
        ],
      }
    )
    const rows = await getEventBookings('evt-1')
    expect(rows[0].profile?.gender).toBe('female')
    expect(rows[1].profile?.gender).toBe('male')
  })

  it('INVARIANT: an attendee the RPC did NOT return gets gender === null (not undefined, not thrown)', async () => {
    mockAdmin(
      [bookingRow('bk-1', 'usr-1'), bookingRow('bk-2', 'usr-2', 'James')],
      // usr-2 omitted: e.g. soft-deleted profile, or gender never set →
      // admin_get_user_demographics returns no row for it.
      { demographics: [{ user_id: 'usr-1', gender: 'female', age_range: '30-34' }] }
    )
    const rows = await getEventBookings('evt-1')
    expect(rows[1].profile?.gender).toBeNull()
    expect(rows[1].profile?.gender).not.toBeUndefined()
  })

  it('INVARIANT: a member with gender NULL from the RPC also collapses to null', async () => {
    // The RPC returns a row (id present) but gender null (member skipped the
    // demographics banner) — must stay null, not become undefined or "null".
    mockAdmin(
      [bookingRow('bk-1', 'usr-1')],
      { demographics: [{ user_id: 'usr-1', gender: null, age_range: null }] }
    )
    const rows = await getEventBookings('evt-1')
    expect(rows[0].profile?.gender).toBeNull()
  })

  it('INVARIANT: age_range from the RPC is NOT surfaced onto profile (deliberately unused, spec §1.2)', async () => {
    mockAdmin(
      [bookingRow('bk-1', 'usr-1')],
      { demographics: [{ user_id: 'usr-1', gender: 'non_binary', age_range: '40-44' }] }
    )
    const rows = await getEventBookings('evt-1')
    expect(rows[0].profile?.gender).toBe('non_binary')
    expect(rows[0].profile).not.toHaveProperty('age_range')
  })

  it('INVARIANT: makes EXACTLY ONE admin_get_user_demographics RPC call (no N+1), keyed by the attendee ids', async () => {
    mockAdmin([bookingRow('bk-1', 'usr-1'), bookingRow('bk-2', 'usr-2', 'James')], {})
    await getEventBookings('evt-1')
    const calls = demographicsRpcCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('admin_get_user_demographics')
    expect(calls[0][1]).toEqual({ target_user_ids: ['usr-1', 'usr-2'] })
  })

  it('de-dupes ids before the RPC when a user appears on multiple booking rows', async () => {
    // A member can have e.g. a cancelled + a confirmed row → same id twice.
    mockAdmin(
      [bookingRow('bk-1', 'usr-1'), bookingRow('bk-2', 'usr-1')],
      { demographics: [{ user_id: 'usr-1', gender: 'female', age_range: '30-34' }] }
    )
    await getEventBookings('evt-1')
    expect(demographicsRpcCalls()[0][1]).toEqual({ target_user_ids: ['usr-1'] })
  })

  it('throws (does not silently blank genders) when the demographics RPC errors', async () => {
    // fail-closed: surfaces an authz/infra regression rather than masking it.
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
    let call = 0
    mockFrom.mockImplementation(() => {
      call++
      if (call === 1) return makeChain({ data: { role: 'admin' } })
      return makeChain({ data: [bookingRow('bk-1', 'usr-1')], error: null })
    })
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'admin_get_user_phones') return Promise.resolve({ data: [], error: null })
      if (fn === 'admin_get_user_demographics')
        return Promise.resolve({ data: null, error: { message: 'forbidden' } })
      return Promise.resolve({ data: [], error: null })
    })
    await expect(getEventBookings('evt-1')).rejects.toThrow(
      /Failed to fetch member demographics: forbidden/
    )
  })

  it('SECURITY: rejects a non-admin (member-role) caller before any merge', async () => {
    mockMember()
    await expect(getEventBookings('evt-1')).rejects.toThrow('Admin access required')
    expect(demographicsRpcCalls()).toHaveLength(0)
  })

  it('SECURITY: rejects an unauthenticated caller', async () => {
    mockUnauthenticated()
    await expect(getEventBookings('evt-1')).rejects.toThrow('Authentication required')
    expect(demographicsRpcCalls()).toHaveLength(0)
  })

  it('runs the phone AND demographics RPCs side-by-side off the SAME de-duped id set, with neither masking the other', async () => {
    // Spec §5.2: profileIds is computed once and reused for both maps. This
    // guards against a future refactor that accidentally short-circuits one
    // RPC when the other errors, or diverges the id sets passed to each.
    mockAdmin(
      [bookingRow('bk-1', 'usr-1', 'Charlotte'), bookingRow('bk-2', 'usr-2', 'James')],
      {
        phones: [{ user_id: 'usr-1', phone_number: '+447700900111' }],
        demographics: [{ user_id: 'usr-2', gender: 'male', age_range: '35-39' }],
      }
    )
    const rows = await getEventBookings('evt-1')

    // usr-1: phone present, gender absent (null).
    expect(rows[0].profile?.phone_number).toBe('+447700900111')
    expect(rows[0].profile?.gender).toBeNull()
    // usr-2: phone absent (null), gender present — proves the two maps are
    // independent and both apply correctly to the same row.
    expect(rows[1].profile?.phone_number).toBeNull()
    expect(rows[1].profile?.gender).toBe('male')

    expect(phoneRpcCalls()).toHaveLength(1)
    expect(demographicsRpcCalls()).toHaveLength(1)
    expect(phoneRpcCalls()[0][1]).toEqual({ target_user_ids: ['usr-1', 'usr-2'] })
    expect(demographicsRpcCalls()[0][1]).toEqual({ target_user_ids: ['usr-1', 'usr-2'] })
  })

  it('an attendee list with zero bookings makes no demographics RPC call (userIds.length === 0 short-circuit)', async () => {
    mockAdmin([], {})
    const rows = await getEventBookings('evt-1')
    expect(rows).toEqual([])
    expect(demographicsRpcCalls()).toHaveLength(0)
  })
})
