// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ── Mocks ──────────────────────────────────────────────────────────────────

function filterDomProps(props: Record<string, unknown>) {
  const invalid = [
    'variants', 'initial', 'animate', 'exit', 'whileInView',
    'viewport', 'transition', 'custom', 'mode',
  ]
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!invalid.includes(key)) filtered[key] = value
  }
  return filtered
}

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...filterDomProps(props)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

const mockRequestPasswordReset = vi.fn()

vi.mock('../actions', () => ({
  requestPasswordReset: (...args: unknown[]) => mockRequestPasswordReset(...args),
}))

const mockTrack = vi.fn()

vi.mock('@/lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}))

import { ForgotPasswordForm } from '../forgot-password/forgot-password-form'

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the "Forgot Password?" heading', () => {
    render(<ForgotPasswordForm />)
    expect(screen.getByRole('heading', { name: /forgot password/i })).toBeTruthy()
  })

  it('renders an email input and submit button', () => {
    render(<ForgotPasswordForm />)
    expect(screen.getByLabelText(/email address/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeTruthy()
  })

  it('renders "Back to sign in" link pointing to /login', () => {
    render(<ForgotPasswordForm />)
    const backLink = screen.getByRole('link', { name: /back to sign in/i })
    expect(backLink.getAttribute('href')).toBe('/login')
  })

  it('shows validation error when submitting with empty email', async () => {
    render(<ForgotPasswordForm />)
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByText(/please enter your email/i)).toBeTruthy()
    })
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('calls requestPasswordReset with trimmed email on submit', async () => {
    mockRequestPasswordReset.mockResolvedValue({ success: true })

    render(<ForgotPasswordForm />)
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: '  test@test.com  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        email: 'test@test.com',
      })
    })
  })

  it('shows success state after successful submission', async () => {
    mockRequestPasswordReset.mockResolvedValue({ success: true })

    render(<ForgotPasswordForm />)
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'test@test.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /check your inbox/i })).toBeTruthy()
    })
    expect(screen.getByText(/if that email is registered/i)).toBeTruthy()
  })

  it('fires password_reset_requested analytics event on success', async () => {
    mockRequestPasswordReset.mockResolvedValue({ success: true })

    render(<ForgotPasswordForm />)
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'test@test.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('password_reset_requested', {})
    })
  })

  it('shows server error when requestPasswordReset returns an error', async () => {
    mockRequestPasswordReset.mockResolvedValue({ error: 'Something went wrong' })

    render(<ForgotPasswordForm />)
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'test@test.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeTruthy()
    })
    expect(mockTrack).not.toHaveBeenCalled()
  })

  it('allows returning to the form after success via "try again"', async () => {
    mockRequestPasswordReset.mockResolvedValue({ success: true })

    render(<ForgotPasswordForm />)
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'test@test.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /check your inbox/i })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/email address/i)).toBeTruthy()
    })
  })
})
