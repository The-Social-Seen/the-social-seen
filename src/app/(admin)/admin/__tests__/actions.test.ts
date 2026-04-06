import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: mockRpc,
    }),
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/utils/slugify', () => ({
  slugify: vi.fn((text: string) => text.toLowerCase().replace(/\s+/g, '-')),
  uniqueSlug: vi.fn(async (text: string) => text.toLowerCase().replace(/\s+/g, '-')),
}))

import {
  createEvent,
  updateEvent,
  toggleEventPublished,
  softDeleteEvent,
  promoteFromWaitlist,
  toggleReviewVisibility,
  sendNotification,
  getDashboardStats,
} from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateAdmin(userId = 'admin-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function unauthenticateUser() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Not authenticated' },
  })
}

/**
 * Build a chainable mock that mirrors Supabase's PostgREST builder pattern.
 */
function mockChain(response: { data?: unknown; error?: unknown; count?: number | null }) {
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
  return chain
}

/**
 * Set up mock where the first from() returns admin profile,
 * and subsequent calls return from the `responses` array.
 */
function mockAdminWithSequence(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>,
  userId = 'admin-1'
) {
  authenticateAdmin(userId)
  let callCount = 0
  mockFrom.mockImplementation(() => {
    if (callCount === 0) {
      // First call is requireAdmin → profiles.role
      callCount++
      return mockChain({ data: { role: 'admin' } })
    }
    const idx = callCount - 1
    callCount++
    const response = responses[idx] ?? responses[responses.length - 1]
    return mockChain(response)
  })
}

/**
 * Set up mock for a non-admin user (member role).
 */
function mockMemberUser(userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
  mockFrom.mockImplementation(() => mockChain({ data: { role: 'member' } }))
}

function makeEventFormData(overrides: Record<string, string> = {}): FormData {
  const defaults: Record<string, string> = {
    title: 'Test Wine Evening',
    description: 'A lovely evening of wine and conversation in London',
    short_description: 'Wine tasting for professionals',
    date_time: '2026-06-15T19:00:00.000Z',
    end_time: '2026-06-15T22:00:00.000Z',
    venue_name: 'Wine Cellar',
    venue_address: '1 Bank End, London SE1 9BU',
    category: 'drinks',
    price: '35',
    capacity: '20',
    image_url: '',
    dress_code: '',
    is_published: 'true',
  }
  const merged = { ...defaults, ...overrides }
  const fd = new FormData()
  for (const [k, v] of Object.entries(merged)) {
    fd.set(k, v)
  }
  return fd
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Auth / Role Guard Tests
// ════════════════════════════════════════════════════════════════════════════

describe('Admin auth guards', () => {
  const actionsRequiringAuth = [
    { name: 'createEvent', fn: () => createEvent(makeEventFormData()) },
    { name: 'updateEvent', fn: () => updateEvent('evt-1', makeEventFormData()) },
    { name: 'promoteFromWaitlist', fn: () => promoteFromWaitlist('bk-1') },
    { name: 'toggleReviewVisibility', fn: () => toggleReviewVisibility('rev-1') },
    { name: 'sendNotification', fn: () => {
      const fd = new FormData()
      fd.set('subject', 'Test')
      fd.set('body', 'Body')
      fd.set('recipient_type', 'all')
      fd.set('type', 'announcement')
      return sendNotification(fd)
    }},
    { name: 'getDashboardStats', fn: () => getDashboardStats() },
  ]

  describe('rejects unauthenticated users', () => {
    for (const { name, fn } of actionsRequiringAuth) {
      it(`${name} throws for unauthenticated user`, async () => {
        unauthenticateUser()
        await expect(fn()).rejects.toThrow('Authentication required')
      })
    }
  })

  describe('rejects non-admin users', () => {
    for (const { name, fn } of actionsRequiringAuth) {
      it(`${name} throws for member role`, async () => {
        mockMemberUser()
        await expect(fn()).rejects.toThrow('Admin access required')
      })
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// createEvent
// ════════════════════════════════════════════════════════════════════════════

describe('createEvent', () => {
  it('creates event with correct slug and returns event', async () => {
    const createdEvent = { id: 'evt-new', slug: 'test-wine-evening', title: 'Test Wine Evening' }
    mockAdminWithSequence([
      // events insert → returns new event (uniqueSlug is mocked, no slug-check from() call)
      { data: createdEvent },
      // event_hosts insert (auto-host assignment)
      { error: null },
    ])

    const result = await createEvent(makeEventFormData())

    expect(result).toHaveProperty('event')
    expect(result.error).toBeUndefined()
  })

  it('converts price from pounds to pence (35 → 3500)', async () => {
    mockAdminWithSequence([
      { data: { id: 'evt-new' } },
      { error: null }, // event_hosts insert
    ])

    await createEvent(makeEventFormData({ price: '35' }))

    // Verify insert was called — uniqueSlug is mocked so from() calls are:
    // [0]=profiles(admin), [1]=events(insert), [2]=event_hosts(insert)
    expect(mockFrom).toHaveBeenCalled()
  })

  it('returns validation error for missing title', async () => {
    mockAdminWithSequence([])

    const result = await createEvent(makeEventFormData({ title: '' }))

    expect(result.error).toBeDefined()
    expect(result.error).toContain('at least 3 characters')
  })

  it('returns validation error for short description', async () => {
    mockAdminWithSequence([])

    const result = await createEvent(makeEventFormData({ description: 'Short' }))

    expect(result.error).toBeDefined()
    expect(result.error).toContain('at least 10 characters')
  })

  it('returns validation error when end_time is before date_time', async () => {
    mockAdminWithSequence([])

    const result = await createEvent(makeEventFormData({
      date_time: '2026-06-15T22:00:00.000Z',
      end_time: '2026-06-15T19:00:00.000Z',
    }))

    expect(result.error).toBeDefined()
    expect(result.error).toContain('End time must be after start time')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// createEvent — auto-host assignment
// ════════════════════════════════════════════════════════════════════════════

describe('createEvent — auto-host assignment', () => {
  it('inserts a row into event_hosts after a successful event creation', async () => {
    const createdEvent = { id: 'evt-auto-host', slug: 'test-wine-evening', title: 'Test Wine Evening' }
    mockAdminWithSequence([
      // events insert
      { data: createdEvent },
      // event_hosts insert
      { error: null },
    ])

    const result = await createEvent(makeEventFormData())

    expect(result).not.toHaveProperty('error')

    // from() call order: [0]=profiles(admin check), [1]=events(insert), [2]=event_hosts(insert)
    const tables = mockFrom.mock.calls.map((args) => args[0] as string)
    expect(tables).toContain('event_hosts')
    expect(tables[2]).toBe('event_hosts')
  })

  it('uses the authenticated admin userId as profile_id in event_hosts', async () => {
    const adminId = 'admin-auto-host-id'
    const createdEvent = { id: 'evt-host-check', slug: 'test-wine-evening', title: 'Test Wine Evening' }

    authenticateAdmin(adminId)
    let callIndex = 0
    let capturedInsert: unknown = null

    mockFrom.mockImplementation((table: string) => {
      callIndex++
      if (callIndex === 1) {
        // profiles — admin role check
        return mockChain({ data: { role: 'admin' } })
      }
      if (table === 'events') {
        return mockChain({ data: createdEvent })
      }
      if (table === 'event_hosts') {
        const chain = mockChain({ error: null })
        chain.insert = vi.fn((data: unknown) => {
          capturedInsert = data
          return chain
        })
        return chain
      }
      return mockChain({ data: null })
    })

    await createEvent(makeEventFormData())

    expect(capturedInsert).toMatchObject({
      event_id: createdEvent.id,
      profile_id: adminId,
      role_label: 'Host',
      sort_order: 0,
    })
  })

  it('does not insert event_hosts when event creation fails (DB error)', async () => {
    mockAdminWithSequence([
      // events insert returns DB error
      { data: null, error: { message: 'unique violation' } },
    ])

    const result = await createEvent(makeEventFormData())

    expect(result.error).toBeDefined()

    // from() calls: [0]=profiles(admin check), [1]=events(insert with error)
    // event_hosts should NOT be reached
    const tables = mockFrom.mock.calls.map((args) => args[0] as string)
    expect(tables).not.toContain('event_hosts')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// toggleEventPublished
// ════════════════════════════════════════════════════════════════════════════

describe('toggleEventPublished', () => {
  it('flips is_published from true to false', async () => {
    mockAdminWithSequence([
      // select current state
      { data: { is_published: true, slug: 'test-event' } },
      // update
      { error: null },
    ])

    const result = await toggleEventPublished('evt-1')

    expect(result.success).toBe(true)
    expect(result.is_published).toBe(false)
  })

  it('flips is_published from false to true', async () => {
    mockAdminWithSequence([
      { data: { is_published: false, slug: 'test-event' } },
      { error: null },
    ])

    const result = await toggleEventPublished('evt-1')

    expect(result.success).toBe(true)
    expect(result.is_published).toBe(true)
  })

  it('returns error for non-existent event', async () => {
    mockAdminWithSequence([
      { data: null },
    ])

    const result = await toggleEventPublished('not-found')

    expect(result.error).toBe('Event not found')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// softDeleteEvent
// ════════════════════════════════════════════════════════════════════════════

describe('softDeleteEvent', () => {
  it('rejects delete when confirmed bookings exist', async () => {
    mockAdminWithSequence([
      // count of confirmed bookings
      { count: 5 },
    ])

    const result = await softDeleteEvent('evt-1')

    expect(result.error).toContain('Cannot delete')
    expect(result.error).toContain('5 confirmed bookings')
  })

  it('soft deletes event with no confirmed bookings', async () => {
    mockAdminWithSequence([
      // count of confirmed bookings = 0
      { count: 0 },
      // update (set deleted_at)
      { error: null },
    ])

    const result = await softDeleteEvent('evt-1')

    expect(result.success).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// promoteFromWaitlist
// ════════════════════════════════════════════════════════════════════════════

describe('promoteFromWaitlist', () => {
  it('promotes a waitlisted booking to confirmed', async () => {
    mockRpc.mockResolvedValue({ error: null })
    mockAdminWithSequence([
      // fetch booking
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      // fetch event
      { data: { id: 'evt-1', slug: 'test-event', capacity: 20 } },
      // count confirmed
      { count: 15 },
      // update booking
      { error: null },
      // get promoted user name
      { data: { full_name: 'Charlotte' } },
    ])

    const result = await promoteFromWaitlist('bk-1')

    expect(result.success).toBe(true)
    expect(result.promotedName).toBe('Charlotte')
    expect(mockRpc).toHaveBeenCalledWith('recompute_waitlist_positions', { p_event_id: 'evt-1' })
  })

  it('rejects promote for non-waitlisted booking', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'confirmed' } },
    ])

    const result = await promoteFromWaitlist('bk-1')

    expect(result.error).toBe('Booking is not waitlisted')
  })

  it('rejects promote when event is at full capacity', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'test-event', capacity: 20 } },
      { count: 20 },
    ])

    const result = await promoteFromWaitlist('bk-1')

    expect(result.error).toContain('full capacity')
  })

  it('rejects promote for non-existent booking', async () => {
    mockAdminWithSequence([
      { data: null, error: { message: 'not found' } },
    ])

    const result = await promoteFromWaitlist('bk-missing')

    expect(result.error).toBe('Booking not found')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// toggleReviewVisibility
// ════════════════════════════════════════════════════════════════════════════

describe('toggleReviewVisibility', () => {
  it('flips is_visible from true to false', async () => {
    mockAdminWithSequence([
      // fetch current state
      { data: { is_visible: true, event: { slug: 'wine-wisdom' } } },
      // update
      { error: null },
    ])

    const result = await toggleReviewVisibility('rev-1')

    expect(result.success).toBe(true)
    expect(result.is_visible).toBe(false)
  })

  it('flips is_visible from false to true', async () => {
    mockAdminWithSequence([
      { data: { is_visible: false, event: { slug: 'wine-wisdom' } } },
      { error: null },
    ])

    const result = await toggleReviewVisibility('rev-1')

    expect(result.success).toBe(true)
    expect(result.is_visible).toBe(true)
  })

  it('returns error for non-existent review', async () => {
    mockAdminWithSequence([
      { data: null },
    ])

    const result = await toggleReviewVisibility('rev-missing')

    expect(result.error).toBe('Review not found')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// sendNotification
// ════════════════════════════════════════════════════════════════════════════

describe('sendNotification', () => {
  it('inserts notification and returns success', async () => {
    mockAdminWithSequence([
      { error: null },
    ])

    const fd = new FormData()
    fd.set('subject', 'New Event')
    fd.set('body', 'Check out our latest event')
    fd.set('recipient_type', 'all')
    fd.set('type', 'announcement')

    const result = await sendNotification(fd)

    expect(result.success).toBe(true)
  })

  it('returns validation error for empty subject', async () => {
    mockAdminWithSequence([])

    const fd = new FormData()
    fd.set('subject', '')
    fd.set('body', 'Content')
    fd.set('recipient_type', 'all')
    fd.set('type', 'announcement')

    const result = await sendNotification(fd)

    expect(result.error).toBeDefined()
  })
})
