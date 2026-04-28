import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// ── Module setup ──────────────────────────────────────────────────────────────
// NEXT_PUBLIC_SUPABASE_URL is captured at module load time, so we must:
// 1. Stub the env var, 2. reset module cache, 3. dynamically import.

const MOCK_SUPABASE_URL = 'https://test.supabase.co'

let resolveEventImage: (path: string | null | undefined) => string | null
let resolveAvatarUrl: (path: string | null | undefined) => string | null
let resolveStorageUrl: (path: string | null | undefined, bucket: string) => string | null
let getInitials: (fullName: string) => string
let isAllowedImageHost: (url: string) => boolean

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', MOCK_SUPABASE_URL)
  vi.resetModules()
  const mod = await import('../images')
  resolveEventImage  = mod.resolveEventImage
  resolveAvatarUrl   = mod.resolveAvatarUrl
  resolveStorageUrl  = mod.resolveStorageUrl
  getInitials        = mod.getInitials
  isAllowedImageHost = mod.isAllowedImageHost
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

// ── resolveEventImage ─────────────────────────────────────────────────────────

describe('resolveEventImage', () => {
  it('returns null for null input', () => {
    expect(resolveEventImage(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(resolveEventImage(undefined)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(resolveEventImage('')).toBeNull()
  })

  it('returns an https:// URL as-is when host is allowed', () => {
    const url = 'https://images.unsplash.com/photo-abc123'
    expect(resolveEventImage(url)).toBe(url)
  })

  it('returns a Supabase Storage URL as-is (wildcard host match)', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/event-images/x.jpg'
    expect(resolveEventImage(url)).toBe(url)
  })

  it('returns an arbitrary HTTPS URL as-is', () => {
    // 2026-04-28: hostname allowlist removed in favour of a single
    // protocol check. Any HTTPS host is passed through to next/image,
    // which now permits any HTTPS origin (next.config.ts wildcard).
    expect(resolveEventImage('https://res.dayoutwiththekids.co.uk/x.jpg'))
      .toBe('https://res.dayoutwiththekids.co.uk/x.jpg')
    expect(resolveEventImage('https://cdn.example.com/y.jpg'))
      .toBe('https://cdn.example.com/y.jpg')
  })

  it('returns null for an http:// URL (mixed-content; next/image would also reject)', () => {
    expect(resolveEventImage('http://example.com/image.jpg')).toBeNull()
  })

  it('resolves a Supabase storage path to a full public URL', () => {
    expect(resolveEventImage('events/abc123.jpg')).toBe(
      `${MOCK_SUPABASE_URL}/storage/v1/object/public/event-images/events/abc123.jpg`
    )
  })

  it('uses the event-images bucket (not avatars)', () => {
    const result = resolveEventImage('my-photo.jpg')
    expect(result).toContain('/event-images/')
    expect(result).not.toContain('/avatars/')
  })

  it('handles nested storage paths', () => {
    expect(resolveEventImage('2026/march/dinner.jpg')).toBe(
      `${MOCK_SUPABASE_URL}/storage/v1/object/public/event-images/2026/march/dinner.jpg`
    )
  })
})

// ── resolveAvatarUrl ──────────────────────────────────────────────────────────

describe('resolveAvatarUrl', () => {
  it('returns null for null input', () => {
    expect(resolveAvatarUrl(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(resolveAvatarUrl(undefined)).toBeNull()
  })

  it('returns an allowed external URL as-is', () => {
    const url = 'https://images.unsplash.com/avatar.png'
    expect(resolveAvatarUrl(url)).toBe(url)
  })

  it('returns an arbitrary HTTPS URL as-is', () => {
    expect(resolveAvatarUrl('https://cdn.example.com/avatar.png'))
      .toBe('https://cdn.example.com/avatar.png')
  })

  it('returns null for an http:// URL', () => {
    expect(resolveAvatarUrl('http://example.com/avatar.png')).toBeNull()
  })

  it('resolves a storage path to the avatars bucket', () => {
    expect(resolveAvatarUrl('user-456.jpg')).toBe(
      `${MOCK_SUPABASE_URL}/storage/v1/object/public/avatars/user-456.jpg`
    )
  })

  it('uses the avatars bucket (not event-images)', () => {
    const result = resolveAvatarUrl('my-avatar.png')
    expect(result).toContain('/avatars/')
    expect(result).not.toContain('/event-images/')
  })
})

// ── resolveStorageUrl ─────────────────────────────────────────────────────────

describe('resolveStorageUrl', () => {
  it('returns null for null input', () => {
    expect(resolveStorageUrl(null, 'my-bucket')).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(resolveStorageUrl(undefined, 'my-bucket')).toBeNull()
  })

  it('returns allowed external URL as-is regardless of bucket', () => {
    const url = 'https://images.unsplash.com/file.pdf'
    expect(resolveStorageUrl(url, 'docs')).toBe(url)
  })

  it('returns an arbitrary HTTPS URL as-is', () => {
    expect(resolveStorageUrl('https://cdn.example.com/file.pdf', 'docs'))
      .toBe('https://cdn.example.com/file.pdf')
  })

  it('returns null for an http:// URL', () => {
    expect(resolveStorageUrl('http://example.com/file.pdf', 'docs')).toBeNull()
  })

  it('uses the provided bucket name in the URL', () => {
    expect(resolveStorageUrl('file.txt', 'custom-bucket')).toBe(
      `${MOCK_SUPABASE_URL}/storage/v1/object/public/custom-bucket/file.txt`
    )
  })
})

// ── isAllowedImageHost ────────────────────────────────────────────────────────

describe('isAllowedImageHost', () => {
  it('allows images.unsplash.com', () => {
    expect(isAllowedImageHost('https://images.unsplash.com/photo-x')).toBe(true)
  })

  it('allows subdomains of supabase.co', () => {
    expect(isAllowedImageHost('https://project.supabase.co/file.jpg')).toBe(true)
    expect(isAllowedImageHost('https://another-project.supabase.co/x')).toBe(true)
  })

  it('accepts arbitrary HTTPS CDN hostnames', () => {
    // 2026-04-28: hostname allowlist removed (single-admin trust
    // model). The contract is now "any HTTPS source is allowed" —
    // these example hostnames are deliberately non-special.
    expect(isAllowedImageHost('https://res.dayoutwiththekids.co.uk/x.jpg')).toBe(true)
    expect(isAllowedImageHost('https://cdn.example.com/y.jpg')).toBe(true)
    expect(isAllowedImageHost('https://ca-times.brightspotcdn.com/x.jpg')).toBe(true)
  })

  it('returns false for a malformed URL', () => {
    expect(isAllowedImageHost('not a url')).toBe(false)
    expect(isAllowedImageHost('')).toBe(false)
  })

  it('rejects http:// (mixed-content + MitM)', () => {
    // HTTP is the only protocol-level rejection the helper still
    // enforces. Cover both previously-allowlisted hosts and an
    // arbitrary one to make the protocol-only contract obvious.
    expect(isAllowedImageHost('http://images.unsplash.com/photo-x')).toBe(false)
    expect(isAllowedImageHost('http://project.supabase.co/x.jpg')).toBe(false)
    expect(isAllowedImageHost('http://example.com/x.jpg')).toBe(false)
  })
})

// ── getInitials ───────────────────────────────────────────────────────────────

describe('getInitials', () => {
  it('returns two initials for a full name', () => {
    expect(getInitials('Charlotte Davis')).toBe('CD')
  })

  it('returns one initial for a single name', () => {
    expect(getInitials('Priya')).toBe('P')
  })

  it('returns only the first two initials for names with more than two words', () => {
    expect(getInitials('Mary Jane Watson')).toBe('MJ')
  })

  it('uppercases the initials', () => {
    expect(getInitials('john doe')).toBe('JD')
  })

  it('trims leading and trailing whitespace', () => {
    expect(getInitials('  John Doe  ')).toBe('JD')
  })

  it('handles multiple internal spaces', () => {
    expect(getInitials('John   Doe')).toBe('JD')
  })
})
