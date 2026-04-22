import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockAdminFrom = vi.fn()
const mockAdminRpc = vi.fn()
const mockSignOut = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser, signOut: mockSignOut },
      from: mockFrom,
    }),
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mockAdminFrom,
    rpc: mockAdminRpc,
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// next/navigation.redirect throws (intentionally) to stop execution. Mock
// to a controlled error we can assert on.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

// Stripe Customer deletion path (I1 fix).
const mockStripeCustomersDel = vi.fn()
vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => ({
    customers: { del: mockStripeCustomersDel },
  }),
}))

// Sentry used on Stripe-delete failure.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import { deleteMyAccount, exportMyData } from '../privacy-actions'

// ── Helpers ──────────────────────────────────────────────────────────────

function authenticate(userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId, email: 'u@example.com' } },
    error: null,
  })
}

function unauth() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Not authenticated' },
  })
}

function mockChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete', 'eq', 'neq', 'is', 'not', 'in',
    'ilike', 'single', 'maybeSingle', 'order', 'limit',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ════════════════════════════════════════════════════════════════════════
// exportMyData
// ════════════════════════════════════════════════════════════════════════

describe('exportMyData', () => {
  it('throws when the user is not authenticated', async () => {
    unauth()
    await expect(exportMyData()).rejects.toThrow(/authentication/i)
  })

  it('returns a JSON string containing profile + bookings + reviews + interests', async () => {
    authenticate('user-1')
    // 4 parallel queries — each resolves to a canned row.
    mockFrom.mockImplementation(() => {
      // All four Promise.all branches share the same mock response
      // shape; the Server Action unpacks by `res.data`. Returning a
      // single `data` works because it's just for JSON export.
      return mockChain({
        data: { hello: 'world' },
        error: null,
      })
    })

    const result = await exportMyData()
    const parsed = JSON.parse(result)

    expect(parsed.export_metadata).toBeTruthy()
    expect(parsed.export_metadata.user_id).toBe('user-1')
    expect(parsed).toHaveProperty('profile')
    expect(parsed).toHaveProperty('bookings')
    expect(parsed).toHaveProperty('reviews')
    expect(parsed).toHaveProperty('interests')
  })

  it('includes a human-readable note about what is and isn\u2019t included', async () => {
    authenticate('user-1')
    mockFrom.mockImplementation(() => mockChain({ data: [], error: null }))
    const result = await exportMyData()
    expect(result).toMatch(/not included/i)
  })
})

// ════════════════════════════════════════════════════════════════════════
// deleteMyAccount
// ════════════════════════════════════════════════════════════════════════

describe('deleteMyAccount', () => {
  it('rejects unauthenticated callers', async () => {
    unauth()
    const result = await deleteMyAccount('delete my account')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authentication/i)
  })

  it('rejects the wrong confirmation phrase', async () => {
    authenticate('user-1')
    const result = await deleteMyAccount('yes delete')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/type "delete my account"/i)
  })

  it('refuses when there\u2019s a paid booking within 48 hours', async () => {
    authenticate('user-1')
    const inThirtyHours = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString()
    mockFrom.mockImplementation(() =>
      mockChain({
        data: [
          { id: 'bk-1', event: { date_time: inThirtyHours } },
        ],
        error: null,
      }),
    )
    const result = await deleteMyAccount('delete my account')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/paid booking within 48 hours/i)
  })

  it('happy path (free-event member): cancels bookings, scrubs notifications, clears interests, soft-deletes profile, signs out + redirects', async () => {
    authenticate('user-1')
    // User-scoped `.from('bookings')` — no imminent paid bookings.
    mockFrom.mockImplementation(() => mockChain({ data: [], error: null }))

    // Admin client chain — tracks which tables were touched + in what
    // order. Three .from('profiles') calls now:
    //   1. full_name lookup (for the body-scrub pass in sanitise_user_notifications)
    //   2. stripe_customer_id lookup (Stripe Customer deletion branch)
    //   3. profile anonymisation UPDATE
    const tablesTouched: string[] = []
    let profilesCallIdx = 0
    mockAdminFrom.mockImplementation((table: string) => {
      tablesTouched.push(table)
      if (table === 'profiles') {
        profilesCallIdx++
        if (profilesCallIdx === 1) {
          return mockChain({
            data: { full_name: 'Test User' },
            error: null,
          })
        }
        if (profilesCallIdx === 2) {
          // Free-event member — no Stripe Customer triggered.
          return mockChain({ data: { stripe_customer_id: null }, error: null })
        }
        // Anonymise UPDATE — no selected data needed.
        return mockChain({ data: null, error: null })
      }
      return mockChain({ data: null, error: null })
    })
    mockAdminRpc.mockResolvedValue({ data: 0, error: null })
    mockSignOut.mockResolvedValue({ error: null })

    try {
      await deleteMyAccount('delete my account')
    } catch (err) {
      expect((err as Error).message).toMatch(/REDIRECT:\/\?account_deleted=1/)
    }

    // Sequence: bookings cancel → profiles (full_name lookup) →
    // rpc (scrub) → user_interests → profiles (stripe lookup) →
    // newsletter_subscribers (Batch 9 Brevo mirror) →
    // profiles (anonymise).
    expect(tablesTouched).toEqual([
      'bookings',
      'profiles',
      'user_interests',
      'profiles',
      'newsletter_subscribers',
      'profiles',
    ])
    expect(mockAdminRpc).toHaveBeenCalledWith('sanitise_user_notifications', {
      p_user_id: 'user-1',
      p_user_email: 'u@example.com',
      p_user_full_name: 'Test User',
    })
    // Free-event member — no Stripe Customer to delete.
    expect(mockStripeCustomersDel).not.toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })

  it('paid-event member: deletes Stripe Customer before soft-deleting profile', async () => {
    authenticate('user-1')
    mockFrom.mockImplementation(() => mockChain({ data: [], error: null }))

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        // stripe_customer_id present → triggers the Stripe deletion branch.
        return mockChain({
          data: { stripe_customer_id: 'cus_abc123' },
          error: null,
        })
      }
      return mockChain({ data: null, error: null })
    })
    mockAdminRpc.mockResolvedValue({ data: 0, error: null })
    mockStripeCustomersDel.mockResolvedValue({ deleted: true, id: 'cus_abc123' })
    mockSignOut.mockResolvedValue({ error: null })

    try {
      await deleteMyAccount('delete my account')
    } catch (err) {
      expect((err as Error).message).toMatch(/REDIRECT:/)
    }

    expect(mockStripeCustomersDel).toHaveBeenCalledWith('cus_abc123')
  })

  it('continues soft-delete even when Stripe Customer deletion throws (logged to Sentry)', async () => {
    authenticate('user-1')
    mockFrom.mockImplementation(() => mockChain({ data: [], error: null }))

    // Capture the anonymisation UPDATE so we can assert it still ran.
    let profilesUpdateCalled = false
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        const chain = mockChain({
          data: { stripe_customer_id: 'cus_abc123' },
          error: null,
        })
        chain.update = vi.fn((_data) => {
          profilesUpdateCalled = true
          return chain
        })
        return chain
      }
      return mockChain({ data: null, error: null })
    })
    mockAdminRpc.mockResolvedValue({ data: 0, error: null })
    mockStripeCustomersDel.mockRejectedValue(new Error('Stripe is down'))
    mockSignOut.mockResolvedValue({ error: null })

    try {
      await deleteMyAccount('delete my account')
    } catch (err) {
      // Expected REDIRECT — swallow.
      expect((err as Error).message).toMatch(/REDIRECT:/)
    }

    expect(mockStripeCustomersDel).toHaveBeenCalled()
    // Soft-delete still ran even though Stripe failed — the app-side
    // erasure is the primary concern.
    expect(profilesUpdateCalled).toBe(true)
  })
})
