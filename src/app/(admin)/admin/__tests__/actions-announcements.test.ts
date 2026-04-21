import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock (mirrors actions-write.test.ts) ──────────────────────────

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

vi.mock('@/lib/utils/slugify', () => ({
  slugify: vi.fn((text: string) => text.toLowerCase().replace(/\s+/g, '-')),
  uniqueSlug: vi.fn(async (text: string) =>
    text.toLowerCase().replace(/\s+/g, '-'),
  ),
}))

// `after()` requires a request scope at runtime. Invoke immediately so
// the dispatch loop runs and we can assert on sendEmail calls.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (fn: () => unknown | Promise<unknown>) => {
      void Promise.resolve(fn())
    },
  }
})

const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

import {
  emailEventAttendees,
  getFailedNotifications,
  retryNotification,
} from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateAdmin(userId = 'admin-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function mockChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'single', 'maybeSingle',
    'order', 'limit', 'in',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

function makeFormData(subject: string, body: string): FormData {
  const fd = new FormData()
  fd.set('subject', subject)
  fd.set('body', body)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })
})

// ════════════════════════════════════════════════════════════════════════════
// emailEventAttendees
// ════════════════════════════════════════════════════════════════════════════

describe('emailEventAttendees', () => {
  it('throws for unauthenticated user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'no auth' },
    })
    await expect(
      emailEventAttendees('evt-1', makeFormData('Hi', 'Body text here.')),
    ).rejects.toThrow('Authentication required')
  })

  it('throws for non-admin', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'member' } }))
    await expect(
      emailEventAttendees('evt-1', makeFormData('Hi', 'Body text here.')),
    ).rejects.toThrow('Admin access required')
  })

  it('rejects empty/short subject', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))
    const result = await emailEventAttendees('evt-1', makeFormData('', 'Body text here.'))
    expect(result).toEqual({ error: expect.stringMatching(/Subject/i) })
  })

  it('rejects short body', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))
    const result = await emailEventAttendees('evt-1', makeFormData('Hello there', 'short'))
    expect(result).toEqual({ error: expect.stringMatching(/Body/i) })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns error when no confirmed attendees', async () => {
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      if (callCount === 2)
        return mockChain({ data: { id: 'evt-1', title: 'X', slug: 'x' } })
      // bookings → empty
      return mockChain({ data: [] })
    })
    const result = await emailEventAttendees(
      'evt-1',
      makeFormData('Subject here', 'Body content here.'),
    )
    expect(result).toEqual({ error: 'No confirmed attendees to email' })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('happy path — dispatches one send per confirmed attendee with correct metadata', async () => {
    authenticateAdmin('admin-42')
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      if (callCount === 2)
        return mockChain({
          data: { id: 'evt-1', title: 'Wine Night', slug: 'wine-night' },
        })
      // bookings query returns confirmed-only because action filters
      // server-side — provide two attendees.
      return mockChain({
        data: [
          {
            id: 'b1',
            user_id: 'user-1',
            profile: { id: 'user-1', full_name: 'Anna Lee', email: 'anna@example.com' },
          },
          {
            id: 'b2',
            user_id: 'user-2',
            profile: { id: 'user-2', full_name: 'Ben Park', email: 'ben@example.com' },
          },
        ],
      })
    })

    const result = await emailEventAttendees(
      'evt-1',
      makeFormData('Heads up', 'Quick update for tonight.'),
    )

    expect(result).toEqual({ success: true, recipientCount: 2 })

    // Drain microtasks so the after() callback's awaits resolve.
    await new Promise((r) => setTimeout(r, 0))

    expect(mockSendEmail).toHaveBeenCalledTimes(2)
    const [firstCall, secondCall] = mockSendEmail.mock.calls
    expect(firstCall[0]).toMatchObject({
      to: 'anna@example.com',
      subject: 'Heads up',
      templateName: 'admin_announcement',
      relatedProfileId: 'admin-42',
      recipientUserId: 'user-1',
      recipientEventId: 'evt-1',
      recipientType: 'event_attendees',
      notificationType: 'announcement',
    })
    expect(secondCall[0]).toMatchObject({
      to: 'ben@example.com',
      recipientUserId: 'user-2',
      recipientEventId: 'evt-1',
    })
  })

  // Tests below use the same mocks/helpers above.

  // ──────────────────────────────────────────────────────────────────────
  // getFailedNotifications
  // ──────────────────────────────────────────────────────────────────────

  it('getFailedNotifications: throws for non-admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null })
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'member' } }))
    await expect(getFailedNotifications()).rejects.toThrow('Admin access required')
  })

  it('getFailedNotifications: returns failed email rows', async () => {
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      return mockChain({
        data: [
          {
            id: 'n1',
            template_name: 'welcome',
            subject: 'Welcome',
            body: '<p>hi</p>',
            recipient_email: 'a@example.com',
            error_message: 'mail server down',
            sent_at: '2026-04-20T10:00:00Z',
            retried_at: null,
          },
        ],
      })
    })
    const rows = await getFailedNotifications()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('n1')
  })

  // ──────────────────────────────────────────────────────────────────────
  // retryNotification
  // ──────────────────────────────────────────────────────────────────────

  it('retryNotification: rejects non-admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null })
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'member' } }))
    await expect(retryNotification('n1')).rejects.toThrow('Admin access required')
  })

  it('retryNotification: refuses non-email channels', async () => {
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      return mockChain({
        data: {
          id: 'n1',
          channel: 'in_app',
          status: 'failed',
          subject: 'X',
          body: 'Y',
          recipient_email: 'a@example.com',
          template_name: null,
        },
      })
    })
    const r = await retryNotification('n1')
    expect(r).toEqual({ error: 'Only email notifications can be retried here' })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('retryNotification: refuses non-failed rows', async () => {
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      return mockChain({
        data: {
          id: 'n1',
          channel: 'email',
          status: 'sent',
          subject: 'X',
          body: 'Y',
          recipient_email: 'a@example.com',
          template_name: null,
        },
      })
    })
    const r = await retryNotification('n1')
    expect(r).toEqual({ error: 'Only failed notifications can be retried' })
  })

  it('retryNotification: refuses redacted rows (account deleted)', async () => {
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      return mockChain({
        data: {
          id: 'n1',
          channel: 'email',
          status: 'failed',
          subject: '[redacted]',
          body: '[redacted — account deleted]',
          recipient_email: 'a@example.com',
          template_name: 'welcome',
        },
      })
    })
    const r = await retryNotification('n1')
    expect(r).toEqual({
      error: 'This notification has been redacted (account deleted)',
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('retryNotification: happy path — re-fires send and stamps retried_at', async () => {
    authenticateAdmin()
    let updateCalled = false
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      if (callCount === 2)
        return mockChain({
          data: {
            id: 'n1',
            channel: 'email',
            status: 'failed',
            subject: 'Welcome',
            body: '<p>hi</p>',
            recipient_email: 'a@example.com',
            template_name: 'welcome',
          },
        })
      // Update path stamps retried_at
      const chain = mockChain({ error: null })
      chain.update = vi.fn(() => {
        updateCalled = true
        return chain
      })
      return chain
    })
    const r = await retryNotification('n1')
    expect(r).toEqual({ success: true })
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'a@example.com',
      subject: 'Welcome',
      html: '<p>hi</p>',
      templateName: 'welcome',
    })
    expect(updateCalled).toBe(true)
  })

  it('skips recipients without an email address', async () => {
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      if (callCount === 2)
        return mockChain({
          data: { id: 'evt-1', title: 'X', slug: 'x' },
        })
      return mockChain({
        data: [
          {
            id: 'b1',
            user_id: 'user-1',
            profile: { id: 'user-1', full_name: 'Anna', email: 'anna@example.com' },
          },
          {
            id: 'b2',
            user_id: 'user-2',
            profile: { id: 'user-2', full_name: 'Ben', email: null },
          },
        ],
      })
    })

    const result = await emailEventAttendees(
      'evt-1',
      makeFormData('Subj', 'Body content here.'),
    )
    expect(result).toEqual({ success: true, recipientCount: 1 })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0].to).toBe('anna@example.com')
  })
})
