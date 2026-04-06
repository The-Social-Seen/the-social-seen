import { describe, it, expect } from 'vitest'
import { categoryLabel, CATEGORY_LABELS } from '../index'
import type { EventCategory } from '../index'

// ── categoryLabel ─────────────────────────────────────────────────────────────

describe('categoryLabel', () => {
  const cases: Array<[EventCategory, string]> = [
    ['drinks',     'Drinks'],
    ['dining',     'Dining'],
    ['cultural',   'Cultural'],
    ['wellness',   'Wellness'],
    ['sport',      'Sport'],
    ['workshops',  'Workshops'],
    ['music',      'Music'],
    ['networking', 'Networking'],
    ['activity',   'Activity'],
  ]

  it.each(cases)('maps "%s" → "%s"', (category, expected) => {
    expect(categoryLabel(category)).toBe(expected)
  })

  it('covers all 9 EventCategory values', () => {
    expect(Object.keys(CATEGORY_LABELS)).toHaveLength(9)
  })

  it('returns a non-empty string for every category', () => {
    for (const cat of Object.keys(CATEGORY_LABELS) as EventCategory[]) {
      expect(categoryLabel(cat)).toBeTruthy()
    }
  })

  it('returns Title Case labels (first char uppercase)', () => {
    for (const label of Object.values(CATEGORY_LABELS)) {
      expect(label[0]).toBe(label[0].toUpperCase())
    }
  })
})

// ── CATEGORY_LABELS record ────────────────────────────────────────────────────

describe('CATEGORY_LABELS', () => {
  it('contains exactly the 9 expected category keys', () => {
    const expected: EventCategory[] = [
      'drinks', 'dining', 'cultural', 'wellness',
      'sport', 'workshops', 'music', 'networking', 'activity',
    ]
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual(expected.sort())
  })

  it('has no undefined values', () => {
    for (const value of Object.values(CATEGORY_LABELS)) {
      expect(value).toBeDefined()
      expect(typeof value).toBe('string')
    }
  })
})
