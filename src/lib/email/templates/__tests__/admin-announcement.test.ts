import { describe, it, expect } from 'vitest'
import { adminAnnouncementTemplate } from '../admin-announcement'

// Ensures the unsubscribe-token lib has a signing secret during test runs.
process.env.UNSUBSCRIBE_TOKEN_SECRET ||=
  'deterministic-test-secret-for-admin-announcement-template'

const baseInput = {
  userId: '11111111-2222-3333-4444-555555555555',
  fullName: 'Charlotte Moreau',
  eventTitle: 'Wine & Wisdom',
  eventSlug: 'wine-and-wisdom',
  subject: 'Venue moved next door',
  bodyText:
    "We've moved tonight's tasting next door to The Cellar Room.\n\nSame time, same plan — just look for the gold sign.",
}

describe('adminAnnouncementTemplate', () => {
  it('uses the admin-supplied subject as-is (no prefix)', () => {
    const tpl = adminAnnouncementTemplate(baseInput)
    expect(tpl.subject).toBe('Venue moved next door')
  })

  it('greets recipient by first name only', () => {
    const tpl = adminAnnouncementTemplate(baseInput)
    expect(tpl.html).toContain('Hi Charlotte')
    expect(tpl.html).not.toContain('Charlotte Moreau')
  })

  it('renders blank-line-separated paragraphs as <p> blocks', () => {
    const tpl = adminAnnouncementTemplate(baseInput)
    const paragraphCount = (tpl.html.match(/<p style="margin:0 0 16px 0/g) ?? [])
      .length
    expect(paragraphCount).toBe(2)
  })

  it('escapes HTML in the body to prevent injection', () => {
    const tpl = adminAnnouncementTemplate({
      ...baseInput,
      bodyText: '<script>alert(1)</script> hello',
    })
    expect(tpl.html).not.toContain('<script>alert(1)')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('escapes HTML in the subject', () => {
    const tpl = adminAnnouncementTemplate({
      ...baseInput,
      subject: '<b>oops</b>',
    })
    expect(tpl.html).not.toContain('<b>oops</b>')
    expect(tpl.html).toContain('&lt;b&gt;oops&lt;/b&gt;')
  })

  it('includes a CTA linking back to the event page', () => {
    const tpl = adminAnnouncementTemplate(baseInput)
    expect(tpl.html).toContain('/events/wine-and-wisdom')
    expect(tpl.html).toContain('View Event')
  })

  it('produces a non-empty plain-text fallback', () => {
    const tpl = adminAnnouncementTemplate(baseInput)
    expect(tpl.text.length).toBeGreaterThan(20)
    expect(tpl.text).toContain('Venue moved next door')
  })
})
