import { describe, it, expect } from 'vitest'
import { formatPrice, formatPriceExact, poundsToPence, penceToPounds } from '../currency'

// ── formatPrice ───────────────────────────────────────────────────────────────

describe('formatPrice', () => {
  it('returns "Free" for 0 pence', () => {
    expect(formatPrice(0)).toBe('Free')
  })

  it('formats whole pounds — strips trailing .00', () => {
    expect(formatPrice(3500)).toBe('£35')
  })

  it('formats pence amounts — keeps fractional part', () => {
    expect(formatPrice(3550)).toBe('£35.50')
  })

  it('formats 100 pence as "£1"', () => {
    expect(formatPrice(100)).toBe('£1')
  })

  it('formats 1 pence as "£0.01"', () => {
    expect(formatPrice(1)).toBe('£0.01')
  })

  it('formats large amounts correctly', () => {
    expect(formatPrice(10000)).toBe('£100')
  })

  it('formats amounts with odd pence', () => {
    expect(formatPrice(999)).toBe('£9.99')
  })

  it('uses £ symbol (not GBP text)', () => {
    expect(formatPrice(3500)).toMatch(/^£/)
  })
})

// ── formatPriceExact ─────────────────────────────────────────────────────────

describe('formatPriceExact', () => {
  it('always shows two decimal places for whole pounds', () => {
    expect(formatPriceExact(3500)).toBe('£35.00')
  })

  it('shows pence when present', () => {
    expect(formatPriceExact(3550)).toBe('£35.50')
  })

  it('formats 0 pence as "£0.00" (not "Free")', () => {
    expect(formatPriceExact(0)).toBe('£0.00')
  })

  it('formats £1 as "£1.00"', () => {
    expect(formatPriceExact(100)).toBe('£1.00')
  })
})

// ── poundsToPence ────────────────────────────────────────────────────────────

describe('poundsToPence', () => {
  it('converts whole pounds (number) to pence', () => {
    expect(poundsToPence(35)).toBe(3500)
  })

  it('converts decimal pounds (number) to pence', () => {
    expect(poundsToPence(35.5)).toBe(3550)
  })

  it('accepts a string input (e.g. from a form field)', () => {
    expect(poundsToPence('35')).toBe(3500)
    expect(poundsToPence('35.50')).toBe(3550)
  })

  it('converts zero', () => {
    expect(poundsToPence(0)).toBe(0)
  })

  it('reflects IEEE 754 floating-point behaviour for 1.005', () => {
    // 1.005 cannot be represented exactly in IEEE 754; the stored value is
    // slightly below 1.005, so 1.005 * 100 ≈ 100.4999... and Math.round → 100.
    // This is expected JavaScript behaviour, not a bug in poundsToPence.
    expect(poundsToPence(1.005)).toBe(100)
  })
})

// ── penceToPounds ────────────────────────────────────────────────────────────

describe('penceToPounds', () => {
  it('converts pence to whole pounds', () => {
    expect(penceToPounds(3500)).toBe(35)
  })

  it('converts pence to decimal pounds', () => {
    expect(penceToPounds(3550)).toBe(35.5)
  })

  it('converts zero pence to zero pounds', () => {
    expect(penceToPounds(0)).toBe(0)
  })

  it('converts single pence correctly', () => {
    expect(penceToPounds(1)).toBe(0.01)
  })
})
