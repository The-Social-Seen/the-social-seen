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

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}))

const mockUpdatePassword = vi.fn()

vi.mock('../actions', () => ({
  updatePassword: (...args: unknown[]) => mockUpdatePassword(...args),
}))

const mockTrack = vi.fn()

vi.mock('@/lib/analytics/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}))

import { ResetPasswordForm } from '../reset-password/reset-password-form'

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the "Reset Your Password" heading', () => {
    render(<ResetPasswordForm />)
    expect(
      screen.getByRole('heading', { name: /reset your password/i }),
    ).toBeTruthy()
  })

  it('renders new password and confirm password fields', () => {
    render(<ResetPasswordForm />)
    expect(screen.getByLabelText(/^new password$/i)).toBeTruthy()
    expect(screen.getByLabelText(/confirm new password/i)).toBeTruthy()
  })

  it('renders submit button', () => {
    render(<ResetPasswordForm />)
    expect(screen.getByRole('button', { name: /update password/i })).toBeTruthy()
  })

  it('shows validation error when password is too short', async () => {
    render(<ResetPasswordForm />)
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'short' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'short' },
    })
    fireEvent.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/password must be at least 8 characters/i),
      ).toBeTruthy()
    })
    expect(mockUpdatePassword).not.toHaveBeenCalled()
  })

  it('shows validation error when passwords don\u2019t match', async () => {
    render(<ResetPasswordForm />)
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'password123' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'password456' },
    })
    fireEvent.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(screen.getByText(/passwords don\u2019t match/i)).toBeTruthy()
    })
    expect(mockUpdatePassword).not.toHaveBeenCalled()
  })

  it('calls updatePassword on valid submission', async () => {
    mockUpdatePassword.mockResolvedValue({ success: true })

    render(<ResetPasswordForm />)
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(mockUpdatePassword).toHaveBeenCalledWith({
        password: 'new-secure-password',
      })
    })
  })

  it('fires password_reset_completed analytics event on success', async () => {
    mockUpdatePassword.mockResolvedValue({ success: true })

    render(<ResetPasswordForm />)
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('password_reset_completed', {})
    })
  })

  it('shows success screen after password update', async () => {
    mockUpdatePassword.mockResolvedValue({ success: true })

    render(<ResetPasswordForm />)
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /password updated/i }),
      ).toBeTruthy()
    })
  })

  it('shows expired-link screen when server returns expired error', async () => {
    mockUpdatePassword.mockResolvedValue({
      error: 'Your reset link has expired. Request a new one.',
    })

    render(<ResetPasswordForm />)
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'new-secure-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /link expired/i })).toBeTruthy()
    })
    const requestLink = screen.getByRole('link', { name: /request a new link/i })
    expect(requestLink.getAttribute('href')).toBe('/forgot-password')
  })

  it('toggles new password visibility', () => {
    render(<ResetPasswordForm />)
    const input = screen.getByLabelText(/^new password$/i) as HTMLInputElement
    expect(input.type).toBe('password')

    fireEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(input.type).toBe('text')
  })

  it('toggles confirm password visibility independently', () => {
    render(<ResetPasswordForm />)
    const confirmInput = screen.getByLabelText(
      /confirm new password/i,
    ) as HTMLInputElement
    expect(confirmInput.type).toBe('password')

    fireEvent.click(
      screen.getByRole('button', { name: /show confirm password/i }),
    )
    expect(confirmInput.type).toBe('text')
  })
})
