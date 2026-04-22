import { describe, it, expect } from 'vitest'
import {
  COLLABORATION_TYPE_OPTIONS,
  collaborationPitchTemplate,
} from '../collaboration-pitch'

const baseInput = {
  companyName: 'The Cellar Room',
  contactName: 'Anna Lee',
  contactEmail: 'anna@cellarroom.com',
  collaborationType: 'venue' as const,
  website: 'https://cellarroom.com',
  bodyText:
    "We have a private dining space in Borough that we'd love to host a Social Seen tasting at.\n\nLet's chat about dates.",
}

describe('collaborationPitchTemplate', () => {
  it('prefixes subject with type label and company name', () => {
    const tpl = collaborationPitchTemplate(baseInput)
    expect(tpl.subject).toBe(
      '[Collab \u2014 Venue partnership] The Cellar Room',
    )
  })

  it('renders company / contact / email / type / website in detail rows', () => {
    const tpl = collaborationPitchTemplate(baseInput)
    expect(tpl.html).toContain('The Cellar Room')
    expect(tpl.html).toContain('Anna Lee')
    expect(tpl.html).toContain('anna@cellarroom.com')
    expect(tpl.html).toContain('Venue partnership')
    expect(tpl.html).toContain('https://cellarroom.com')
  })

  it('omits the website row when website is null', () => {
    const tpl = collaborationPitchTemplate({ ...baseInput, website: null })
    // Detail-row label "Website" must not be present when no website
    // was supplied. (We can't simply grep for "cellarroom.com" — the
    // contact email's domain is the same string in this fixture.)
    expect(tpl.html).not.toMatch(/>Website</)
    expect(tpl.html).not.toContain('https://cellarroom.com')
  })

  it('escapes HTML in the company / pitch body', () => {
    const tpl = collaborationPitchTemplate({
      ...baseInput,
      companyName: '<b>oops</b>',
      bodyText: '<script>alert(1)</script>',
    })
    expect(tpl.html).not.toContain('<b>oops</b>')
    expect(tpl.html).not.toContain('<script>alert(1)')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('renders blank-line-separated paragraphs as <p> blocks', () => {
    const tpl = collaborationPitchTemplate(baseInput)
    const paragraphCount = (
      tpl.html.match(/<p style="margin:0 0 16px 0/g) ?? []
    ).length
    expect(paragraphCount).toBe(2)
  })

  it('COLLABORATION_TYPE_OPTIONS exposes all 5 types', () => {
    expect(COLLABORATION_TYPE_OPTIONS).toHaveLength(5)
    expect(COLLABORATION_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      'venue',
      'brand',
      'sponsor',
      'press',
      'other',
    ])
  })
})
