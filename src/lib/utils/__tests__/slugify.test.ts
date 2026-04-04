import { describe, it, expect, vi } from 'vitest'
import { slugify, uniqueSlug } from '../slugify'

// ── slugify ───────────────────────────────────────────────────────────────────

describe('slugify', () => {
  // Examples taken directly from the function's JSDoc
  it('replaces & with "and"', () => {
    expect(slugify('Wine & Wisdom at Borough Market')).toBe(
      'wine-and-wisdom-at-borough-market'
    )
  })

  it('removes straight apostrophes', () => {
    expect(slugify("Chef's Table at The Clove Club")).toBe(
      'chefs-table-at-the-clove-club'
    )
  })

  it('handles em dash surrounded by spaces', () => {
    expect(slugify("Jazz & Cocktails — Ronnie Scott's")).toBe(
      'jazz-and-cocktails-ronnie-scotts'
    )
  })

  it('lowercases all characters', () => {
    expect(slugify('ROOFTOP DRINKS')).toBe('rooftop-drinks')
  })

  it('converts spaces to hyphens', () => {
    expect(slugify('Supper Club')).toBe('supper-club')
  })

  it('collapses multiple spaces into a single hyphen', () => {
    expect(slugify('Drinks   Night')).toBe('drinks-night')
  })

  it('strips leading hyphens', () => {
    expect(slugify('  Leading Space')).toBe('leading-space')
  })

  it('strips trailing hyphens', () => {
    expect(slugify('Trailing Space  ')).toBe('trailing-space')
  })

  it('removes curly apostrophes (\u2019)', () => {
    // Right single quotation mark U+2019 — "Scott\u2019s"
    expect(slugify('Scott\u2019s Bar')).toBe('scotts-bar')
  })

  it('removes curly left-single-quote (\u2018)', () => {
    expect(slugify('\u2018Quoted\u2019 Title')).toBe('quoted-title')
  })

  it('converts underscores to hyphens', () => {
    expect(slugify('some_event_title')).toBe('some-event-title')
  })

  it('converts en-dash without surrounding spaces to a hyphen', () => {
    // Fixed: em/en-dash substitution now runs before the non-word-char strip,
    // so 'Mon–Fri' correctly becomes 'mon-fri' rather than 'monfri'.
    expect(slugify('Mon\u2013Fri Drinks')).toBe('mon-fri-drinks')
  })

  it('removes special characters that are not word chars, spaces, or hyphens', () => {
    expect(slugify('Event! (Special Edition)')).toBe('event-special-edition')
  })

  it('removes non-ASCII accented characters (é, ü, etc.)', () => {
    // é is not matched by \w without the u flag — so it is stripped
    expect(slugify('Café Soho')).toBe('caf-soho')
  })

  it('collapses consecutive hyphens from mixed separators', () => {
    expect(slugify('A -- B')).toBe('a-b')
  })

  it('returns an empty string for an all-special-char input', () => {
    expect(slugify('!!!')).toBe('')
  })

  it('handles already-slugified input without duplication', () => {
    expect(slugify('already-slugified')).toBe('already-slugified')
  })

  it('handles a single word', () => {
    expect(slugify('Networking')).toBe('networking')
  })
})

// ── uniqueSlug ────────────────────────────────────────────────────────────────

describe('uniqueSlug', () => {
  it('returns the base slug when it does not exist', async () => {
    const exists = vi.fn().mockResolvedValue(false)
    const result = await uniqueSlug('Wine & Wisdom', exists)
    expect(result).toBe('wine-and-wisdom')
    expect(exists).toHaveBeenCalledWith('wine-and-wisdom')
    expect(exists).toHaveBeenCalledTimes(1)
  })

  it('appends -2 when the base slug is taken', async () => {
    const exists = vi.fn()
      .mockResolvedValueOnce(true)   // 'wine-and-wisdom' is taken
      .mockResolvedValueOnce(false)  // 'wine-and-wisdom-2' is free

    const result = await uniqueSlug('Wine & Wisdom', exists)
    expect(result).toBe('wine-and-wisdom-2')
    expect(exists).toHaveBeenCalledTimes(2)
  })

  it('increments counter until a free slug is found', async () => {
    const exists = vi.fn()
      .mockResolvedValueOnce(true)   // base taken
      .mockResolvedValueOnce(true)   // -2 taken
      .mockResolvedValueOnce(true)   // -3 taken
      .mockResolvedValueOnce(false)  // -4 free

    const result = await uniqueSlug('Popular Event', exists)
    expect(result).toBe('popular-event-4')
    expect(exists).toHaveBeenCalledTimes(4)
  })

  it('passes the correct slug to the exists function at each step', async () => {
    const exists = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await uniqueSlug('My Event', exists)
    expect(exists).toHaveBeenNthCalledWith(1, 'my-event')
    expect(exists).toHaveBeenNthCalledWith(2, 'my-event-2')
  })
})
