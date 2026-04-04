import { describe, it, expect } from 'vitest'
import { generateIcsContent } from '../calendar'

// ── Fixture ──────────────────────────────────────────────────────────────────

const sampleEvent = {
  title: 'Wine & Wisdom at Borough Market',
  dateTime: '2026-03-14T19:00:00Z',
  endTime: '2026-03-14T22:00:00Z',
  venueName: 'The Vinopolis Wine Cellar',
  venueAddress: '1 Bank End, London SE1 9BU',
  shortDescription: 'An evening of wine tasting and conversation',
  slug: 'wine-and-wisdom',
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('generateIcsContent', () => {
  it('returns a valid VCALENDAR wrapper', () => {
    const ics = generateIcsContent(sampleEvent)

    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
  })

  it('includes PRODID header for The Social Seen', () => {
    const ics = generateIcsContent(sampleEvent)

    expect(ics).toContain('PRODID:-//The Social Seen//Events//EN')
  })

  it('contains a VEVENT block', () => {
    const ics = generateIcsContent(sampleEvent)

    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
  })

  it('formats DTSTART and DTEND in UTC (Z suffix)', () => {
    const ics = generateIcsContent(sampleEvent)

    expect(ics).toContain('DTSTART:20260314T190000Z')
    expect(ics).toContain('DTEND:20260314T220000Z')
  })

  it('includes event title as SUMMARY', () => {
    const ics = generateIcsContent(sampleEvent)

    expect(ics).toContain('SUMMARY:Wine & Wisdom at Borough Market')
  })

  it('includes venue name and address in LOCATION', () => {
    const ics = generateIcsContent(sampleEvent)

    // Commas are escaped in ICS format
    expect(ics).toContain(
      'LOCATION:The Vinopolis Wine Cellar\\, 1 Bank End\\, London SE1 9BU'
    )
  })

  it('includes short description as DESCRIPTION', () => {
    const ics = generateIcsContent(sampleEvent)

    expect(ics).toContain('DESCRIPTION:An evening of wine tasting and conversation')
  })

  it('generates a unique UID from slug and start date', () => {
    const ics = generateIcsContent(sampleEvent)

    expect(ics).toContain('UID:wine-and-wisdom-20260314T190000Z@thesocialseen.com')
  })

  it('includes CALSCALE and METHOD', () => {
    const ics = generateIcsContent(sampleEvent)

    expect(ics).toContain('CALSCALE:GREGORIAN')
    expect(ics).toContain('METHOD:PUBLISH')
  })

  it('uses CRLF line endings per ICS spec', () => {
    const ics = generateIcsContent(sampleEvent)

    // Lines are joined with \r\n
    expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0')
  })

  it('escapes semicolons in text fields', () => {
    const ics = generateIcsContent({
      ...sampleEvent,
      title: 'Wine; Wisdom; Friends',
    })

    expect(ics).toContain('SUMMARY:Wine\\; Wisdom\\; Friends')
  })

  it('escapes newlines in description', () => {
    const ics = generateIcsContent({
      ...sampleEvent,
      shortDescription: 'Line one\nLine two',
    })

    expect(ics).toContain('DESCRIPTION:Line one\\nLine two')
  })
})
