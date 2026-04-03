import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatDateCard,
  formatDateModal,
  formatDateFull,
  formatTime,
  formatTimeRange,
  formatDuration,
  formatRelative,
  isPastEvent,
  isWithin48Hours,
} from '../dates'

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Saturday 14 March 2026, 19:00 London time (GMT — BST hasn't started yet)
// UTC = GMT in March, so no offset needed.
const SAT_14_MAR_19H = '2026-03-14T19:00:00.000Z'

// Wednesday 15 July 2026, 19:00 London time (BST = UTC+1, so 18:00 UTC)
const WED_15_JUL_19H_BST = '2026-07-15T18:00:00.000Z'

// ── Tier 1: formatDateCard ───────────────────────────────────────────────────

describe('formatDateCard', () => {
  it('formats GMT date as "Sat 14 Mar"', () => {
    expect(formatDateCard(SAT_14_MAR_19H)).toBe('Sat 14 Mar')
  })

  it('formats BST date correctly — timezone offset applied', () => {
    // 18:00 UTC = 19:00 BST; date is still 15 Jul in London
    expect(formatDateCard(WED_15_JUL_19H_BST)).toBe('Wed 15 Jul')
  })

  it('accepts a Date object as well as an ISO string', () => {
    expect(formatDateCard(new Date(SAT_14_MAR_19H))).toBe('Sat 14 Mar')
  })

  it('handles start of month correctly', () => {
    // 2026-04-01T10:00:00Z = Wednesday 1 April (GMT, BST starts 29 Mar 2026)
    expect(formatDateCard('2026-04-01T10:00:00.000Z')).toBe('Wed 1 Apr')
  })
})

// ── Tier 2: formatDateModal ──────────────────────────────────────────────────

describe('formatDateModal', () => {
  it('formats as "Saturday 14 March, 7:00 PM"', () => {
    expect(formatDateModal(SAT_14_MAR_19H)).toBe('Saturday 14 March, 7:00 PM')
  })

  it('includes full weekday and month names', () => {
    expect(formatDateModal(WED_15_JUL_19H_BST)).toBe('Wednesday 15 July, 7:00 PM')
  })

  it('includes comma before time', () => {
    const result = formatDateModal(SAT_14_MAR_19H)
    expect(result).toMatch(/,\s7:00 PM$/)
  })
})

// ── Tier 3: formatDateFull ───────────────────────────────────────────────────

describe('formatDateFull', () => {
  it('formats as "Saturday 14 March 2026"', () => {
    expect(formatDateFull(SAT_14_MAR_19H)).toBe('Saturday 14 March 2026')
  })

  it('includes the year', () => {
    expect(formatDateFull(WED_15_JUL_19H_BST)).toBe('Wednesday 15 July 2026')
  })

  it('has no comma (differs from modal format)', () => {
    const result = formatDateFull(SAT_14_MAR_19H)
    expect(result).not.toContain(',')
  })
})

// ── formatTime ───────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('formats 19:00 as "7:00 PM"', () => {
    expect(formatTime(SAT_14_MAR_19H)).toBe('7:00 PM')
  })

  it('formats noon as "12:00 PM"', () => {
    expect(formatTime('2026-03-14T12:00:00.000Z')).toBe('12:00 PM')
  })

  it('formats midnight as "12:00 AM"', () => {
    expect(formatTime('2026-03-14T00:00:00.000Z')).toBe('12:00 AM')
  })

  it('formats 9:30 AM correctly', () => {
    // 2026-03-14T09:30:00Z = 9:30 AM London (GMT)
    expect(formatTime('2026-03-14T09:30:00.000Z')).toBe('9:30 AM')
  })

  it('formats 23:00 as "11:00 PM"', () => {
    expect(formatTime('2026-03-14T23:00:00.000Z')).toBe('11:00 PM')
  })

  it('pads minutes with two digits', () => {
    // 19:05 London
    expect(formatTime('2026-03-14T19:05:00.000Z')).toBe('7:05 PM')
  })

  it('applies BST offset (18:00 UTC = 19:00 BST)', () => {
    expect(formatTime(WED_15_JUL_19H_BST)).toBe('7:00 PM')
  })
})

// ── formatTimeRange ──────────────────────────────────────────────────────────

describe('formatTimeRange', () => {
  it('formats a 3-hour evening range', () => {
    expect(
      formatTimeRange(
        '2026-03-14T19:00:00.000Z',
        '2026-03-14T22:00:00.000Z'
      )
    ).toBe('7:00 PM – 10:00 PM')
  })

  it('uses an en-dash (–) as separator', () => {
    const result = formatTimeRange(SAT_14_MAR_19H, '2026-03-14T22:00:00.000Z')
    expect(result).toContain('–')
  })

  it('formats a morning range correctly', () => {
    expect(
      formatTimeRange(
        '2026-03-14T09:00:00.000Z',
        '2026-03-14T10:30:00.000Z'
      )
    ).toBe('9:00 AM – 10:30 AM')
  })
})

// ── formatDuration ───────────────────────────────────────────────────────────

describe('formatDuration', () => {
  const start = new Date('2026-03-14T19:00:00Z')

  it('returns "3 hours" for 180-minute duration', () => {
    expect(formatDuration(start, new Date('2026-03-14T22:00:00Z'))).toBe('3 hours')
  })

  it('returns "1 hour" (singular) for exactly 60 minutes', () => {
    expect(formatDuration(start, new Date('2026-03-14T20:00:00Z'))).toBe('1 hour')
  })

  it('returns "2 hours 30 minutes" for 150-minute duration', () => {
    expect(formatDuration(start, new Date('2026-03-14T21:30:00Z'))).toBe('2 hours 30 minutes')
  })

  it('returns "45 minutes" for sub-hour duration', () => {
    expect(formatDuration(start, new Date('2026-03-14T19:45:00Z'))).toBe('45 minutes')
  })

  it('returns "1 minute" (singular)', () => {
    expect(formatDuration(start, new Date('2026-03-14T19:01:00Z'))).toBe('1 minute')
  })

  it('returns "1 hour 1 minute" (both singular)', () => {
    expect(formatDuration(start, new Date('2026-03-14T20:01:00Z'))).toBe('1 hour 1 minute')
  })

  it('accepts ISO strings as well as Date objects', () => {
    expect(
      formatDuration('2026-03-14T19:00:00Z', '2026-03-14T22:00:00Z')
    ).toBe('3 hours')
  })
})

// ── formatRelative ───────────────────────────────────────────────────────────

describe('formatRelative', () => {
  // Fix "now" to noon on Saturday 14 March 2026
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-14T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "Today" for a date on the same calendar day', () => {
    expect(formatRelative('2026-03-14T19:00:00.000Z')).toBe('Today')
  })

  it('returns "Tomorrow" for a date ~24 hours ahead', () => {
    expect(formatRelative('2026-03-15T12:00:00.000Z')).toBe('Tomorrow')
  })

  it('returns "Yesterday" for a date ~24 hours ago', () => {
    expect(formatRelative('2026-03-13T12:00:00.000Z')).toBe('Yesterday')
  })

  it('returns "In 2 days" for 2 days ahead', () => {
    expect(formatRelative('2026-03-16T12:00:00.000Z')).toBe('In 2 days')
  })

  it('returns "In 7 days" for exactly 7 days ahead (boundary)', () => {
    expect(formatRelative('2026-03-21T12:00:00.000Z')).toBe('In 7 days')
  })

  it('returns "2 days ago" for 2 days in the past', () => {
    expect(formatRelative('2026-03-12T12:00:00.000Z')).toBe('2 days ago')
  })

  it('returns "7 days ago" for exactly 7 days ago (boundary)', () => {
    expect(formatRelative('2026-03-07T12:00:00.000Z')).toBe('7 days ago')
  })

  it('falls back to formatDateCard for dates > 7 days in the future', () => {
    // 22 days out — should show as a date card
    expect(formatRelative('2026-04-05T12:00:00.000Z')).toBe('Sun 5 Apr')
  })

  it('falls back to formatDateCard for dates > 7 days in the past', () => {
    expect(formatRelative('2026-03-01T12:00:00.000Z')).toBe('Sun 1 Mar')
  })
})

// ── isPastEvent ──────────────────────────────────────────────────────────────

describe('isPastEvent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-14T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true for a date in the past', () => {
    expect(isPastEvent('2026-03-13T19:00:00.000Z')).toBe(true)
  })

  it('returns false for a date in the future', () => {
    expect(isPastEvent('2026-03-15T19:00:00.000Z')).toBe(false)
  })

  it('accepts a Date object', () => {
    expect(isPastEvent(new Date('2026-01-01T00:00:00Z'))).toBe(true)
  })
})

// ── isWithin48Hours ──────────────────────────────────────────────────────────

describe('isWithin48Hours', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-14T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true for an event 24 hours from now', () => {
    expect(isWithin48Hours('2026-03-15T12:00:00.000Z')).toBe(true)
  })

  it('returns true for an event 47 hours from now (just inside boundary)', () => {
    expect(isWithin48Hours('2026-03-16T11:00:00.000Z')).toBe(true)
  })

  it('returns true for an event exactly 48 hours away (boundary — inclusive <=)', () => {
    // Implementation uses `diffMs <= 48h`, so the boundary is inclusive.
    expect(isWithin48Hours('2026-03-16T12:00:00.000Z')).toBe(true)
  })

  it('returns false for an event more than 48 hours away', () => {
    expect(isWithin48Hours('2026-03-17T12:00:00.000Z')).toBe(false)
  })

  it('returns false for a past event', () => {
    expect(isWithin48Hours('2026-03-13T12:00:00.000Z')).toBe(false)
  })
})
