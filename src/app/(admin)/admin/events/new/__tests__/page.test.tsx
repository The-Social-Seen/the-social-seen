// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock EventForm so the page test is isolated from form behaviour
vi.mock('@/components/admin/EventForm', () => ({
  default: () => <div data-testid="event-form" />,
}))

// Phase 3 W5: page now awaits getActiveTags() to populate the tag picker.
// Stub it to a minimal active-tag list so the page renders without an
// actual Supabase round-trip.
vi.mock('@/lib/supabase/queries/tags', () => ({
  getActiveTags: vi.fn().mockResolvedValue([
    {
      id: 'tag-1',
      slug: 'drinks-bars',
      label: 'Drinks & Bars',
      parent_id: null,
      sort_order: 10,
      is_active: true,
      created_at: '2026-05-04T00:00:00Z',
      updated_at: '2026-05-04T00:00:00Z',
    },
  ]),
}))

import CreateEventPage from '../page'

// ── Tests ───────────────────────────────────────────────────────────────────
// The page is a React Server Component that awaits data on render.
// Render the resolved JSX once per test to keep assertions synchronous.

async function renderPage() {
  const ui = await CreateEventPage()
  return render(ui)
}

describe('CreateEventPage (/admin/events/new)', () => {
  it('renders without crashing', async () => {
    const { container } = await renderPage()
    expect(container.firstChild).toBeTruthy()
  })

  it('renders a "Create Event" heading', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { name: /create event/i })).toBeTruthy()
  })

  it('renders the EventForm component', async () => {
    await renderPage()
    expect(screen.getByTestId('event-form')).toBeTruthy()
  })
})
