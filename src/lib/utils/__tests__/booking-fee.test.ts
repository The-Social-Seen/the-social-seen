import { describe, it, expect } from 'vitest'
import { calculateBookingFeePence } from '../booking-fee'

// Backed by SYSTEM-DESIGN-refund-fee-deduction.md §2.4 — these are the
// expected output values from the locked formula. If you change either
// the formula or its constants, update both this table and the helper
// JSDoc examples in the same commit.

describe('calculateBookingFeePence', () => {
  describe('guard branches', () => {
    it('returns 0 for free events (price 0)', () => {
      expect(calculateBookingFeePence(0)).toBe(0)
    })

    it('returns 0 for negative prices (defensive)', () => {
      // Callers should never pass negative prices, but we don't want a
      // NaN / Infinity propagating into Stripe.
      expect(calculateBookingFeePence(-1)).toBe(0)
      expect(calculateBookingFeePence(-100)).toBe(0)
    })
  })

  describe('happy path (spec §2.4 examples)', () => {
    it('£20 → 60p (£20.60 inclusive total)', () => {
      // Exact = (2000 * 0.015 + 20) / 0.985 = 50 / 0.985 ≈ 50.76
      // Round up to nearest 10p → 60p.
      expect(calculateBookingFeePence(2000)).toBe(60)
    })

    it('£50 → £1.00 (£51.00 inclusive total)', () => {
      // Exact = (5000 * 0.015 + 20) / 0.985 = 95 / 0.985 ≈ 96.45
      // Round up to nearest 10p → 100p (£1.00).
      expect(calculateBookingFeePence(5000)).toBe(100)
    })

    it('£100 → £1.80 (£101.80 inclusive total)', () => {
      // Exact = (10000 * 0.015 + 20) / 0.985 = 170 / 0.985 ≈ 172.59
      // Round up to nearest 10p → 180p (£1.80).
      expect(calculateBookingFeePence(10000)).toBe(180)
    })

    it('£150 → £2.50 (£152.50 inclusive total)', () => {
      // Exact = (15000 * 0.015 + 20) / 0.985 = 245 / 0.985 ≈ 248.73
      // Round up to nearest 10p → 250p (£2.50).
      expect(calculateBookingFeePence(15000)).toBe(250)
    })
  })

  describe('boundary / sanity (spec §2.4 extras)', () => {
    it('£0.01 → 30p (sanity — flat fee dominates)', () => {
      // Exact = (1 * 0.015 + 20) / 0.985 = 20.015 / 0.985 ≈ 20.32
      // Round up to nearest 10p → 30p.
      expect(calculateBookingFeePence(1)).toBe(30)
    })

    it('£1000 → £15.50 (sanity — high-priced event)', () => {
      // Exact = (100000 * 0.015 + 20) / 0.985 = 1520 / 0.985 ≈ 1543.15
      // Round up to nearest 10p → 1550p (£15.50). At high prices the
      // 1.5% percentage component dominates the 20p flat.
      expect(calculateBookingFeePence(100000)).toBe(1550)
    })
  })

  describe('algebraic properties', () => {
    it('result is always a multiple of ROUND_UP_PENCE (10p)', () => {
      for (const price of [1, 99, 500, 1234, 7777, 12345]) {
        const fee = calculateBookingFeePence(price)
        expect(fee % 10).toBe(0)
      }
    })

    it('fee is monotonically non-decreasing as price increases', () => {
      let last = 0
      for (const price of [0, 100, 500, 1000, 2000, 5000, 10000, 50000]) {
        const fee = calculateBookingFeePence(price)
        expect(fee).toBeGreaterThanOrEqual(last)
        last = fee
      }
    })

    it('fee floor is at least the flat 20p (rounded up to 30p) for any positive price', () => {
      for (const price of [1, 50, 99, 100]) {
        expect(calculateBookingFeePence(price)).toBeGreaterThanOrEqual(30)
      }
    })
  })
})
