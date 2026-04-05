// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// Mock server actions
vi.mock('@/app/(admin)/admin/actions', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  upsertEventInclusions: vi.fn(),
}))

import EventForm from '../EventForm'

describe('EventForm', () => {
  it('renders the create form when no event is passed', () => {
    render(<EventForm />)
    expect(screen.getByText('Create Event')).toBeTruthy()
    expect(screen.getByPlaceholderText(/wine & wisdom/i)).toBeTruthy()
  })

  it('renders the update form when event is passed', () => {
    render(
      <EventForm
        event={{
          id: 'evt-1',
          title: 'Existing Event',
          slug: 'existing-event',
          short_description: 'A short desc here',
          description: 'Full description here',
          date_time: '2026-06-15T19:00:00.000Z',
          end_time: '2026-06-15T22:00:00.000Z',
          venue_name: 'Wine Cellar',
          venue_address: '1 Bank End',
          category: 'drinks',
          price: 3500,
          capacity: 20,
          image_url: null,
          dress_code: null,
          is_published: true,
        }}
      />
    )
    expect(screen.getByText('Update Event')).toBeTruthy()
    expect(screen.getByDisplayValue('Existing Event')).toBeTruthy()
  })

  it('shows slug preview when title is typed', () => {
    render(<EventForm />)
    const titleInput = screen.getByPlaceholderText(/wine & wisdom/i)

    fireEvent.change(titleInput, { target: { value: 'Jazz Night at The Shard' } })

    expect(screen.getByText(/thesocialseen\.com\/events\//)).toBeTruthy()
    expect(screen.getByText('jazz-night-at-the-shard')).toBeTruthy()
  })

  it('does not show slug preview when title is empty', () => {
    render(<EventForm />)
    expect(screen.queryByText(/thesocialseen\.com\/events\//)).toBeNull()
  })

  it('renders price input that accepts decimal pounds', () => {
    const { container } = render(<EventForm />)
    const priceInput = container.querySelector('input[name="price"]') as HTMLInputElement
    expect(priceInput).toBeTruthy()
    expect(priceInput.type).toBe('number')
    expect(priceInput.step).toBe('0.01')
  })

  it('renders "Leave empty for unlimited" capacity helper text', () => {
    render(<EventForm />)
    expect(screen.getByText(/leave empty for unlimited/i)).toBeTruthy()
  })
})
