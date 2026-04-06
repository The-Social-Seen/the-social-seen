// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock EventForm so the page test is isolated from form behaviour
vi.mock('@/components/admin/EventForm', () => ({
  default: () => <div data-testid="event-form" />,
}))

import CreateEventPage from '../page'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CreateEventPage (/admin/events/new)', () => {
  it('renders without crashing', () => {
    const { container } = render(<CreateEventPage />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders a "Create Event" heading', () => {
    render(<CreateEventPage />)
    expect(screen.getByRole('heading', { name: /create event/i })).toBeTruthy()
  })

  it('renders the EventForm component', () => {
    render(<CreateEventPage />)
    expect(screen.getByTestId('event-form')).toBeTruthy()
  })
})
