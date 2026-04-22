import { describe, it, expect } from 'vitest'
import { LEGAL_LAST_UPDATED } from '../constants'

describe('LEGAL_LAST_UPDATED', () => {
  it('exports a non-empty human-readable UK date string', () => {
    expect(typeof LEGAL_LAST_UPDATED).toBe('string')
    expect(LEGAL_LAST_UPDATED.length).toBeGreaterThan(0)
    // "DD Month YYYY" — loose shape check, not a full grammar parse.
    expect(LEGAL_LAST_UPDATED).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/)
  })
})
