import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { canonicalUrl, getCanonicalSiteUrl } from '../site'

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_CANONICAL_URL

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_CANONICAL_URL
})

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_CANONICAL_URL
  } else {
    process.env.NEXT_PUBLIC_CANONICAL_URL = ORIGINAL_ENV
  }
})

describe('getCanonicalSiteUrl', () => {
  it('falls back to SITE_CONFIG.url when env not set', () => {
    expect(getCanonicalSiteUrl()).toBe('https://thesocialseen.com')
  })

  it('uses NEXT_PUBLIC_CANONICAL_URL when set with https://', () => {
    process.env.NEXT_PUBLIC_CANONICAL_URL = 'https://staging.example.com'
    expect(getCanonicalSiteUrl()).toBe('https://staging.example.com')
  })

  it('strips trailing slashes from env value', () => {
    process.env.NEXT_PUBLIC_CANONICAL_URL = 'https://staging.example.com///'
    expect(getCanonicalSiteUrl()).toBe('https://staging.example.com')
  })

  it('refuses non-https env values and falls back to default', () => {
    process.env.NEXT_PUBLIC_CANONICAL_URL = 'http://insecure.example.com'
    expect(getCanonicalSiteUrl()).toBe('https://thesocialseen.com')
  })

  it('refuses junk env values and falls back to default', () => {
    process.env.NEXT_PUBLIC_CANONICAL_URL = 'not a url'
    expect(getCanonicalSiteUrl()).toBe('https://thesocialseen.com')
  })

  it('trims trailing whitespace/newlines smuggled in via env paste', () => {
    process.env.NEXT_PUBLIC_CANONICAL_URL = '  https://staging.example.com\n'
    expect(getCanonicalSiteUrl()).toBe('https://staging.example.com')
  })

  // Vercel preview URL fallback should NOT be used here — that's the
  // email helper's concern. SEO surfaces always emit the prod canonical.
  it('does not consult NEXT_PUBLIC_VERCEL_URL', () => {
    const prevVercel = process.env.NEXT_PUBLIC_VERCEL_URL
    process.env.NEXT_PUBLIC_VERCEL_URL = 'preview-deploy.vercel.app'
    expect(getCanonicalSiteUrl()).toBe('https://thesocialseen.com')
    if (prevVercel === undefined) {
      delete process.env.NEXT_PUBLIC_VERCEL_URL
    } else {
      process.env.NEXT_PUBLIC_VERCEL_URL = prevVercel
    }
  })
})

describe('canonicalUrl', () => {
  it('joins a leading-slash path correctly', () => {
    expect(canonicalUrl('/events')).toBe('https://thesocialseen.com/events')
  })

  it('normalises a missing leading slash', () => {
    expect(canonicalUrl('events/past')).toBe(
      'https://thesocialseen.com/events/past',
    )
  })

  it('handles root path', () => {
    expect(canonicalUrl('/')).toBe('https://thesocialseen.com/')
  })
})
