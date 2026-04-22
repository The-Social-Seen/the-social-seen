import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAdminFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mockAdminFrom,
  }),
}))

// Token lib uses node:crypto directly — no need to mock. The global
// UNSUBSCRIBE_TOKEN_SECRET is set in vitest.setup.ts.
import {
  issueUnsubscribeToken,
} from '@/lib/email/unsubscribe-token'
import {
  previewUnsubscribe,
  confirmUnsubscribe,
} from '../actions'

function chain(final: { data?: unknown; error?: unknown }) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['select', 'insert', 'update', 'upsert', 'eq', 'maybeSingle']) {
    c[m] = vi.fn().mockReturnValue(c)
  }
  // `.maybeSingle()` is the terminal for our reads.
  c.maybeSingle = vi.fn().mockResolvedValue(final)
  // `.upsert()` is the terminal for writes; Supabase returns a thenable.
  c.upsert = vi.fn().mockResolvedValue(final)
  return c
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('previewUnsubscribe (GET render — no mutation)', () => {
  it('returns ok with the category label for a valid token', async () => {
    const token = issueUnsubscribeToken('user-123', 'review_requests')
    const result = await previewUnsubscribe(token)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.category).toBe('review_requests')
      expect(result.categoryLabel).toMatch(/review/i)
    }
    // Crucial: never touches the DB during preview.
    expect(mockAdminFrom).not.toHaveBeenCalled()
  })

  it('returns ok=false for a malformed token, still without DB access', async () => {
    const result = await previewUnsubscribe('not-a-real-token')
    expect(result.ok).toBe(false)
    expect(mockAdminFrom).not.toHaveBeenCalled()
  })
})

describe('confirmUnsubscribe (POST submit — mutates)', () => {
  it('flips the preference via upsert for a valid token and existing profile', async () => {
    const token = issueUnsubscribeToken('user-456', 'profile_nudges')

    // First `from('profiles')` — profile exists, not deleted.
    // Second `from('notification_preferences')` — upsert succeeds.
    let call = 0
    mockAdminFrom.mockImplementation((table: string) => {
      call++
      if (table === 'profiles') {
        return chain({
          data: { id: 'user-456', deleted_at: null },
          error: null,
        })
      }
      if (table === 'notification_preferences') {
        return chain({ data: null, error: null })
      }
      throw new Error(`unexpected table ${table} (call ${call})`)
    })

    const result = await confirmUnsubscribe(token)
    expect(result.success).toBe(true)
    if (result.success) expect(result.category).toBe('profile_nudges')
    expect(mockAdminFrom).toHaveBeenCalledWith('profiles')
    expect(mockAdminFrom).toHaveBeenCalledWith('notification_preferences')
  })

  it('rejects an invalid token before hitting the DB', async () => {
    const result = await confirmUnsubscribe('bogus')
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('invalid_token')
    expect(mockAdminFrom).not.toHaveBeenCalled()
  })

  it('returns success for a soft-deleted profile without writing', async () => {
    const token = issueUnsubscribeToken('user-789', 'admin_announcements')
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain({
          data: { id: 'user-789', deleted_at: '2026-04-01T00:00:00Z' },
          error: null,
        })
      }
      throw new Error(`should not query ${table} for deleted profile`)
    })

    const result = await confirmUnsubscribe(token)
    expect(result.success).toBe(true)
    // Only the profile lookup — no notification_preferences write.
    const tables = mockAdminFrom.mock.calls.map((c) => c[0])
    expect(tables).toEqual(['profiles'])
  })

  it('surfaces database_error when the upsert fails', async () => {
    const token = issueUnsubscribeToken('user-999', 'review_requests')
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain({
          data: { id: 'user-999', deleted_at: null },
          error: null,
        })
      }
      return chain({ data: null, error: { message: 'write failed' } })
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await confirmUnsubscribe(token)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toBe('database_error')
  })
})
