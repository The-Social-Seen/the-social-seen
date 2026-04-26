// @vitest-environment jsdom
//
// W5 — admin TagPicker mutual-exclusion + collision-guard coverage.
//
// The picker is the FIRST line of defence against the multi-tag collision
// edge case flagged by W2+W3 code review (see `_sync_primary_tag_from_category`
// in 20260504000001). Side A of the bidirectional trigger does
// `UPDATE event_tags SET tag_id = canonical WHERE event_id = X AND
// is_primary = true`. If the event already has a SECONDARY row with the
// same tag_id, that UPDATE hits the `uq_event_tags_event_tag` unique
// constraint and surfaces as a confusing 500.
//
// These tests prove the picker UI prevents a tag from being in both slots
// at once. The Server Action `saveEventTags` enforces the same invariant
// server-side — defence in depth.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import TagPicker from '../TagPicker'
import type { Tag } from '@/types'

// A trimmed taxonomy covering: 3 primary-eligible + 1 interest-only.
// Enough to exercise the mutual-exclusion logic without grinding through
// 23 chips per assertion.
const TAGS: Tag[] = [
  {
    id: 't-drinks',
    slug: 'drinks-bars',
    label: 'Drinks & Bars',
    parent_id: null,
    sort_order: 10,
    is_active: true,
    created_at: '2026-05-04T00:00:00Z',
    updated_at: '2026-05-04T00:00:00Z',
  },
  {
    id: 't-dining',
    slug: 'dining-supper-clubs',
    label: 'Dining & Supper Clubs',
    parent_id: null,
    sort_order: 20,
    is_active: true,
    created_at: '2026-05-04T00:00:00Z',
    updated_at: '2026-05-04T00:00:00Z',
  },
  {
    id: 't-theatre',
    slug: 'theatre-comedy',
    label: 'Theatre & Comedy',
    parent_id: null,
    sort_order: 60,
    is_active: true,
    created_at: '2026-05-04T00:00:00Z',
    updated_at: '2026-05-04T00:00:00Z',
  },
  {
    id: 't-tech',
    slug: 'interest-technology',
    label: 'Technology',
    parent_id: null,
    sort_order: 200,
    is_active: true,
    created_at: '2026-05-04T00:00:00Z',
    updated_at: '2026-05-04T00:00:00Z',
  },
]

/**
 * Stateful wrapper — the production picker is controlled, so unit tests
 * use this harness to drive state and read it back via the spy props.
 */
function Harness({
  initialPrimary = null,
  initialSecondaries = [],
  onPrimary = () => {},
  onSecondaries = () => {},
}: {
  initialPrimary?: string | null
  initialSecondaries?: string[]
  onPrimary?: (slug: string) => void
  onSecondaries?: (slugs: string[]) => void
}) {
  const [primary, setPrimary] = useState<string | null>(initialPrimary)
  const [secondaries, setSecondaries] = useState<string[]>(initialSecondaries)
  return (
    <TagPicker
      availableTags={TAGS}
      primarySlug={primary}
      secondarySlugs={secondaries}
      onPrimaryChange={(slug) => {
        setPrimary(slug)
        onPrimary(slug)
      }}
      onSecondariesChange={(slugs) => {
        setSecondaries(slugs)
        onSecondaries(slugs)
      }}
    />
  )
}

describe('TagPicker', () => {
  it('renders only PRIMARY_ELIGIBLE_TAG_SLUGS in the primary group', () => {
    render(<Harness />)
    // Primary group should expose drinks-bars, dining-supper-clubs,
    // theatre-comedy — but NOT interest-technology (interest-only).
    expect(screen.getByTestId('primary-tag-drinks-bars')).toBeTruthy()
    expect(screen.getByTestId('primary-tag-dining-supper-clubs')).toBeTruthy()
    expect(screen.getByTestId('primary-tag-theatre-comedy')).toBeTruthy()
    expect(screen.queryByTestId('primary-tag-interest-technology')).toBeNull()
  })

  it('renders ALL active tags (incl. interest-only) in the secondary group', () => {
    render(<Harness />)
    // Secondaries can include the interest-only tag — it's a legitimate
    // secondary on a workshop event, for example.
    expect(screen.getByTestId('secondary-tag-drinks-bars')).toBeTruthy()
    expect(screen.getByTestId('secondary-tag-interest-technology')).toBeTruthy()
  })

  it('selecting a primary REMOVES it from the secondary set (collision guard)', () => {
    const onSecondariesSpy = vi.fn()
    render(
      <Harness
        initialSecondaries={['drinks-bars', 'theatre-comedy']}
        onSecondaries={onSecondariesSpy}
      />,
    )

    // drinks-bars currently a secondary. Promote it to primary.
    fireEvent.click(screen.getByTestId('primary-tag-drinks-bars'))

    // The picker should have called onSecondariesChange with drinks-bars
    // removed (i.e. only theatre-comedy left).
    expect(onSecondariesSpy).toHaveBeenCalledWith(['theatre-comedy'])
  })

  it('the secondary chip for the current primary renders disabled (cannot be re-selected)', () => {
    render(<Harness initialPrimary="drinks-bars" />)

    const secondaryDrinks = screen.getByTestId(
      'secondary-tag-drinks-bars',
    ) as HTMLButtonElement
    expect(secondaryDrinks.disabled).toBe(true)
    // And label clearly tells the admin why.
    expect(secondaryDrinks.textContent).toMatch(/primary/i)
  })

  it('clicking the disabled secondary chip is a no-op (defensive guard)', () => {
    const onSecondariesSpy = vi.fn()
    render(
      <Harness
        initialPrimary="drinks-bars"
        onSecondaries={onSecondariesSpy}
      />,
    )

    // Even if the disabled flag were missed by the browser, the click
    // handler short-circuits when slug === primarySlug.
    const secondaryDrinks = screen.getByTestId('secondary-tag-drinks-bars')
    fireEvent.click(secondaryDrinks)

    expect(onSecondariesSpy).not.toHaveBeenCalled()
  })

  it('toggling a non-primary secondary on then off updates the secondaries array', () => {
    const onSecondariesSpy = vi.fn()
    render(
      <Harness initialPrimary="drinks-bars" onSecondaries={onSecondariesSpy} />,
    )

    const secondaryTheatre = screen.getByTestId('secondary-tag-theatre-comedy')

    // Click on — secondaries grows to ['theatre-comedy']
    fireEvent.click(secondaryTheatre)
    expect(onSecondariesSpy).toHaveBeenLastCalledWith(['theatre-comedy'])

    // Click off — secondaries shrinks back to []
    fireEvent.click(secondaryTheatre)
    expect(onSecondariesSpy).toHaveBeenLastCalledWith([])
  })

  it('exposes the secondary selection in a hidden input named `secondary_tag_slugs`', () => {
    const { container } = render(
      <Harness initialSecondaries={['theatre-comedy', 'interest-technology']} />,
    )
    const hidden = container.querySelector(
      'input[type="hidden"][name="secondary_tag_slugs"]',
    ) as HTMLInputElement
    expect(hidden).toBeTruthy()
    expect(hidden.value).toBe('theatre-comedy,interest-technology')
  })

  it('renders an inline error from the parent above the chips', () => {
    render(
      <TagPicker
        availableTags={TAGS}
        primarySlug={null}
        secondarySlugs={[]}
        onPrimaryChange={() => {}}
        onSecondariesChange={() => {}}
        error="Pick a primary tag — this is the main category for the event."
      />,
    )
    expect(
      screen.getByRole('alert').textContent,
    ).toMatch(/pick a primary tag/i)
  })

  it('every chip has min-h-[44px] for mobile touch-target compliance', () => {
    render(<Harness />)
    const allChips = [
      ...document.querySelectorAll('[data-testid^="primary-tag-"]'),
      ...document.querySelectorAll('[data-testid^="secondary-tag-"]'),
    ]
    expect(allChips.length).toBeGreaterThan(0)
    for (const chip of allChips) {
      // The chip itself OR its parent label must carry the min-h class.
      const parent = chip.closest('label, button')
      expect(parent?.className).toMatch(/min-h-\[44px\]/)
    }
  })
})
