import { describe, it, expect } from 'vitest'
import { eventReminderTemplate } from '../event-reminder'

const baseInput = {
  fullName: 'Charlotte Moreau',
  eventTitle: 'Wine & Wisdom',
  eventSlug: 'wine-and-wisdom',
  eventDate: 'Wednesday 7 May',
  eventTime: '7:00 PM',
  venueName: 'Vinopolis Cellar',
  venueAddress: '1 Bank End, London',
  postcode: 'SE1 9BU',
  venueRevealed: true,
  dressCode: 'Smart casual',
}

describe('eventReminderTemplate', () => {
  it('produces a "2 days away" variant with distinctive subject and heading', () => {
    const tpl = eventReminderTemplate({ ...baseInput, variant: '2day' })
    expect(tpl.subject).toBe('In 2 days: Wine & Wisdom')
    expect(tpl.html).toContain('Just a heads-up')
    expect(tpl.html).toContain('in 2 days')
  })

  it('produces a "today" variant with distinctive subject and heading', () => {
    const tpl = eventReminderTemplate({ ...baseInput, variant: 'today' })
    expect(tpl.subject).toBe('Tonight: Wine & Wisdom')
    expect(tpl.html).toContain('Tonight')
  })

  it('includes venue details when revealed', () => {
    const tpl = eventReminderTemplate({ ...baseInput, variant: '2day' })
    expect(tpl.html).toContain('Vinopolis Cellar')
    expect(tpl.html).toContain('SE1 9BU')
  })

  it('omits venue details when not revealed', () => {
    const tpl = eventReminderTemplate({
      ...baseInput,
      venueRevealed: false,
      variant: '2day',
    })
    expect(tpl.html).toContain('Revealed 1 week before')
    expect(tpl.html).not.toContain('Vinopolis Cellar')
    expect(tpl.html).not.toContain('SE1 9BU')
  })

  it('includes dress code when provided', () => {
    const tpl = eventReminderTemplate({ ...baseInput, variant: '2day' })
    expect(tpl.html).toContain('Dress code')
    expect(tpl.html).toContain('Smart casual')
  })

  it('omits dress code section when not provided', () => {
    const tpl = eventReminderTemplate({
      ...baseInput,
      dressCode: null,
      variant: '2day',
    })
    expect(tpl.html).not.toContain('Dress code')
  })

  it('escapes untrusted input in the event title', () => {
    const tpl = eventReminderTemplate({
      ...baseInput,
      eventTitle: '<script>x</script>',
      variant: 'today',
    })
    expect(tpl.html).not.toContain('<script>x</script>')
    expect(tpl.html).toContain('&lt;script&gt;')
  })

  it('plain-text version strips HTML tags', () => {
    const tpl = eventReminderTemplate({ ...baseInput, variant: '2day' })
    expect(tpl.text).not.toMatch(/<[^>]+>/)
  })
})
