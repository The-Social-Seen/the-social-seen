import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

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

import { submitReview } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateUser(userId = 'user-1') {
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
 * Each chained method returns the same proxy, and await/then resolves to `response`.
 */
function mockSupabaseChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'single', 'maybeSingle',
    'order', 'limit',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  mockFrom.mockReturnValue(chain)
  return chain
}

/**
 * Build a multi-call mock where each `.from()` call returns a different response.
 * `responses` is an ordered array — the first call resolves the first response, etc.
 */
function mockSupabaseSequence(responses: Array<{ data?: unknown; error?: unknown }>) {
  let callCount = 0
  mockFrom.mockImplementation(() => {
    const response = responses[callCount] ?? responses[responses.length - 1]
    callCount++

    const chain: Record<string, ReturnType<typeof vi.fn>> = {}
    const methods = [
      'select', 'insert', 'update', 'delete',
      'eq', 'neq', 'is', 'single', 'maybeSingle',
      'order', 'limit',
    ]
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
    return chain
  })
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// submitReview
// ════════════════════════════════════════════════════════════════════════════

describe('submitReview', () => {
  // ── Input validation ────────────────────────────────────────────────────

  it('returns error when eventId is empty', async () => {
    const result = await submitReview({ eventId: '', rating: 5 })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Event ID is required')
  })

  it('returns error for rating of 0', async () => {
    const result = await submitReview({ eventId: 'evt-1', rating: 0 })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Rating must be a whole number between 1 and 5')
  })

  it('returns error for rating of 6', async () => {
    const result = await submitReview({ eventId: 'evt-1', rating: 6 })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Rating must be a whole number between 1 and 5')
  })

  it('returns error for non-integer rating (3.5)', async () => {
    const result = await submitReview({ eventId: 'evt-1', rating: 3.5 })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Rating must be a whole number between 1 and 5')
  })

  it('returns error for review text over 500 chars', async () => {
    const longText = 'a'.repeat(501)
    const result = await submitReview({ eventId: 'evt-1', rating: 4, reviewText: longText })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Review text must be 500 characters or fewer')
  })

  // ── Authentication ──────────────────────────────────────────────────────

  it('returns error when user is not authenticated', async () => {
    unauthenticateUser()
    const result = await submitReview({ eventId: 'evt-1', rating: 5 })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Authentication required')
  })

  // ── EC-10: Future event guard ───────────────────────────────────────────

  it('rejects review for a future event', async () => {
    authenticateUser()

    mockSupabaseChain({
      data: { id: 'evt-1', slug: 'future-event', date_time: '2099-12-31T19:00:00Z' },
      error: null,
    })

    const result = await submitReview({ eventId: 'evt-1', rating: 4 })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Reviews can only be submitted for past events')
  })

  it('rejects review when event not found', async () => {
    authenticateUser()

    mockSupabaseChain({ data: null, error: { message: 'not found' } })

    const result = await submitReview({ eventId: 'evt-missing', rating: 4 })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Event not found')
  })

  // ── EC-09: Confirmed booking guard ──────────────────────────────────────

  it('rejects review when user has no confirmed booking', async () => {
    authenticateUser()

    mockSupabaseSequence([
      // 1st call: event fetch (past event)
      { data: { id: 'evt-1', slug: 'past-event', date_time: '2020-01-01T19:00:00Z' }, error: null },
      // 2nd call: booking check — no booking found
      { data: null, error: null },
    ])

    const result = await submitReview({ eventId: 'evt-1', rating: 5 })

    expect(result.success).toBe(false)
    expect(result.error).toBe('You can only review events you attended')
  })

  // ── Duplicate review guard ──────────────────────────────────────────────

  it('rejects duplicate review for the same event', async () => {
    authenticateUser()

    mockSupabaseSequence([
      // 1st call: event fetch (past event)
      { data: { id: 'evt-1', slug: 'past-event', date_time: '2020-01-01T19:00:00Z' }, error: null },
      // 2nd call: booking check — confirmed
      { data: { id: 'bk-1' }, error: null },
      // 3rd call: existing review check — already reviewed
      { data: { id: 'rev-existing' }, error: null },
    ])

    const result = await submitReview({ eventId: 'evt-1', rating: 5 })

    expect(result.success).toBe(false)
    expect(result.error).toBe('You have already reviewed this event')
  })

  // ── Happy paths ─────────────────────────────────────────────────────────

  it('succeeds with valid rating only (no text)', async () => {
    authenticateUser()

    mockSupabaseSequence([
      // 1st: event fetch
      { data: { id: 'evt-1', slug: 'past-event', date_time: '2020-01-01T19:00:00Z' }, error: null },
      // 2nd: booking — confirmed
      { data: { id: 'bk-1' }, error: null },
      // 3rd: existing review — none
      { data: null, error: null },
      // 4th: insert — success
      { data: null, error: null },
    ])

    const result = await submitReview({ eventId: 'evt-1', rating: 4 })

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('succeeds with valid rating and review text', async () => {
    authenticateUser()

    mockSupabaseSequence([
      // 1st: event fetch
      { data: { id: 'evt-1', slug: 'past-event', date_time: '2020-01-01T19:00:00Z' }, error: null },
      // 2nd: booking — confirmed
      { data: { id: 'bk-1' }, error: null },
      // 3rd: existing review — none
      { data: null, error: null },
      // 4th: insert — success
      { data: null, error: null },
    ])

    const result = await submitReview({
      eventId: 'evt-1',
      rating: 5,
      reviewText: 'Absolutely wonderful evening — the venue was perfect.',
    })

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns error when insert fails with UNIQUE constraint', async () => {
    authenticateUser()

    mockSupabaseSequence([
      // 1st: event fetch
      { data: { id: 'evt-1', slug: 'past-event', date_time: '2020-01-01T19:00:00Z' }, error: null },
      // 2nd: booking — confirmed
      { data: { id: 'bk-1' }, error: null },
      // 3rd: existing review — none (race condition)
      { data: null, error: null },
      // 4th: insert — UNIQUE violation
      { data: null, error: { message: 'duplicate key', code: '23505' } },
    ])

    const result = await submitReview({ eventId: 'evt-1', rating: 5 })

    expect(result.success).toBe(false)
    expect(result.error).toBe('You have already reviewed this event')
  })

  it('allows exactly 500 characters of review text', async () => {
    const exactText = 'a'.repeat(500)
    // Validation should pass — not return an error about length
    // (it will fail at auth because we didn't set up mocks, which is fine —
    //  we're only testing that the 500-char limit doesn't reject)
    authenticateUser()

    mockSupabaseSequence([
      { data: { id: 'evt-1', slug: 'past-event', date_time: '2020-01-01T19:00:00Z' }, error: null },
      { data: { id: 'bk-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ])

    const result = await submitReview({ eventId: 'evt-1', rating: 3, reviewText: exactText })

    expect(result.success).toBe(true)
  })
})
