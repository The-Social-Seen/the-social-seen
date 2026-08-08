// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * Coverage for BookingResumeErrorHandler — mirrors AccountDeletedHandler's
 * test shape. Guards the primary failure path the abandoned-checkout
 * reminder email exists to protect: a member clicks "Complete Payment" at
 * the wrong moment and `GET /bookings/resume/[bookingId]` redirects to
 * `/bookings?resumeError=<message>` — this must surface as a visible toast,
 * not silently disappear.
 */

const mockReplace = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key),
  }),
}))

import BookingResumeErrorHandler from '../BookingResumeErrorHandler'

describe('BookingResumeErrorHandler', () => {
  beforeEach(() => {
    mockReplace.mockClear()
    mockSearchParams = new URLSearchParams()
  })

  it('renders nothing when ?resumeError is absent', () => {
    const { container } = render(<BookingResumeErrorHandler />)
    expect(container.firstChild).toBeNull()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('shows the error message as a toast when ?resumeError is present', () => {
    mockSearchParams = new URLSearchParams({
      resumeError: 'This event has already taken place.',
    })

    render(<BookingResumeErrorHandler />)

    expect(screen.getByRole('status').textContent).toMatch(
      /this event has already taken place/i,
    )
  })

  it('renders the exact admin-hold message verbatim', () => {
    mockSearchParams = new URLSearchParams({
      resumeError:
        'This booking is managed by our team — check your email for a payment link, or contact us.',
    })

    render(<BookingResumeErrorHandler />)

    expect(screen.getByRole('status').textContent).toBe(
      'This booking is managed by our team — check your email for a payment link, or contact us.',
    )
  })

  it('strips the resumeError param via router.replace to prevent re-fire on refresh', () => {
    mockSearchParams = new URLSearchParams({
      resumeError: 'This booking is no longer awaiting payment.',
    })

    render(<BookingResumeErrorHandler />)

    expect(mockReplace).toHaveBeenCalledTimes(1)
    const replacedPath = mockReplace.mock.calls[0][0] as string
    expect(replacedPath).not.toContain('resumeError')
  })
})
