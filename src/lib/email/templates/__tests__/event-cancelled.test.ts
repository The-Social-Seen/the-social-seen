import { describe, it, expect } from 'vitest'
import { eventCancelledTemplate } from '../event-cancelled'

const baseInput = {
  fullName: 'Charlotte Moreau',
  eventTitle: 'Wine & Wisdom',
  eventDate: 'Wednesday 7 May',
  eventTime: '7:00 PM',
}

describe('eventCancelledTemplate', () => {
  describe('confirmed_refunded variant', () => {
    it('renders the refund amount in the body when provided', () => {
      const tpl = eventCancelledTemplate({
        ...baseInput,
        variant: 'confirmed_refunded',
        refundedAmountPence: 2060,
      })
      expect(tpl.subject).toMatch(/cancelled.*Wine & Wisdom.*refund/i)
      expect(tpl.html).toContain('£20.60')
      expect(tpl.html).toContain('5–10 working days')
      // Plain-text fallback must also contain the refund amount.
      expect(tpl.text).toContain('£20.60')
    })

    it('falls back gracefully when refundedAmountPence omitted', () => {
      const tpl = eventCancelledTemplate({
        ...baseInput,
        variant: 'confirmed_refunded',
      })
      expect(tpl.subject).toMatch(/cancelled.*Wine & Wisdom.*refund/i)
      expect(tpl.html).toContain('5–10 working days')
      // No specific amount asserted — the fallback copy still describes
      // a refund without the figure.
      expect(tpl.html).toContain('refund')
    })
  })

  describe('confirmed_free variant', () => {
    it('omits refund language', () => {
      const tpl = eventCancelledTemplate({
        ...baseInput,
        variant: 'confirmed_free',
      })
      expect(tpl.subject).toBe("We've cancelled Wine & Wisdom")
      expect(tpl.html).toContain('free event')
      // No refund amount displayed.
      expect(tpl.html).not.toContain('£')
    })
  })

  describe('waitlisted variant', () => {
    it('uses waitlist-specific subject and tone', () => {
      const tpl = eventCancelledTemplate({
        ...baseInput,
        variant: 'waitlisted',
      })
      expect(tpl.subject).toBe('Wine & Wisdom has been cancelled — heads-up')
      expect(tpl.html).toContain('waitlist')
      expect(tpl.html).not.toContain('£')
    })
  })

  describe('pending_payment variant', () => {
    it('reassures the user that no charge has been made', () => {
      const tpl = eventCancelledTemplate({
        ...baseInput,
        variant: 'pending_payment',
      })
      expect(tpl.subject).toBe('Wine & Wisdom has been cancelled')
      expect(tpl.html).toMatch(/no charge/i)
    })
  })

  describe('shared rendering', () => {
    it('renders the event title and timing in every variant', () => {
      for (const variant of [
        'confirmed_refunded',
        'confirmed_free',
        'waitlisted',
        'pending_payment',
      ] as const) {
        const tpl = eventCancelledTemplate({ ...baseInput, variant })
        expect(tpl.html).toContain('Wine &amp; Wisdom')
        expect(tpl.html).toContain('Wednesday 7 May')
        expect(tpl.html).toContain('7:00 PM')
      }
    })

    it('uses recipient first name in the greeting', () => {
      const tpl = eventCancelledTemplate({
        ...baseInput,
        variant: 'confirmed_free',
      })
      // Greeting uses split-by-whitespace first token.
      expect(tpl.html).toContain('Hi Charlotte')
    })

    it('returns subject + html + text', () => {
      const tpl = eventCancelledTemplate({
        ...baseInput,
        variant: 'confirmed_free',
      })
      expect(tpl.subject).toBeTruthy()
      expect(tpl.html).toBeTruthy()
      expect(tpl.text).toBeTruthy()
      // text is a stripped version of html; should not contain tags.
      expect(tpl.text).not.toMatch(/<[^>]+>/)
    })
  })
})
