import { describe, it, expect } from 'vitest'
import { sanitizeRedirectPath } from '../redirect'

describe('sanitizeRedirectPath', () => {
  // ── Accepts safe relative paths ──────────────────────────────────────────
  it.each([
    '/events',
    '/events/wine-and-wisdom',
    '/profile',
    '/admin/events',
    '/',
    '/path?with=query&params=ok',
  ])('returns %s unchanged when safe', (input) => {
    expect(sanitizeRedirectPath(input)).toBe(input)
  })

  // ── Rejects open-redirect vectors ────────────────────────────────────────
  it.each([
    ['//evil.com', '/events'],
    ['//evil.com/path', '/events'],
    ['\\/evil.com', '/events'],
    ['\\/\\/evil.com', '/events'],
    ['https://evil.com', '/events'],
    ['http://evil.com', '/events'],
    ['javascript://alert(1)', '/events'],
    ['ftp://evil.com', '/events'],
    ['evil.com', '/events'], // no leading slash
    ['relative/path', '/events'],
  ])('rejects %s and returns the fallback', (input, expected) => {
    expect(sanitizeRedirectPath(input)).toBe(expected)
  })

  // ── Falsy inputs use the fallback ────────────────────────────────────────
  it('returns default fallback for null', () => {
    expect(sanitizeRedirectPath(null)).toBe('/events')
  })

  it('returns default fallback for undefined', () => {
    expect(sanitizeRedirectPath(undefined)).toBe('/events')
  })

  it('returns default fallback for empty string', () => {
    expect(sanitizeRedirectPath('')).toBe('/events')
  })

  // ── Custom fallback ──────────────────────────────────────────────────────
  it('honours custom fallback when input is unsafe', () => {
    expect(sanitizeRedirectPath('https://evil.com', '/login')).toBe('/login')
  })

  it('honours custom fallback when input is null', () => {
    expect(sanitizeRedirectPath(null, '/profile')).toBe('/profile')
  })
})
