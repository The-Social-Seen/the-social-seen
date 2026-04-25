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
          postcode: 'SE1 9BU',
          venue_revealed: true,
          category: 'drinks',
          price: 3500,
          capacity: 20,
          image_url: null,
          dress_code: null,
          refund_window_hours: 48,
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

  // ── Refund-policy picker (PR #52, code-reviewer flagged the gap) ──────
  // The picker is three radios — none / standard (48h) / custom — and
  // selecting "custom" reveals a numeric hours input. The form payload
  // is reconstructed in the Server Action from `refund_policy` plus
  // `refund_window_custom_hours`; these tests cover the client-side
  // interaction that produces that payload.

  describe('Refund policy picker', () => {
    function getRadio(value: 'none' | 'standard' | 'custom'): HTMLInputElement {
      return document.querySelector(
        `input[type="radio"][name="refund_policy"][value="${value}"]`
      ) as HTMLInputElement
    }

    function getCustomHoursInput(): HTMLInputElement | null {
      return document.querySelector(
        'input[name="refund_window_custom_hours"]'
      ) as HTMLInputElement | null
    }

    it('defaults to "Standard 48 hours" when creating a new event', () => {
      render(<EventForm />)
      expect(getRadio('standard').checked).toBe(true)
      expect(getRadio('none').checked).toBe(false)
      expect(getRadio('custom').checked).toBe(false)
      // Custom hours input is hidden by default.
      expect(getCustomHoursInput()).toBeNull()
    })

    it('selecting "Custom" reveals the hours input, which is required', () => {
      render(<EventForm />)
      // No input present before selection.
      expect(getCustomHoursInput()).toBeNull()

      fireEvent.click(getRadio('custom'))

      expect(getRadio('custom').checked).toBe(true)
      const customInput = getCustomHoursInput()
      expect(customInput).toBeTruthy()
      expect(customInput!.required).toBe(true)
      expect(customInput!.type).toBe('number')
      expect(customInput!.min).toBe('1')
    })

    it('hours input value is reflected in the form payload after typing', () => {
      const { container } = render(<EventForm />)
      fireEvent.click(getRadio('custom'))
      const customInput = getCustomHoursInput()!
      fireEvent.change(customInput, { target: { value: '72' } })

      // The native form payload reflects the typed value — the Server
      // Action reads this via formData.get('refund_window_custom_hours').
      const form = container.querySelector('form') as HTMLFormElement
      const fd = new FormData(form)
      expect(fd.get('refund_policy')).toBe('custom')
      expect(fd.get('refund_window_custom_hours')).toBe('72')
    })

    it('switching from "Custom" to another option hides the hours input', () => {
      render(<EventForm />)
      fireEvent.click(getRadio('custom'))
      expect(getCustomHoursInput()).toBeTruthy()

      fireEvent.click(getRadio('standard'))
      expect(getRadio('standard').checked).toBe(true)
      expect(getCustomHoursInput()).toBeNull()
    })

    it('selecting "No refunds" sets refund_policy=none in the form payload', () => {
      const { container } = render(<EventForm />)
      fireEvent.click(getRadio('none'))

      const form = container.querySelector('form') as HTMLFormElement
      const fd = new FormData(form)
      expect(fd.get('refund_policy')).toBe('none')
    })

    it('initialises with "Custom" selected when an existing event uses a non-default refund window', () => {
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
            postcode: 'SE1 9BU',
            venue_revealed: true,
            category: 'drinks',
            price: 3500,
            capacity: 20,
            image_url: null,
            dress_code: null,
            refund_window_hours: 72,
            is_published: true,
          }}
        />
      )
      expect(getRadio('custom').checked).toBe(true)
      const customInput = getCustomHoursInput()!
      expect(customInput).toBeTruthy()
      expect(customInput.value).toBe('72')
    })

    it('initialises with "No refunds" selected when refund_window_hours is 0', () => {
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
            postcode: 'SE1 9BU',
            venue_revealed: true,
            category: 'drinks',
            price: 3500,
            capacity: 20,
            image_url: null,
            dress_code: null,
            refund_window_hours: 0,
            is_published: true,
          }}
        />
      )
      expect(getRadio('none').checked).toBe(true)
      expect(getCustomHoursInput()).toBeNull()
    })
  })

  // ── Mobile-pass: sticky save bar + 44px inputs ────────────────────────
  // These are touch-target sanity checks for the EventForm specifically.
  // They fail loudly if a future change drops min-h-[44px] / h-11 from
  // the form-input class or the sticky save bar buttons.

  describe('Mobile touch-target compliance', () => {
    it('the .form-input style declaration enforces min-height: 2.75rem (44px) below md', () => {
      const { container } = render(<EventForm />)
      // The form-input style block is appended to the document via styled-jsx
      // global. Search the page for the style rule text.
      const allStyles = [...document.querySelectorAll('style')]
        .map((s) => s.textContent ?? '')
        .join('\n')
      expect(allStyles).toMatch(/\.form-input[^}]*min-height:\s*2\.75rem/)
      // Sanity: at least one form input is present with the form-input class.
      expect(container.querySelector('input.form-input')).toBeTruthy()
    })

    it('every refund-policy radio row sits inside a min-h-[44px] label (tap target)', () => {
      const { container } = render(<EventForm />)
      const radios = container.querySelectorAll('input[name="refund_policy"]')
      expect(radios.length).toBe(3)
      radios.forEach((radio) => {
        const label = radio.closest('label')
        expect(label?.className).toContain('min-h-[44px]')
      })
    })

    it('save bar is position: sticky on mobile and contains both Save and Cancel buttons', () => {
      const { container } = render(<EventForm />)
      const stickyBar = container.querySelector('form div.sticky') as HTMLElement
      expect(stickyBar).toBeTruthy()
      // Bottom-16 keeps it above the 64px AdminSidebar bottom-nav.
      expect(stickyBar.className).toContain('bottom-16')
      const buttons = stickyBar.querySelectorAll('button')
      expect(buttons.length).toBe(2)
      buttons.forEach((b) => {
        expect(b.className).toContain('min-h-[44px]')
        expect(b.className).toContain('w-full')
      })
    })
  })
})
