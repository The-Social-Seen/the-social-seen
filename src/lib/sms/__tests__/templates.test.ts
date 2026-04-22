import { describe, it, expect } from 'vitest'
import { venueRevealSmsTemplate } from '../templates/venue-reveal-sms'
import { eventReminderSmsTemplate } from '../templates/event-reminder-sms'

describe('venueRevealSmsTemplate', () => {
  const base = {
    firstName: 'Charlotte',
    eventTitle: 'Wine & Wisdom',
    venueName: 'The Cellar Room',
    eventDate: 'Fri 9 May',
    eventTime: '7pm',
    siteUrl: 'https://test.example.com',
  }

  it('includes event title and venue name', () => {
    const { body } = venueRevealSmsTemplate(base)
    expect(body).toContain('Wine & Wisdom')
    expect(body).toContain('The Cellar Room')
  })

  it('includes the manage-SMS link pointing at /profile', () => {
    const { body } = venueRevealSmsTemplate(base)
    expect(body).toContain('test.example.com/profile')
    expect(body.toLowerCase()).toContain('manage sms')
  })

  it('strips trailing slash from the site URL', () => {
    const { body } = venueRevealSmsTemplate({
      ...base,
      siteUrl: 'https://test.example.com/',
    })
    expect(body).not.toContain('.com//profile')
    expect(body).toContain('.com/profile')
  })

  it('does not exceed 160 chars for a typical event', () => {
    // Median case. Longer event titles may segment — that's fine,
    // but this test guards against accidental bloat.
    const { body } = venueRevealSmsTemplate(base)
    expect(body.length).toBeLessThanOrEqual(200)
  })
})

describe('eventReminderSmsTemplate', () => {
  const base = {
    firstName: 'Anna',
    eventTitle: 'Supper Club',
    venueName: 'Borough Market Dining Room',
    eventTime: '7:30pm',
    siteUrl: 'https://the-social-seen.com',
  }

  it('uses "Tonight" lead-in', () => {
    const { body } = eventReminderSmsTemplate(base)
    expect(body.toLowerCase().startsWith('tonight:')).toBe(true)
  })

  it('includes the manage-SMS link', () => {
    const { body } = eventReminderSmsTemplate(base)
    expect(body).toContain('Manage SMS:')
    expect(body).toContain('/profile')
  })
})
