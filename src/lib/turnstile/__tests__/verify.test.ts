import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractTurnstileToken, verifyTurnstileToken } from '../verify'

describe('extractTurnstileToken', () => {
  it('returns the token when present', () => {
    const fd = new FormData()
    fd.set('cf-turnstile-response', 'abc123')
    expect(extractTurnstileToken(fd)).toBe('abc123')
  })

  it('returns null when missing', () => {
    expect(extractTurnstileToken(new FormData())).toBeNull()
  })

  it('returns null when blank', () => {
    const fd = new FormData()
    fd.set('cf-turnstile-response', '   ')
    expect(extractTurnstileToken(fd)).toBeNull()
  })

  it('returns null when non-string', () => {
    const fd = new FormData()
    fd.set('cf-turnstile-response', new Blob(['x']))
    expect(extractTurnstileToken(fd)).toBeNull()
  })
})

describe('verifyTurnstileToken', () => {
  const originalEnv = process.env.TURNSTILE_SECRET_KEY
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TURNSTILE_SECRET_KEY
    } else {
      process.env.TURNSTILE_SECRET_KEY = originalEnv
    }
    vi.stubEnv('NODE_ENV', originalNodeEnv ?? 'test')
  })

  it('fails open when TURNSTILE_SECRET_KEY is unset', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    vi.stubEnv('NODE_ENV', 'development')
    const result = await verifyTurnstileToken('some-token')
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('secret_not_configured')
  })

  it('rejects a missing token when the secret is configured', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    const result = await verifyTurnstileToken(null)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing_token')
  })

  it('rejects a blank token when the secret is configured', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    const result = await verifyTurnstileToken('   ')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing_token')
  })

  it('returns ok when siteverify succeeds', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    )
    const result = await verifyTurnstileToken('good-token', '1.2.3.4')
    expect(result.ok).toBe(true)
  })

  it('returns not-ok with error codes when siteverify rejects', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
        { status: 200 },
      ),
    )
    const result = await verifyTurnstileToken('bad-token')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid-input-response')
  })

  it('fails open when Cloudflare is unreachable', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await verifyTurnstileToken('token')
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('provider_error')
  })

  it('fails open when siteverify returns non-2xx', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('Service Unavailable', { status: 503 }),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await verifyTurnstileToken('token')
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('provider_unreachable')
  })
})
