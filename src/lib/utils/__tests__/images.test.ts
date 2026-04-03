import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// ── Module setup ──────────────────────────────────────────────────────────────
// NEXT_PUBLIC_SUPABASE_URL is captured at module load time, so we must:
// 1. Stub the env var, 2. reset module cache, 3. dynamically import.

const MOCK_SUPABASE_URL = 'https://test.supabase.co'

let resolveEventImage: (path: string | null | undefined) => string | null
let resolveAvatarUrl: (path: string | null | undefined) => string | null
let resolveStorageUrl: (path: string | null | undefined, bucket: string) => string | null
let getInitials: (fullName: string) => string

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', MOCK_SUPABASE_URL)
  vi.resetModules()
  const mod = await import('../images')
  resolveEventImage  = mod.resolveEventImage
  resolveAvatarUrl   = mod.resolveAvatarUrl
  resolveStorageUrl  = mod.resolveStorageUrl
  getInitials        = mod.getInitials
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

  it('returns an https:// URL as-is (external image)', () => {
    const url = 'https://images.unsplash.com/photo-abc123'
    expect(resolveEventImage(url)).toBe(url)
  })

  it('returns an http:// URL as-is', () => {
    const url = 'http://example.com/image.jpg'
    expect(resolveEventImage(url)).toBe(url)
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

  it('returns an external URL as-is', () => {
    const url = 'https://cdn.example.com/avatar.png'
    expect(resolveAvatarUrl(url)).toBe(url)
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

  it('returns external URL as-is regardless of bucket', () => {
    const url = 'https://cdn.example.com/file.pdf'
    expect(resolveStorageUrl(url, 'docs')).toBe(url)
  })

  it('uses the provided bucket name in the URL', () => {
    expect(resolveStorageUrl('file.txt', 'custom-bucket')).toBe(
      `${MOCK_SUPABASE_URL}/storage/v1/object/public/custom-bucket/file.txt`
    )
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
