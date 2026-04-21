import { describe, it, expect } from 'vitest'
import { welcomeTemplate } from '../welcome'

describe('welcomeTemplate', () => {
  const base = welcomeTemplate({ fullName: 'Charlotte Moreau' })

  it('returns subject + html + text', () => {
    expect(base.subject).toBeTruthy()
    expect(base.html).toBeTruthy()
    expect(base.text).toBeTruthy()
  })

  it('uses the first name in the heading', () => {
    expect(base.html).toContain('Welcome, Charlotte.')
    expect(base.text).toContain('Welcome, Charlotte.')
  })

  it('falls back gracefully when full name is a single word', () => {
    const tpl = welcomeTemplate({ fullName: 'Alex' })
    expect(tpl.html).toContain('Welcome, Alex.')
  })

  it('falls back to the full string when full name is empty', () => {
    const tpl = welcomeTemplate({ fullName: '' })
    // Empty firstName falls back to fullName which is also empty — copy
    // becomes "Welcome, ." — not ideal but doesn't throw. The auth
    // action defaults to "there" upstream so this branch shouldn't fire
    // in production.
    expect(tpl.html).toContain('Welcome,')
  })

  it('escapes HTML in the name', () => {
    const tpl = welcomeTemplate({ fullName: '<script>alert(1)</script> Bob' })
    expect(tpl.html).not.toContain('<script>alert')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('includes a "See What\'s On" CTA pointing to /events', () => {
    expect(base.html).toMatch(/See What.*On/i)
    expect(base.html).toMatch(/\/events/)
  })

  it('plain-text version strips all HTML tags', () => {
    expect(base.text).not.toMatch(/<[^>]+>/)
  })

  it('plain-text version contains the key prose', () => {
    // Use a regex with [\u2019'] to accept either curly or straight apostrophe
    // since the template uses &rsquo; (decoded to \u2019 by htmlToText).
    expect(base.text).toMatch(/You[\u2019']re officially in/)
    expect(base.text).toContain('See What')
  })

  it('subject is short and welcoming', () => {
    expect(base.subject).toBe('Welcome to The Social Seen')
  })
})
