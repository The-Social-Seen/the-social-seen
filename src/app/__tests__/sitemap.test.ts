import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the published-events query so the sitemap test doesn't reach
// for Supabase. We assert sitemap structure given a known input.
vi.mock('@/lib/supabase/queries/events', () => ({
  getPublishedEvents: vi.fn(),
}))

import { getPublishedEvents } from '@/lib/supabase/queries/events'
import sitemap from '../sitemap'
import robots from '../robots'

const mockedGetPublishedEvents = vi.mocked(getPublishedEvents)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('sitemap', () => {
  it('includes every required public route + event slugs', async () => {
    mockedGetPublishedEvents.mockResolvedValue([
      {
        id: 'evt-1',
        slug: 'wine-night',
        updated_at: '2026-04-15T10:00:00Z',
        created_at: '2026-04-01T10:00:00Z',
      },
    ] as unknown as Awaited<ReturnType<typeof getPublishedEvents>>)

    const result = await sitemap()
    const urls = result.map((r) => r.url)

    // Static
    expect(urls).toContain('https://thesocialseen.com/')
    expect(urls).toContain('https://thesocialseen.com/events')
    expect(urls).toContain('https://thesocialseen.com/events/past')
    expect(urls).toContain('https://thesocialseen.com/gallery')
    expect(urls).toContain('https://thesocialseen.com/about')
    expect(urls).toContain('https://thesocialseen.com/contact')
    expect(urls).toContain('https://thesocialseen.com/collaborate')
    expect(urls).toContain('https://thesocialseen.com/join')
    expect(urls).toContain('https://thesocialseen.com/privacy')
    expect(urls).toContain('https://thesocialseen.com/terms')

    // Dynamic event slug
    expect(urls).toContain('https://thesocialseen.com/events/wine-night')
  })

  it('does NOT include any blocked route', async () => {
    mockedGetPublishedEvents.mockResolvedValue([])

    const result = await sitemap()
    const urls = result.map((r) => r.url)

    for (const blocked of [
      '/admin',
      '/api',
      '/profile',
      '/bookings',
      '/account-suspended',
      '/verify',
      '/forgot-password',
      '/reset-password',
    ]) {
      expect(urls.some((u) => u.includes(blocked))).toBe(false)
    }
  })

  it('uses the event updated_at for dynamic lastModified', async () => {
    mockedGetPublishedEvents.mockResolvedValue([
      {
        id: 'evt-1',
        slug: 'wine-night',
        updated_at: '2026-04-15T10:00:00Z',
        created_at: '2026-04-01T10:00:00Z',
      },
    ] as unknown as Awaited<ReturnType<typeof getPublishedEvents>>)

    const result = await sitemap()
    const eventEntry = result.find(
      (r) => r.url === 'https://thesocialseen.com/events/wine-night',
    )
    expect(eventEntry?.lastModified).toEqual(
      new Date('2026-04-15T10:00:00Z'),
    )
  })
})

describe('robots', () => {
  it('disallows admin / api / member-only / auth routes', () => {
    const r = robots()
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules]
    const disallow = rules
      .flatMap((rule) =>
        Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow],
      )
      .filter(Boolean) as string[]

    expect(disallow).toContain('/admin/')
    expect(disallow).toContain('/api/')
    expect(disallow).toContain('/profile')
    expect(disallow).toContain('/bookings')
    expect(disallow).toContain('/account-suspended')
    expect(disallow).toContain('/verify')
    expect(disallow).toContain('/forgot-password')
    expect(disallow).toContain('/reset-password')
  })

  it('points sitemap at the canonical URL', () => {
    const r = robots()
    expect(r.sitemap).toBe('https://thesocialseen.com/sitemap.xml')
  })
})
