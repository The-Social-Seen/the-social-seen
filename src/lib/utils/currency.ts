// ── Currency formatting ───────────────────────────────────────────────────────
// All prices are stored in the database as pence (integer).
// £35 is stored as 3500. Per ADR-01 and Amendment G-03.

/**
 * Format a pence amount for display.
 * - 0         → "Free"
 * - 3500      → "£35"
 * - 3550      → "£35.50"
 *
 * Rounds to the nearest penny; strips trailing .00 for whole pound amounts.
 */
export function formatPrice(pence: number): string {
  if (pence === 0) return 'Free'

  const pounds = pence / 100

  // Whole pounds → "£35", half-pounds → "£35.50" (preserve trailing zero)
  const hasSubPence = pence % 100 !== 0
  return new Intl.NumberFormat('en-GB', {
    style:                 'currency',
    currency:              'GBP',
    minimumFractionDigits: hasSubPence ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(pounds)
}

/**
 * Format a pence amount with explicit pence shown (e.g. for receipts).
 * - 3500  → "£35.00"
 * - 3550  → "£35.50"
 */
export function formatPriceExact(pence: number): string {
  const pounds = pence / 100
  return new Intl.NumberFormat('en-GB', {
    style:                 'currency',
    currency:              'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pounds)
}

/**
 * Convert a pound amount entered by a user (e.g. an admin form input)
 * to the pence integer stored in the database.
 * "35" → 3500 | "35.50" → 3550
 */
export function poundsToPence(pounds: number | string): number {
  return Math.round(Number(pounds) * 100)
}

/**
 * Convert a pence integer from the database to a pounds float.
 * 3500 → 35 | 3550 → 35.5
 */
export function penceToPounds(pence: number): number {
  return pence / 100
}
