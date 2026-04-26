// @vitest-environment jsdom
//
// W5 — adversarial coverage for TagPicker that the implementation tests
// don't already cover:
//
//   • Saving with ZERO secondaries (only the required primary).
//   • Saving with ALL secondaries selected (no UI break, no collision
//     because primary is auto-removed from the secondary set).
//   • Editing an existing event whose primary tag is interest-only
//     (forward-compat: shouldn't happen in seed but the picker must
//     handle it gracefully, not crash).
//   • Touch-target compliance enforced as an automated guard so a
//     future style change can't shrink the chips below 44px.
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import TagPicker from '../TagPicker'
import type { Tag } from '@/types'

// Full 23-tag canonical taxonomy (Migration 2 seed). Mirrors the
// production slugs + sort order so the chip count assertions reflect
// real state.
const TAGS: Tag[] = [
  // 15 primary-eligible (sort 10–150)
  { slug: 'drinks-bars',                 label: 'Drinks & Bars',              sort_order: 10  },
  { slug: 'dining-supper-clubs',         label: 'Dining & Supper Clubs',      sort_order: 20  },
  { slug: 'activities-social-games',     label: 'Activities & Social Games',  sort_order: 30  },
  { slug: 'nightlife-dancing',           label: 'Nightlife & Dancing',        sort_order: 40  },
  { slug: 'live-music-gigs',             label: 'Live Music & Gigs',          sort_order: 50  },
  { slug: 'theatre-comedy',              label: 'Theatre & Comedy',           sort_order: 60  },
  { slug: 'galleries-museums',           label: 'Galleries & Museums',        sort_order: 70  },
  { slug: 'festivals-seasonal',          label: 'Festivals & Seasonal',       sort_order: 80  },
  { slug: 'sport-fitness',               label: 'Sport & Fitness',            sort_order: 90  },
  { slug: 'outdoor-picnics',             label: 'Outdoor & Picnics',          sort_order: 100 },
  { slug: 'weekends-travel',             label: 'Weekends & Travel',          sort_order: 110 },
  { slug: 'themed-socials',              label: 'Themed Socials',             sort_order: 120 },
  { slug: 'charity-volunteering',        label: 'Charity & Volunteering',     sort_order: 130 },
  { slug: 'wellness-mindfulness',        label: 'Wellness & Mindfulness',     sort_order: 140 },
  { slug: 'workshops-masterclasses',     label: 'Workshops & Masterclasses',  sort_order: 150 },
  // 8 interest-only (sort 200–270)
  { slug: 'interest-technology',         label: 'Technology',                 sort_order: 200 },
  { slug: 'interest-entrepreneurship',   label: 'Entrepreneurship',           sort_order: 210 },
  { slug: 'interest-networking',         label: 'Networking',                 sort_order: 220 },
  { slug: 'interest-photography',        label: 'Photography',                sort_order: 230 },
  { slug: 'interest-travel',             label: 'Travel',                     sort_order: 240 },
  { slug: 'interest-books-literature',   label: 'Books & Literature',         sort_order: 250 },
  { slug: 'interest-sustainable-living', label: 'Sustainable Living',         sort_order: 260 },
  { slug: 'interest-film-cinema',        label: 'Film & Cinema',              sort_order: 270 },
].map((t, i) => ({
  id: `tag-${i}`,
  slug: t.slug,
  label: t.label,
  parent_id: null,
  sort_order: t.sort_order,
  is_active: true,
  created_at: '2026-05-04T00:00:00Z',
  updated_at: '2026-05-04T00:00:00Z',
}))

function Harness({
  initialPrimary = null,
  initialSecondaries = [],
}: {
  initialPrimary?: string | null
  initialSecondaries?: string[]
}) {
  const [primary, setPrimary] = useState<string | null>(initialPrimary)
  const [secondaries, setSecondaries] = useState<string[]>(initialSecondaries)
  return (
    <TagPicker
      availableTags={TAGS}
      primarySlug={primary}
      secondarySlugs={secondaries}
      onPrimaryChange={setPrimary}
      onSecondariesChange={setSecondaries}
    />
  )
}

describe('TagPicker — adversarial edge cases', () => {
  it('renders the full 23-tag taxonomy across primary + secondary groups', () => {
    render(<Harness />)
    // Primary group exposes only the 15 primary-eligible slugs.
    expect(
      document.querySelectorAll('[data-testid^="primary-tag-"]').length,
    ).toBe(15)
    // Secondary group exposes all 23 active tags.
    expect(
      document.querySelectorAll('[data-testid^="secondary-tag-"]').length,
    ).toBe(23)
  })

  it('zero secondaries is a valid state — hidden input is empty string', () => {
    const { container } = render(<Harness initialPrimary="drinks-bars" />)
    const hidden = container.querySelector(
      'input[type="hidden"][name="secondary_tag_slugs"]',
    ) as HTMLInputElement
    expect(hidden).toBeTruthy()
    expect(hidden.value).toBe('')
  })

  it('selecting all 22 NON-primary secondaries is valid (no collision, no crash)', () => {
    // With drinks-bars as primary, the picker must let admins pick the
    // remaining 22 active tags as secondaries without throwing or
    // entering an inconsistent state.
    const { container } = render(<Harness initialPrimary="drinks-bars" />)
    const secondaryButtons = [
      ...document.querySelectorAll('[data-testid^="secondary-tag-"]'),
    ] as HTMLButtonElement[]

    // The drinks-bars secondary is disabled — it's the primary.
    const enabled = secondaryButtons.filter((b) => !b.disabled)
    expect(enabled.length).toBe(22)

    for (const b of enabled) fireEvent.click(b)

    const hidden = container.querySelector(
      'input[type="hidden"][name="secondary_tag_slugs"]',
    ) as HTMLInputElement
    const slugs = hidden.value.split(',').filter(Boolean)
    expect(slugs.length).toBe(22)
    // None of the selected secondaries can equal the primary.
    expect(slugs).not.toContain('drinks-bars')
  })

  it('editing an event whose primary is interest-only renders gracefully (forward-compat)', () => {
    // PRIMARY_ELIGIBLE_TAG_SLUGS would normally exclude this, but if a
    // legacy event somehow has an interest-only primary (e.g. a buggy
    // migration or manual SQL), the picker should render without
    // crashing. Behaviour:
    //   - No chip in the PRIMARY group is selected (interest-technology
    //     isn't in the primary chip set, so the radio group has nothing
    //     checked).
    //   - The matching SECONDARY chip is disabled (the same collision
    //     logic that protects every other primary applies here too —
    //     the slug can't be both primary and secondary).
    //   - The admin can select any real primary; the picker then auto-
    //     re-enables the interest-technology secondary chip.
    render(<Harness initialPrimary="interest-technology" />)

    const checkedPrimary = document.querySelector(
      'input[type="radio"][name="primary_tag_slug"]:checked',
    )
    expect(checkedPrimary).toBeNull()

    const interestSecondary = document.querySelector(
      '[data-testid="secondary-tag-interest-technology"]',
    ) as HTMLButtonElement
    expect(interestSecondary).toBeTruthy()
    // Disabled with the "(primary)" label — same collision-guard
    // pattern as every other primary slug.
    expect(interestSecondary.disabled).toBe(true)
    expect(interestSecondary.textContent).toMatch(/primary/i)
  })

  it('every primary chip and every secondary chip carries min-h-[44px] (mobile touch-target guard)', () => {
    // Automated guard so a future style refactor can't shrink the
    // tap targets below the 44px iOS minimum.
    render(<Harness />)
    const primaryLabels = document.querySelectorAll(
      'label:has(input[name="primary_tag_slug"])',
    )
    expect(primaryLabels.length).toBe(15)
    for (const label of primaryLabels) {
      expect(label.className).toMatch(/min-h-\[44px\]/)
    }

    const secondaryButtons = document.querySelectorAll(
      '[data-testid^="secondary-tag-"]',
    )
    expect(secondaryButtons.length).toBe(23)
    for (const btn of secondaryButtons) {
      expect(btn.className).toMatch(/min-h-\[44px\]/)
    }
  })

  it('aria-pressed on secondary chips reflects toggled state (a11y)', () => {
    const { container } = render(<Harness initialPrimary="theatre-comedy" />)
    const drinks = container.querySelector(
      '[data-testid="secondary-tag-drinks-bars"]',
    ) as HTMLButtonElement

    expect(drinks.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(drinks)
    expect(drinks.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(drinks)
    expect(drinks.getAttribute('aria-pressed')).toBe('false')
  })
})
