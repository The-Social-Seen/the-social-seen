import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  issueUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  UNSUBSCRIBE_CATEGORIES,
} from '../unsubscribe-token'

// Stable secret for the duration of these tests. Restored in afterEach.
const originalSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

beforeEach(() => {
  process.env.UNSUBSCRIBE_TOKEN_SECRET =
    'a-long-deterministic-test-secret-for-hmac-12345'
})

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.UNSUBSCRIBE_TOKEN_SECRET
  } else {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = originalSecret
  }
  if (originalServiceKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey
  }
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('issueUnsubscribeToken + verifyUnsubscribeToken', () => {
  it('round-trips for each category', () => {
    for (const category of UNSUBSCRIBE_CATEGORIES) {
      const token = issueUnsubscribeToken('user-123', category)
      const result = verifyUnsubscribeToken(token)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.userId).toBe('user-123')
        expect(result.value.category).toBe(category)
        expect(typeof result.value.issuedAt).toBe('number')
      }
    }
  })

  it('rejects a token signed with a different secret', () => {
    const token = issueUnsubscribeToken('user-123', 'review_requests')
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'a-different-secret-value-goes-here'
    const result = verifyUnsubscribeToken(token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad_signature')
  })

  it('rejects a malformed token', () => {
    const result = verifyUnsubscribeToken('not-a-token')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('malformed')
  })

  it('rejects an empty token', () => {
    const result = verifyUnsubscribeToken('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('empty_token')
  })

  it('rejects a tampered payload', () => {
    const token = issueUnsubscribeToken('user-123', 'review_requests')
    const [, sig] = token.split('.')
    const tampered = `eyJ1IjoidXNlci05OTkiLCJjIjoicmV2aWV3X3JlcXVlc3RzIiwiaSI6MX0.${sig}`
    const result = verifyUnsubscribeToken(tampered)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad_signature')
  })

  it('rejects an invalid category even with a valid signature', async () => {
    // Manually craft a payload with a category that isn't in the allowlist,
    // then re-sign with the valid secret. Verifier should still reject.
    const crypto = await import('node:crypto')
    const fakePayload = JSON.stringify({
      u: 'user-123',
      c: 'not_a_category',
      i: Math.floor(Date.now() / 1000),
    })
    const encoded = Buffer.from(fakePayload, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
    const sig = crypto
      .createHmac('sha256', process.env.UNSUBSCRIBE_TOKEN_SECRET!)
      .update(encoded)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
    const result = verifyUnsubscribeToken(`${encoded}.${sig}`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_category')
  })

  it('rejects an expired token (>90 days old)', async () => {
    vi.useFakeTimers()
    const realNow = Date.now()
    vi.setSystemTime(new Date(realNow - 91 * 24 * 60 * 60 * 1000))
    const oldToken = issueUnsubscribeToken('user-123', 'review_requests')

    // Verify at "now" (91 days later)
    vi.setSystemTime(new Date(realNow))
    const result = verifyUnsubscribeToken(oldToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')
  })

  it('accepts a fresh token within the 90-day window', () => {
    vi.useFakeTimers()
    const realNow = Date.now()
    vi.setSystemTime(new Date(realNow - 89 * 24 * 60 * 60 * 1000))
    const oldToken = issueUnsubscribeToken('user-123', 'profile_nudges')
    vi.setSystemTime(new Date(realNow))
    const result = verifyUnsubscribeToken(oldToken)
    expect(result.ok).toBe(true)
  })
})

describe('buildUnsubscribeUrl', () => {
  it('produces a URL with the token in ?t=', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://test.example.com'
    const url = buildUnsubscribeUrl('user-123', 'review_requests')
    expect(url.startsWith('https://test.example.com/unsubscribe?t=')).toBe(true)
    const parsed = new URL(url)
    const token = parsed.searchParams.get('t')
    expect(token).not.toBeNull()
    const result = verifyUnsubscribeToken(token!)
    expect(result.ok).toBe(true)
  })

  it('strips a trailing slash on the site URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://test.example.com/'
    const url = buildUnsubscribeUrl('user-123', 'review_requests')
    expect(url.startsWith('https://test.example.com/unsubscribe?')).toBe(true)
    expect(url.includes('.com//unsubscribe')).toBe(false)
  })
})

