// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { variants, initial, animate, exit, transition, layout, ...rest } = props as Record<string, unknown>
      void variants; void initial; void animate; void exit; void transition; void layout
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string; [key: string]: unknown }) => (
    <img alt={alt} src={src} />
  ),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock the submitReview server action
const mockSubmitReview = vi.fn()
vi.mock('@/app/(member)/bookings/actions', () => ({
  submitReview: (...args: unknown[]) => mockSubmitReview(...args),
}))

// Mock utility functions used by ReviewCard
vi.mock('@/lib/utils/dates', () => ({
  formatDateCard: vi.fn(() => '14 March 2025'),
}))

vi.mock('@/lib/utils/images', () => ({
  resolveAvatarUrl: vi.fn((url: string | null) => url),
  getInitials: vi.fn((name: string) => name.split(' ').map((n: string) => n[0]).join('')),
  resolveEventImage: vi.fn((url: string) => url),
}))

import ReviewForm from '../ReviewForm'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const defaultProps = {
  eventId: 'evt-1',
  eventTitle: 'Rooftop Cocktails',
  eventDate: '14 March 2025',
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  userName: 'Charlotte Davis',
  userAvatar: null,
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// ReviewForm
// ════════════════════════════════════════════════════════════════════════════

describe('ReviewForm', () => {
  it('renders the event title and date', () => {
    render(<ReviewForm {...defaultProps} />)

    expect(screen.getByText(/Rooftop Cocktails/)).toBeTruthy()
    expect(screen.getByText(/14 March 2025/)).toBeTruthy()
    expect(screen.getByText('Leave a Review')).toBeTruthy()
  })

  it('renders 5 star buttons as a radiogroup', () => {
    render(<ReviewForm {...defaultProps} />)

    const radiogroup = screen.getByRole('radiogroup', { name: /star rating/i })
    expect(radiogroup).toBeTruthy()

    const stars = screen.getAllByRole('radio')
    expect(stars).toHaveLength(5)
  })

  it('stars are clickable and update aria-checked', () => {
    render(<ReviewForm {...defaultProps} />)

    const stars = screen.getAllByRole('radio')

    // Initially no star is checked
    expect(stars[0].getAttribute('aria-checked')).toBe('false')
    expect(stars[2].getAttribute('aria-checked')).toBe('false')

    // Click the 3rd star
    fireEvent.click(stars[2])

    // 3rd star should be checked
    expect(stars[2].getAttribute('aria-checked')).toBe('true')
    // 1st star should not be checked (aria-checked means "is this the selected value")
    expect(stars[0].getAttribute('aria-checked')).toBe('false')
  })

  it('submit button is disabled until a rating is selected', () => {
    render(<ReviewForm {...defaultProps} />)

    const submitBtn = screen.getByRole('button', { name: /submit review/i })
    expect(submitBtn.hasAttribute('disabled')).toBe(true)

    // Select a rating
    const stars = screen.getAllByRole('radio')
    fireEvent.click(stars[3]) // 4 stars

    expect(submitBtn.hasAttribute('disabled')).toBe(false)
  })

  it('shows character counter starting at 0/500', () => {
    render(<ReviewForm {...defaultProps} />)

    expect(screen.getByText('0/500')).toBeTruthy()
  })

  it('updates character counter as user types', () => {
    render(<ReviewForm {...defaultProps} />)

    const textarea = screen.getByPlaceholderText(/what made this event special/i)
    fireEvent.change(textarea, { target: { value: 'Great evening' } })

    expect(screen.getByText('13/500')).toBeTruthy()
  })

  it('submit button is disabled and prevents submission when no rating selected', () => {
    render(<ReviewForm {...defaultProps} />)

    const submitBtn = screen.getByRole('button', { name: /submit review/i })
    // Button should be disabled — the rating error path is guarded by disabled state
    expect(submitBtn.hasAttribute('disabled')).toBe(true)

    // No error message shown (click won't fire on a disabled button)
    expect(screen.queryByText('Please select a rating')).toBeFalsy()
  })

  it('no rating error visible when a star is selected', () => {
    render(<ReviewForm {...defaultProps} />)

    // Select a star
    const stars = screen.getAllByRole('radio')
    fireEvent.click(stars[2])

    // Submit button should now be enabled
    const submitBtn = screen.getByRole('button', { name: /submit review/i })
    expect(submitBtn.hasAttribute('disabled')).toBe(false)

    // No rating error should be present
    expect(screen.queryByText('Please select a rating')).toBeFalsy()
  })

  it('shows server error when submission fails', async () => {
    mockSubmitReview.mockResolvedValue({
      success: false,
      error: 'You have already reviewed this event',
    })

    render(<ReviewForm {...defaultProps} />)

    // Select a rating
    const stars = screen.getAllByRole('radio')
    fireEvent.click(stars[4]) // 5 stars

    // Submit
    const submitBtn = screen.getByRole('button', { name: /submit review/i })
    await act(async () => {
      fireEvent.click(submitBtn)
    })

    await waitFor(() => {
      expect(screen.getByText('You have already reviewed this event')).toBeTruthy()
    })
  })

  it('shows success state with thank you message after successful submit', async () => {
    mockSubmitReview.mockResolvedValue({ success: true })

    render(<ReviewForm {...defaultProps} />)

    // Select a rating
    const stars = screen.getAllByRole('radio')
    fireEvent.click(stars[3]) // 4 stars

    // Submit
    const submitBtn = screen.getByRole('button', { name: /submit review/i })
    await act(async () => {
      fireEvent.click(submitBtn)
    })

    await waitFor(() => {
      expect(screen.getByText('Thank you for your review')).toBeTruthy()
    })

    expect(defaultProps.onSuccess).toHaveBeenCalled()
  })

  it('shows the user name in the success preview ReviewCard', async () => {
    mockSubmitReview.mockResolvedValue({ success: true })

    render(<ReviewForm {...defaultProps} />)

    // Select rating + type text
    const stars = screen.getAllByRole('radio')
    fireEvent.click(stars[4]) // 5 stars

    const textarea = screen.getByPlaceholderText(/what made this event special/i)
    fireEvent.change(textarea, { target: { value: 'Wonderful evening' } })

    // Submit
    const submitBtn = screen.getByRole('button', { name: /submit review/i })
    await act(async () => {
      fireEvent.click(submitBtn)
    })

    await waitFor(() => {
      expect(screen.getByText('Charlotte Davis')).toBeTruthy()
    })
  })

  it('calls submitReview with correct arguments', async () => {
    mockSubmitReview.mockResolvedValue({ success: true })

    render(<ReviewForm {...defaultProps} />)

    // Select rating + type text
    const stars = screen.getAllByRole('radio')
    fireEvent.click(stars[2]) // 3 stars

    const textarea = screen.getByPlaceholderText(/what made this event special/i)
    fireEvent.change(textarea, { target: { value: 'Nice event' } })

    // Submit
    const submitBtn = screen.getByRole('button', { name: /submit review/i })
    await act(async () => {
      fireEvent.click(submitBtn)
    })

    await waitFor(() => {
      expect(mockSubmitReview).toHaveBeenCalledWith({
        eventId: 'evt-1',
        rating: 3,
        reviewText: 'Nice event',
      })
    })
  })

  it('calls onClose when close button is clicked', () => {
    render(<ReviewForm {...defaultProps} />)

    const closeBtn = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeBtn)

    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', () => {
    render(<ReviewForm {...defaultProps} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(defaultProps.onClose).toHaveBeenCalled()
  })
})
