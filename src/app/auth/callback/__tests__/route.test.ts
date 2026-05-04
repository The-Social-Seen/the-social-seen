/**
 * Unit tests for the /auth/callback PKCE exchange route.
 *
 * Coverage:
 *   - Missing `code` param → redirect to /forgot-password?error=expired_link
 *   - Successful exchange, no `next` → redirect to /reset-password (fallback)
 *   - Successful exchange, safe `next` → redirect to that path
 *   - Successful exchange, malicious absolute `next` → sanitised to fallback
 *     (deeper open-redirect coverage — `//evil.com`, `\\/evil.com`,
 *     `javascript:` etc. — lives in src/lib/utils/__tests__/redirect.test.ts;
 *     the route inherits those guarantees from sanitizeRedirectPath.)
 *   - exchangeCodeForSession returns { error } → redirect to expired_link
 *   - exchangeCodeForSession throws (network / Supabase 5xx) → same
 *     expired_link redirect, NOT a 500
 *
 * No Playwright E2E exists for this route: the recovery flow can't be
 * exercised without a real Supabase recovery email (the PKCE token is bound
 * to the verifier cookie set when resetPasswordForEmail was called). Manual
 * verification is required post-merge after the dashboard config in
 * prompts/fix-password-reset-redirect.md is applied.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockExchangeCodeForSession } = vi.hoisted(() => ({
  mockExchangeCodeForSession: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () =>
    Promise.resolve({
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
      },
    }),
}))

import { GET } from '../route'

function makeRequest(search: string): Request {
  return new Request(`http://localhost:3000/auth/callback${search}`, {
    method: 'GET',
  })
}

beforeEach(() => {
  mockExchangeCodeForSession.mockReset()
})

describe('GET /auth/callback', () => {
  it('redirects to /forgot-password?error=expired_link when code is missing', async () => {
    const res = await GET(makeRequest(''))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/forgot-password?error=expired_link',
    )
    // No exchange attempted — short-circuited before the Supabase call.
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('redirects to /reset-password (fallback) when code valid and next omitted', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })

    const res = await GET(makeRequest('?code=pkce_abc123'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/reset-password',
    )
    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('pkce_abc123')
  })

  it('honours safe relative next when exchange succeeds', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })

    const res = await GET(makeRequest('?code=pkce_abc123&next=/profile'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/profile')
  })

  it('sanitises malicious absolute next back to fallback', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })

    const res = await GET(
      makeRequest('?code=pkce_abc123&next=https://evil.com/steal'),
    )

    expect(res.status).toBe(307)
    // sanitizeRedirectPath rejects anything with `://`, so we land on the
    // explicit /reset-password fallback rather than the attacker's URL.
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/reset-password',
    )
  })

  it('redirects to expired_link when exchangeCodeForSession returns an error', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: { message: 'code expired' },
    })

    const res = await GET(makeRequest('?code=pkce_expired'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/forgot-password?error=expired_link',
    )
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('pkce_expired')
  })

  it('redirects to expired_link when exchangeCodeForSession throws', async () => {
    // Defence-in-depth: a network failure or Supabase 5xx can cause the
    // SDK to throw rather than return { error }. We must NOT 500 the route
    // — the email is single-use, so a dead-end response would force the
    // user to re-request. Same expired-link redirect as the { error } path.
    mockExchangeCodeForSession.mockRejectedValue(
      new Error('network: connect ECONNREFUSED'),
    )

    const res = await GET(makeRequest('?code=pkce_thrown'))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/forgot-password?error=expired_link',
    )
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('pkce_thrown')
  })
})
