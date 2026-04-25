// @vitest-environment jsdom
//
// Viewport + filter-tab + Read more interaction + touch-target tests
// for the admin ReviewsTable.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('@/app/(admin)/admin/actions', () => ({
  toggleReviewVisibility: vi.fn(),
}))

import ReviewsTable from '../ReviewsTable'

interface TestReview {
  id: string
  rating: number
  review_text: string | null
  is_visible: boolean
  created_at: string
  author: { id: string; full_name: string; avatar_url: string | null; email: string } | null
  event: { id: string; slug: string; title: string } | null
}

const review = (overrides: Partial<TestReview> = {}): TestReview => ({
  id: 'rv-1',
  rating: 5,
  review_text: 'A wonderful evening. Loved the wine pairings and the host was charming.',
  is_visible: true,
  created_at: '2026-04-10T12:00:00.000Z',
  author: {
    id: 'usr-1',
    full_name: 'Charlotte Davis',
    avatar_url: null,
    email: 'charlotte@example.com',
  },
  event: { id: 'evt-1', slug: 'wine-and-wisdom', title: 'Wine & Wisdom' },
  ...overrides,
})

describe('ReviewsTable — mobile pass', () => {
  it('renders BOTH the desktop table and the mobile card list', () => {
    const { container } = render(<ReviewsTable reviews={[review()]} />)
    expect(container.querySelector('div.hidden.md\\:block table')).toBeTruthy()
    const mobileList = container.querySelector('ul.md\\:hidden')
    expect(mobileList).toBeTruthy()
    expect(mobileList?.querySelectorAll('li').length).toBe(1)
  })

  it('mobile card surfaces author, event, rating, and full review text', () => {
    const { container } = render(<ReviewsTable reviews={[review()]} />)
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.textContent).toContain('Charlotte Davis')
    expect(card.textContent).toContain('Wine & Wisdom')
    expect(card.textContent).toContain('Loved the wine pairings')
    // Visible badge.
    expect(card.textContent).toContain('Visible')
  })

  it('every filter tab pill has min-h-[44px] for mobile touch-target compliance', () => {
    const { container } = render(<ReviewsTable reviews={[review()]} />)
    const tabBar = container.querySelector('div.bg-bg-secondary.rounded-lg.p-1') as HTMLElement
    expect(tabBar).toBeTruthy()
    const tabs = tabBar.querySelectorAll('button')
    expect(tabs.length).toBe(3) // All / Visible / Hidden
    tabs.forEach((tab) => {
      expect(tab.className).toContain('min-h-[44px]')
    })
  })

  it('long review text shows a "Read more" expand button that reveals the full text', () => {
    const longText =
      'A'.repeat(180) +
      ' — and that is when the magic really started, around the third pour, when conversation turned to dinner plans for the autumn.'
    const { container } = render(
      <ReviewsTable reviews={[review({ review_text: longText })]} />
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.textContent).toContain('Read more')

    const expandBtn = [...card.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Read more'
    )!
    fireEvent.click(expandBtn)

    expect(card.textContent).toContain('Show less')
    expect(card.textContent).toContain('around the third pour')
  })

  it('mobile Hide / Show toggle is full-width with min-h-[44px] (touch-target compliance)', () => {
    const { container } = render(<ReviewsTable reviews={[review()]} />)
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    const actionRow = card.querySelector('div.border-t') as HTMLElement
    const toggle = actionRow.querySelector('button') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    expect(toggle.className).toContain('w-full')
    expect(toggle.className).toContain('min-h-[44px]')
  })

  it('renders the "Hidden" status with a different colour on the mobile card when is_visible is false', () => {
    const { container } = render(
      <ReviewsTable reviews={[review({ is_visible: false })]} />
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.textContent).toContain('Hidden')
    // The Show toggle replaces Hide.
    const actionRow = card.querySelector('div.border-t') as HTMLElement
    const toggle = actionRow.querySelector('button') as HTMLButtonElement
    expect(toggle.textContent).toContain('Show')
  })
})
