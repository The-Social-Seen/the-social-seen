import { describe, it, expect } from 'vitest'
import {
  CONTACT_SUBJECT_OPTIONS,
  contactMessageTemplate,
} from '../contact-message'

const baseInput = {
  fromName: 'Charlotte Davis',
  fromEmail: 'charlotte@example.com',
  subject: 'general' as const,
  bodyText:
    'Hello — I came across your gallery from a friend.\n\nWould love to know how membership works.',
}

describe('contactMessageTemplate', () => {
  it('prefixes subject with topic label and sender name', () => {
    const tpl = contactMessageTemplate(baseInput)
    expect(tpl.subject).toBe('[Contact \u2014 General enquiry] Charlotte Davis')
  })

  it('renders sender name + email + topic label in detail rows', () => {
    const tpl = contactMessageTemplate(baseInput)
    expect(tpl.html).toContain('Charlotte Davis')
    expect(tpl.html).toContain('charlotte@example.com')
    expect(tpl.html).toContain('General enquiry')
  })

  it('escapes HTML in the body to prevent injection', () => {
    const tpl = contactMessageTemplate({
      ...baseInput,
      bodyText: '<script>alert(1)</script>',
    })
    expect(tpl.html).not.toContain('<script>alert(1)')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('escapes HTML in the sender name', () => {
    const tpl = contactMessageTemplate({
      ...baseInput,
      fromName: '<b>oops</b>',
    })
    expect(tpl.html).not.toContain('<b>oops</b>')
  })

  it('renders blank-line-separated paragraphs as <p> blocks', () => {
    const tpl = contactMessageTemplate(baseInput)
    const paragraphCount = (
      tpl.html.match(/<p style="margin:0 0 16px 0/g) ?? []
    ).length
    expect(paragraphCount).toBe(2)
  })

  it('produces a non-empty plain-text fallback', () => {
    const tpl = contactMessageTemplate(baseInput)
    expect(tpl.text.length).toBeGreaterThan(20)
    expect(tpl.text).toContain('Charlotte Davis')
  })

  it('CONTACT_SUBJECT_OPTIONS exposes all 4 categories with labels', () => {
    expect(CONTACT_SUBJECT_OPTIONS).toHaveLength(4)
    expect(CONTACT_SUBJECT_OPTIONS.map((o) => o.value)).toEqual([
      'general',
      'event_enquiry',
      'collaboration',
      'press',
    ])
  })
})
