// getAdminMembers coverage — pins the W1 GRANT-allowed column-list
// contract that the post-W1 admin/members page depends on. The
// regression these tests guard against is the 42501 throw recorded
// in the conversation diagnosis: PR #61 narrowed the `authenticated`
// SELECT GRANT on `public.profiles` to a column allow-list, but
// `getAdminMembers` was still calling `.select('*')`. The W1
// regression test in migration-w1-demographics.test.ts then
// allowlisted this file based on the (incorrect) belief that
// PostgREST silently omits ungranted columns under SELECT *. It
// doesn't — it raises permission-denied. /admin/members threw on
// every load between PR #61 and its fix.
//
// Test 1 pins the no-wildcard contract.
// Test 2 pins the positive list — every column the admin list
//   needs must appear (mirror of the post-W1 GRANT).
// Test 3 pins the negative list — five revoked columns must NEVER
//   appear, even if a future contributor "just adds phone_number
//   because admins need it." This is the load-bearing assertion.
// Test 4 is a smoke test for the overall flow (booking aggregation).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────
//
// Single mocked createServerClient. requireAdmin() runs a
// .from('profiles').select('role').eq().single() first; getAdminMembers
// then runs its own .from('profiles').select(<list>).is().order() chain
// plus a .from('bookings').select().in().is() chain. The mock
// distinguishes the requireAdmin profiles call (first .from('profiles'))
// from the list query (second .from('profiles')) by tracking call count.

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

import { getAdminMembers } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateAdmin(userId = 'admin-uuid') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

/**
 * Build a chainable mock that mirrors PostgREST's builder pattern.
 * Every method returns the chain itself; awaiting the chain resolves
 * with the supplied response. Spies on every method are accessible
 * via the returned object (e.g. `chain.select.mock.calls[0][0]`).
 */
function mockChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'in', 'or',
    'order', 'limit', 'single', 'maybeSingle',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // PostgREST builders are thenable — `await query` triggers the
  // resolver. This is what makes `const { data, error } = await query`
  // work in the SUT.
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ error: null, ...response }),
  )
  return chain
}

/**
 * Wires up the three .from() calls getAdminMembers makes:
 *   1. .from('profiles') → requireAdmin role lookup (returns admin)
 *   2. .from('profiles') → the list query whose .select() arg we want
 *      to inspect
 *   3. .from('bookings') → booking aggregation (only reached if
 *      profiles list returns ≥1 row)
 *
 * Returns the captured listChain so individual tests can inspect
 * `listChain.select.mock.calls[0][0]`.
 */
function wireSupabase(opts: {
  profilesList?: unknown[]
  bookings?: unknown[]
} = {}) {
  let profilesCallCount = 0
  let listChain: ReturnType<typeof mockChain> | undefined
  mockFrom.mockImplementation((table: string) => {
    if (table === 'profiles') {
      profilesCallCount += 1
      if (profilesCallCount === 1) {
        // requireAdmin path
        return mockChain({ data: { role: 'admin' } })
      }
      // getAdminMembers list path
      listChain = mockChain({ data: opts.profilesList ?? [], error: null })
      return listChain
    }
    if (table === 'bookings') {
      return mockChain({ data: opts.bookings ?? [], error: null })
    }
    return mockChain({ data: null, error: null })
  })
  return {
    getListChain: () => {
      if (!listChain) throw new Error('list chain not yet captured — did getAdminMembers run?')
      return listChain
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Test 1 — no wildcard select
// ════════════════════════════════════════════════════════════════════════════

describe('getAdminMembers — no wildcard select', () => {
  it('does not pass a wildcard to .select()', async () => {
    authenticateAdmin()
    const wired = wireSupabase()

    await getAdminMembers()

    const selectArg = wired.getListChain().select.mock.calls[0]?.[0]
    expect(typeof selectArg).toBe('string')
    expect((selectArg as string).includes('*')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Test 2 — every GRANT-allowed column is requested
// ════════════════════════════════════════════════════════════════════════════
//
// This list mirrors the post-W1 `authenticated` SELECT GRANT on
// public.profiles (migration 20260503000001 minus the phone_number
// revoke from 20260503000002). If the GRANT changes, this list must
// be updated in lockstep with src/app/(admin)/admin/actions.ts. The
// MembersTable view reads the columns the admin UI actually displays;
// the rest are kept in the payload for parity with what the
// authenticated role can see.

const REQUIRED_COLUMNS = [
  // Identity / display
  'id', 'email', 'full_name', 'avatar_url', 'job_title', 'company',
  'industry', 'bio', 'linkedin_url', 'role',
  // Onboarding / lifecycle
  'onboarding_complete', 'referral_source', 'status',
  // Contact + consent
  'email_consent', 'email_verified', 'sms_consent',
  // Moderation audit
  'moderation_reason', 'moderation_at', 'moderation_by',
  // Timestamps
  'created_at', 'updated_at', 'deleted_at',
] as const

describe('getAdminMembers — required columns', () => {
  it('requests every GRANT-allowed column', async () => {
    authenticateAdmin()
    const wired = wireSupabase()

    await getAdminMembers()

    const selectArg = wired.getListChain().select.mock.calls[0]?.[0] as string
    const requested = selectArg
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)

    for (const col of REQUIRED_COLUMNS) {
      expect(
        requested,
        `Expected post-W1 GRANT column "${col}" to be requested by getAdminMembers .select(). If you removed it from the GRANT, also update src/app/(admin)/admin/actions.ts.`,
      ).toContain(col)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Test 3 — no revoked column may appear (load-bearing)
// ════════════════════════════════════════════════════════════════════════════
//
// These five columns are revoked from `authenticated`. Selecting any
// of them via the user-scoped client raises 42501 and breaks
// /admin/members. Reads of these columns must go through SECURITY
// DEFINER helpers (admin_get_demographics, admin_get_user_phone) or
// the service-role admin client.
//
// A future contributor adding "just phone_number, admins need it"
// to the .select() string fails this test — by design.

const REVOKED_COLUMNS: ReadonlyArray<{ column: string; revokedIn: string }> = [
  { column: 'gender',                     revokedIn: '20260503000001 (add_profile_demographics)' },
  { column: 'age_range',                  revokedIn: '20260503000001 (add_profile_demographics)' },
  { column: 'phone_number',               revokedIn: '20260503000002 (narrow_phone_number_grant)' },
  { column: 'stripe_customer_id',         revokedIn: '20260423000003' },
  { column: 'profile_nudge_email_sent_at', revokedIn: '20260426000001' },
]

describe('getAdminMembers — revoked columns', () => {
  it('does NOT request any column revoked from authenticated', async () => {
    authenticateAdmin()
    const wired = wireSupabase()

    await getAdminMembers()

    const selectArg = wired.getListChain().select.mock.calls[0]?.[0] as string
    const requested = selectArg
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)

    for (const { column, revokedIn } of REVOKED_COLUMNS) {
      expect(
        requested,
        `Column "${column}" was revoked from the authenticated role in migration ${revokedIn} and MUST NOT appear in getAdminMembers .select(). Selecting it raises PostgREST 42501 and breaks /admin/members. Use the SECURITY DEFINER helpers (admin_get_demographics, admin_get_user_phone) for per-row reads instead.`,
      ).not.toContain(column)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Test 4 — smoke: end-to-end aggregation
// ════════════════════════════════════════════════════════════════════════════
//
// Less load-bearing than 1–3 — the column-list contract is what the
// regression hinged on. This test just verifies the overall pipeline
// (profiles → bookings → MemberWithStats[]) still runs and aggregates.

describe('getAdminMembers — booking aggregation', () => {
  it('returns rows shaped as MemberWithStats with booking aggregates', async () => {
    authenticateAdmin()
    wireSupabase({
      profilesList: [
        {
          id: 'usr-1',
          email: 'charlotte@example.com',
          full_name: 'Charlotte Davis',
          role: 'member',
          status: 'active',
          created_at: '2026-01-15T00:00:00.000Z',
        },
      ],
      bookings: [
        { user_id: 'usr-1', status: 'confirmed' },
        { user_id: 'usr-1', status: 'confirmed' },
        { user_id: 'usr-1', status: 'waitlisted' },
      ],
    })

    const result = await getAdminMembers()

    expect(result).toHaveLength(1)
    expect(typeof result[0].events_attended).toBe('number')
    expect(result[0].events_attended).toBe(2)
    expect(result[0].events_confirmed).toBe(2)
    expect(result[0].events_waitlisted).toBe(1)
  })
})
