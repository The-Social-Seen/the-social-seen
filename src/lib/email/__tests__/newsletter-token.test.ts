import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  issueNewsletterToken,
  verifyNewsletterToken,
  buildNewsletterConfirmUrl,
  buildNewsletterUnsubscribeUrl,
} from '../newsletter-token'

const originalSecret = process.env.UNSUBSCRIBE_TOKEN_SECRET

beforeEach(() => {
  process.env.UNSUBSCRIBE_TOKEN_SECRET =
    'deterministic-test-secret-for-newsletter-token-12345'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://test.example.com'
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.UNSUBSCRIBE_TOKEN_SECRET
  else process.env.UNSUBSCRIBE_TOKEN_SECRET = originalSecret
  vi.useRealTimers()
})

describe('newsletter token round-trip', () => {
  it('confirm token verifies back to the same email + action', () => {
    const token = issueNewsletterToken('user@example.com', 'confirm')
    const result = verifyNewsletterToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.email).toBe('user@example.com')
      expect(result.value.action).toBe('confirm')
    }
  })

  it('lowercases email on issue', () => {
    const token = issueNewsletterToken('USER@Example.COM', 'confirm')
    const result = verifyNewsletterToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.email).toBe('user@example.com')
  })

  it('rejects a tampered email (signature check)', () => {
    const token = issueNewsletterToken('alice@example.com', 'confirm')
    // Swap the payload for bob@, keep the signature from alice.
    const [, sig] = token.split('.')
    const fakePayload = Buffer.from(
      JSON.stringify({
        e: 'bob@example.com',
        a: 'confirm',
        i: Math.floor(Date.now() / 1000),
      }),
      'utf-8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
    const result = verifyNewsletterToken(`${fakePayload}.${sig}`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad_signature')
  })

  it('rejects an invalid action', async () => {
    const crypto = await import('node:crypto')
    const payload = JSON.stringify({
      e: 'user@example.com',
      a: 'malicious',
      i: Math.floor(Date.now() / 1000),
    })
    const encoded = Buffer.from(payload, 'utf-8')
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
    const result = verifyNewsletterToken(`${encoded}.${sig}`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_action')
  })

  it('expires after 90 days', () => {
    vi.useFakeTimers()
    const now = Date.now()
    vi.setSystemTime(new Date(now - 91 * 24 * 60 * 60 * 1000))
    const token = issueNewsletterToken('user@example.com', 'confirm')
    vi.setSystemTime(new Date(now))
    const result = verifyNewsletterToken(token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')
  })
})

describe('buildNewsletterConfirmUrl / buildNewsletterUnsubscribeUrl', () => {
  it('confirm URL targets /newsletter/confirm with a valid token', () => {
    const url = buildNewsletterConfirmUrl('user@example.com')
    expect(url.startsWith('https://test.example.com/newsletter/confirm?t=')).toBe(
      true,
    )
    const token = new URL(url).searchParams.get('t')
    expect(token).not.toBeNull()
    const result = verifyNewsletterToken(token!)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.action).toBe('confirm')
  })

  it('unsubscribe URL targets /newsletter/unsubscribe with the right action', () => {
    const url = buildNewsletterUnsubscribeUrl('user@example.com')
    expect(
      url.startsWith('https://test.example.com/newsletter/unsubscribe?t='),
    ).toBe(true)
    const token = new URL(url).searchParams.get('t')
    const result = verifyNewsletterToken(token!)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.action).toBe('unsubscribe')
  })
})
