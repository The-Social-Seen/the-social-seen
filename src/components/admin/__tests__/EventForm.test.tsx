// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { HostPickerMember } from '@/app/(admin)/admin/actions'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// Mock server actions. Includes the host-related actions imported by
// EventForm post-4abaf4e even though the render-only tests don't exercise
// them — keeps the mock complete so a future submit-wiring test can plug
// in without rewriting the mock surface.
vi.mock('@/app/(admin)/admin/actions', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  upsertEventInclusions: vi.fn(),
  upsertEventHosts: vi.fn(),
  saveEventTags: vi.fn(),
}))

// Mock next/image (used by the new HostRow avatar rendering).
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string; [k: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}))

// Stub the MemberPicker so EventForm tests don't pull in its fetch-on-open
// behaviour. The stub renders a button labelled with `triggerLabel`; clicking
// it fires `onSelect` with whatever member the current test pushed via
// `setStubMember`. This keeps host-flow assertions focused on EventForm.
const { setStubMember, getStubMember } = vi.hoisted(() => {
  let current: HostPickerMember = {
    id: 'usr-stub',
    full_name: 'Stub Member',
    avatar_url: null,
    job_title: null,
    company: null,
  }
  return {
    setStubMember: (m: HostPickerMember) => {
      current = m
    },
    getStubMember: () => current,
  }
})

vi.mock('../MemberPicker', () => ({
  default: ({
    onSelect,
    triggerLabel = 'Add member',
  }: {
    onSelect: (m: HostPickerMember) => void
    triggerLabel?: string
    excludeIds?: string[]
    ariaLabel?: string
  }) => (
    <button
      type="button"
      data-testid="member-picker-trigger"
      onClick={() => onSelect(getStubMember())}
    >
      {triggerLabel}
    </button>
  ),
}))

import EventForm, { type HostFormRow } from '../EventForm'

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
          price: 3500,
          capacity: 20,
          image_url: null,
          dress_code: null,
          refund_window_hours: 48,
          external_attendees: 0,
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
            price: 3500,
            capacity: 20,
            image_url: null,
            dress_code: null,
            refund_window_hours: 72,
            external_attendees: 0,
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
            price: 3500,
            capacity: 20,
            image_url: null,
            dress_code: null,
            refund_window_hours: 0,
            external_attendees: 0,
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

  // ── Hosts section (4abaf4e) ─────────────────────────────────────────────
  // Pins the multi-host editing surface introduced on top of the existing
  // form: heading + helper text, hydration from initialHosts, add via the
  // (stubbed) MemberPicker, role-label edit / max-length / counter
  // threshold, and remove. Submit-wiring tests (createEvent/upsertEventHosts
  // call shapes) are deliberately deferred — see handover notes — so we
  // don't ship a half-working submit harness mid-feature.

  describe('Hosts section', () => {
    function makeHostRow(overrides: Partial<HostFormRow> = {}): HostFormRow {
      return {
        profileId: 'host-1',
        roleLabel: '',
        memberSnapshot: {
          full_name: 'Charlotte Smith',
          avatar_url: null,
          job_title: 'Designer',
          company: 'Acme',
        },
        ...overrides,
      }
    }

    it('renders the Hosts heading + helper text on a fresh create form', () => {
      render(<EventForm />)
      expect(screen.getByRole('heading', { name: 'Hosts' })).toBeTruthy()
      expect(screen.getByText(/add the people who will be hosting/i)).toBeTruthy()
      // No host rows exist yet → no Role label inputs.
      const labelInputs = document.querySelectorAll('input[aria-label^="Role label for"]')
      expect(labelInputs.length).toBe(0)
    })

    it('renders the (stubbed) MemberPicker trigger labelled "Add host"', () => {
      render(<EventForm />)
      expect(screen.getByTestId('member-picker-trigger')).toBeTruthy()
      // Stub uses the triggerLabel prop EventForm passes ("Add host").
      expect(screen.getByText('Add host')).toBeTruthy()
    })

    it('hydrates initialHosts on edit and renders one row per host', () => {
      render(
        <EventForm
          initialHosts={[
            makeHostRow({
              profileId: 'host-a',
              roleLabel: 'Host',
              memberSnapshot: {
                full_name: 'Alice Adams',
                avatar_url: null,
                job_title: null,
                company: null,
              },
            }),
            makeHostRow({
              profileId: 'host-b',
              roleLabel: 'Co-Host',
              memberSnapshot: {
                full_name: 'Bob Brown',
                avatar_url: null,
                job_title: 'Director',
                company: 'Beta',
              },
            }),
          ]}
        />,
      )
      expect(screen.getByText('Alice Adams')).toBeTruthy()
      expect(screen.getByText('Bob Brown')).toBeTruthy()
      const labelInputs = document.querySelectorAll('input[aria-label^="Role label for"]')
      expect(labelInputs.length).toBe(2)
      expect((labelInputs[0] as HTMLInputElement).value).toBe('Host')
      expect((labelInputs[1] as HTMLInputElement).value).toBe('Co-Host')
    })

    it('adds a host row when the picker fires onSelect', () => {
      setStubMember({
        id: 'usr-x',
        full_name: 'Xavier Knight',
        avatar_url: null,
        job_title: 'Architect',
        company: 'Studio',
      })
      render(<EventForm />)

      // Before: no row, no role label input.
      expect(screen.queryByText('Xavier Knight')).toBeNull()
      let labelInputs = document.querySelectorAll('input[aria-label^="Role label for"]')
      expect(labelInputs.length).toBe(0)

      fireEvent.click(screen.getByTestId('member-picker-trigger'))

      // After: one row with empty role label and the picked member's name.
      expect(screen.getByText('Xavier Knight')).toBeTruthy()
      labelInputs = document.querySelectorAll('input[aria-label^="Role label for"]')
      expect(labelInputs.length).toBe(1)
      expect((labelInputs[0] as HTMLInputElement).value).toBe('')
    })

    it('typing into a role label updates the input value', () => {
      render(<EventForm initialHosts={[makeHostRow()]} />)
      const input = document.querySelector(
        'input[aria-label="Role label for Charlotte Smith"]',
      ) as HTMLInputElement
      expect(input).toBeTruthy()

      fireEvent.change(input, { target: { value: 'Co-Host' } })

      // Re-query to get the post-render value.
      const refreshed = document.querySelector(
        'input[aria-label="Role label for Charlotte Smith"]',
      ) as HTMLInputElement
      expect(refreshed.value).toBe('Co-Host')
    })

    it('enforces the 60-char maxLength on the role label input', () => {
      render(<EventForm initialHosts={[makeHostRow()]} />)
      const input = document.querySelector(
        'input[aria-label="Role label for Charlotte Smith"]',
      ) as HTMLInputElement
      expect(input.maxLength).toBe(60)
    })

    it('hides the X / 60 counter when role label is at or below 50 chars', () => {
      const fifty = 'x'.repeat(50)
      render(
        <EventForm initialHosts={[makeHostRow({ roleLabel: fifty })]} />,
      )
      // No counter at the threshold — only > 50 reveals it.
      expect(screen.queryByText('50 / 60')).toBeNull()
      expect(screen.queryByText(/\/ 60$/)).toBeNull()
    })

    it('shows the X / 60 counter when role label exceeds 50 chars', () => {
      const fiftyOne = 'y'.repeat(51)
      render(
        <EventForm initialHosts={[makeHostRow({ roleLabel: fiftyOne })]} />,
      )
      expect(screen.getByText('51 / 60')).toBeTruthy()
    })

    it('removes a host row when its Remove button is clicked', () => {
      render(
        <EventForm
          initialHosts={[
            makeHostRow({
              profileId: 'host-a',
              memberSnapshot: {
                full_name: 'Alice Adams',
                avatar_url: null,
                job_title: null,
                company: null,
              },
            }),
            makeHostRow({
              profileId: 'host-b',
              memberSnapshot: {
                full_name: 'Bob Brown',
                avatar_url: null,
                job_title: null,
                company: null,
              },
            }),
          ]}
        />,
      )

      expect(screen.getByText('Alice Adams')).toBeTruthy()
      expect(screen.getByText('Bob Brown')).toBeTruthy()

      const removeAlice = screen.getByRole('button', {
        name: /remove alice adams as host/i,
      })
      fireEvent.click(removeAlice)

      expect(screen.queryByText('Alice Adams')).toBeNull()
      expect(screen.getByText('Bob Brown')).toBeTruthy()
    })
  })
})
