import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock — mirrors actions-write.test.ts pattern ─────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: vi.fn(),
    }),
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { banMember, reinstateMember, setNoShow, suspendMember } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateAdmin(userId = '11111111-1111-4111-8111-111111111111', role: 'admin' | 'member' = 'admin') {
  // requireAdmin() flows: auth.getUser → profiles.select('role').eq('id',...).single
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
  // First chain call resolves with the admin's own role.
  mockChain({ data: { role }, error: null })
}

function mockChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'single', 'maybeSingle',
    'order', 'limit', 'gt', 'gte', 'lte', 'or', 'in',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  mockFrom.mockReturnValueOnce(chain)
  return chain
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks (vs clearAllMocks) also drains queued `mockReturnValueOnce`
  // entries so a later test doesn't inherit the previous test's mock stack.
  vi.resetAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Moderation: banMember / suspendMember / reinstateMember
// ════════════════════════════════════════════════════════════════════════════

describe('member moderation actions', () => {
  it('suspendMember writes audit columns + status=suspended', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    // Target member fetch → returns non-admin role
    mockChain({ data: { id: '22222222-2222-4222-8222-222222222222', role: 'member' }, error: null })
    let capturedUpdate: Record<string, unknown> | null = null
    // Final UPDATE chain — capture the payload.
    const updateChain: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const m of ['select','update','eq','is','single','maybeSingle']) {
      updateChain[m] = vi.fn().mockReturnValue(updateChain)
    }
    updateChain.update = vi.fn((data: Record<string, unknown>) => {
      capturedUpdate = data
      return updateChain
    })
    updateChain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    )
    mockFrom.mockReturnValueOnce(updateChain)

    const result = await suspendMember('22222222-2222-4222-8222-222222222222', 'no-shows x3')
    expect(result).toEqual({ success: true })
    expect(capturedUpdate).toEqual(
      expect.objectContaining({
        status: 'suspended',
        moderation_reason: 'no-shows x3',
        moderation_by: '11111111-1111-4111-8111-111111111111',
      }),
    )
    expect((capturedUpdate as unknown as { moderation_at: string }).moderation_at).toBeTruthy()
  })

  it('banMember sets status=banned', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    mockChain({ data: { id: '22222222-2222-4222-8222-222222222222', role: 'member' }, error: null })
    let capturedUpdate: Record<string, unknown> | null = null
    const updateChain: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const m of ['select','update','eq','is','single','maybeSingle']) {
      updateChain[m] = vi.fn().mockReturnValue(updateChain)
    }
    updateChain.update = vi.fn((data: Record<string, unknown>) => {
      capturedUpdate = data
      return updateChain
    })
    updateChain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    )
    mockFrom.mockReturnValueOnce(updateChain)

    const result = await banMember('22222222-2222-4222-8222-222222222222', 'fraudulent activity')
    expect(result).toEqual({ success: true })
    expect((capturedUpdate as unknown as { status: string }).status).toBe('banned')
  })

  it('reinstateMember sets status=active with a default audit reason', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    mockChain({ data: { id: '22222222-2222-4222-8222-222222222222', role: 'member' }, error: null })
    let capturedUpdate: Record<string, unknown> | null = null
    const updateChain: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const m of ['select','update','eq','is','single','maybeSingle']) {
      updateChain[m] = vi.fn().mockReturnValue(updateChain)
    }
    updateChain.update = vi.fn((data: Record<string, unknown>) => {
      capturedUpdate = data
      return updateChain
    })
    updateChain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    )
    mockFrom.mockReturnValueOnce(updateChain)

    const result = await reinstateMember('22222222-2222-4222-8222-222222222222')
    expect(result).toEqual({ success: true })
    expect((capturedUpdate as unknown as { status: string }).status).toBe('active')
    expect((capturedUpdate as unknown as { moderation_reason: string }).moderation_reason).toBe(
      'Reinstated',
    )
  })

  it('rejects self-moderation', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    const result = await suspendMember('11111111-1111-4111-8111-111111111111', 'attempting to ban myself')
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toMatch(/own account/i)
    // No profiles lookup or UPDATE should fire.
    expect(mockFrom).toHaveBeenCalledTimes(1) // only the requireAdmin role check
  })

  it('rejects moderating another admin', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    mockChain({ data: { id: '33333333-3333-4333-8333-333333333333', role: 'admin' }, error: null })
    const result = await suspendMember('33333333-3333-4333-8333-333333333333', 'trying to suspend a peer')
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toMatch(/admin/i)
  })

  it('rejects too-short reasons', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    const result = await suspendMember('22222222-2222-4222-8222-222222222222', 'ab')
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toMatch(/reason/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// No-show toggle
// ════════════════════════════════════════════════════════════════════════════

describe('setNoShow', () => {
  it('flips confirmed → no_show for a past event', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    // Booking fetch — past event.
    mockChain({
      data: {
        id: 'bk-1',
        status: 'confirmed',
        event: { date_time: '2020-01-01T00:00:00Z' },
      },
      error: null,
    })
    // UPDATE chain — capture target status.
    let capturedUpdate: Record<string, unknown> | null = null
    const updateChain: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const m of ['select','update','eq','is','single']) {
      updateChain[m] = vi.fn().mockReturnValue(updateChain)
    }
    updateChain.update = vi.fn((data: Record<string, unknown>) => {
      capturedUpdate = data
      return updateChain
    })
    updateChain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    )
    mockFrom.mockReturnValueOnce(updateChain)

    const result = await setNoShow('bk-1', true)
    expect(result).toEqual({ success: true })
    expect((capturedUpdate as unknown as { status: string }).status).toBe('no_show')
  })

  it('refuses to mark no-show on an upcoming event', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    mockChain({
      data: {
        id: 'bk-1',
        status: 'confirmed',
        event: { date_time: new Date(Date.now() + 86400000).toISOString() }, // tomorrow
      },
      error: null,
    })
    const result = await setNoShow('bk-1', true)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toMatch(/past event/i)
  })

  it('refuses to mark no-show on a non-confirmed booking', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    mockChain({
      data: {
        id: 'bk-1',
        status: 'waitlisted',
        event: { date_time: '2020-01-01T00:00:00Z' },
      },
      error: null,
    })
    const result = await setNoShow('bk-1', true)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toMatch(/confirmed bookings/i)
  })

  it('reverts no_show → confirmed when called with on=false', async () => {
    authenticateAdmin('11111111-1111-4111-8111-111111111111')
    mockChain({
      data: {
        id: 'bk-1',
        status: 'no_show',
        event: { date_time: '2020-01-01T00:00:00Z' },
      },
      error: null,
    })
    let capturedUpdate: Record<string, unknown> | null = null
    const updateChain: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const m of ['select','update','eq','is','single']) {
      updateChain[m] = vi.fn().mockReturnValue(updateChain)
    }
    updateChain.update = vi.fn((data: Record<string, unknown>) => {
      capturedUpdate = data
      return updateChain
    })
    updateChain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null }),
    )
    mockFrom.mockReturnValueOnce(updateChain)

    const result = await setNoShow('bk-1', false)
    expect(result).toEqual({ success: true })
    expect((capturedUpdate as unknown as { status: string }).status).toBe('confirmed')
  })
})
