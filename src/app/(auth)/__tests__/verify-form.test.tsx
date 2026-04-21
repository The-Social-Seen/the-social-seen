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
  for (const [k, v] of Object.entries(props)) {
    if (!invalid.includes(k)) filtered[k] = v
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
const mockRefresh = vi.fn()
let mockFromParam: string | null = null

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'from' ? mockFromParam : null),
  }),
}))

const mockSendVerificationOtp = vi.fn()
const mockVerifyEmailOtp = vi.fn()

vi.mock('../actions', () => ({
  sendVerificationOtp: (...a: unknown[]) => mockSendVerificationOtp(...a),
  verifyEmailOtp: (...a: unknown[]) => mockVerifyEmailOtp(...a),
}))

const mockTrack = vi.fn()
vi.mock('@/lib/analytics/track', () => ({
  track: (...a: unknown[]) => mockTrack(...a),
}))

import { VerifyForm } from '../verify/verify-form'

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Wait for the auto-send-on-mount to settle and the digit inputs to render.
 * Returns the array of 6 digit input elements.
 */
async function waitForReady() {
  return waitFor(() => {
    const inputs = screen.getAllByRole('textbox', { name: /digit \d of 6/i })
    expect(inputs.length).toBe(6)
    return inputs as HTMLInputElement[]
  })
}

function typeCode(inputs: HTMLInputElement[], code: string) {
  for (let i = 0; i < code.length; i++) {
    fireEvent.change(inputs[i], { target: { value: code[i] } })
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VerifyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFromParam = null
  })

  it('auto-sends OTP on mount and renders the digit inputs', async () => {
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    render(<VerifyForm />)
    await waitForReady()
    expect(mockSendVerificationOtp).toHaveBeenCalledTimes(1)
  })

  it('fires email_verification_requested with source: "direct" on auto-send', async () => {
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    render(<VerifyForm />)
    await waitForReady()
    expect(mockTrack).toHaveBeenCalledWith('email_verification_requested', {
      source: 'direct',
    })
  })

  it('shows send-error state with Try Again when initial send fails', async () => {
    mockSendVerificationOtp.mockResolvedValue({
      error: 'Could not send verification email. Please try again.',
    })
    render(<VerifyForm />)
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /couldn.t send code/i }),
      ).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('shows sign-in CTA when initial send returns "must be signed in"', async () => {
    mockSendVerificationOtp.mockResolvedValue({
      error: 'You must be signed in',
    })
    render(<VerifyForm />)
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /^sign in$/i })
      expect(link.getAttribute('href')).toBe('/login')
    })
  })

  it('calls verifyEmailOtp with the entered 6-digit code', async () => {
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    mockVerifyEmailOtp.mockResolvedValue({ success: true })

    render(<VerifyForm />)
    const inputs = await waitForReady()
    typeCode(inputs, '123456')

    await waitFor(() => {
      expect(mockVerifyEmailOtp).toHaveBeenCalledWith({ code: '123456' })
    })
  })

  it('fires email_verification_completed and redirects on success', async () => {
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    mockVerifyEmailOtp.mockResolvedValue({ success: true })

    render(<VerifyForm />)
    const inputs = await waitForReady()
    typeCode(inputs, '654321')

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith(
        'email_verification_completed',
        {},
      )
    })

    await waitFor(
      () => {
        expect(mockPush).toHaveBeenCalledWith('/events')
      },
      { timeout: 3000 },
    )
  })

  it('honours the ?from= query param for redirect (sanitised)', async () => {
    mockFromParam = '/events/wine-and-wisdom'
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    mockVerifyEmailOtp.mockResolvedValue({ success: true })

    render(<VerifyForm />)
    const inputs = await waitForReady()
    typeCode(inputs, '111111')

    await waitFor(
      () => {
        expect(mockPush).toHaveBeenCalledWith('/events/wine-and-wisdom')
      },
      { timeout: 3000 },
    )
  })

  it('rejects open-redirect attempts in ?from= and falls back to /events', async () => {
    mockFromParam = 'https://evil.com'
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    mockVerifyEmailOtp.mockResolvedValue({ success: true })

    render(<VerifyForm />)
    const inputs = await waitForReady()
    typeCode(inputs, '222222')

    await waitFor(
      () => {
        expect(mockPush).toHaveBeenCalledWith('/events')
      },
      { timeout: 3000 },
    )
  })

  it('shows friendly error on invalid code and clears digits for retry', async () => {
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    mockVerifyEmailOtp.mockResolvedValue({
      error: 'That code is invalid or has expired. Request a new one.',
    })

    render(<VerifyForm />)
    const inputs = await waitForReady()
    typeCode(inputs, '999999')

    await waitFor(() => {
      expect(screen.getByText(/invalid or has expired/i)).toBeTruthy()
    })
    // Digits should be cleared so user can retype
    expect(inputs.every((i) => i.value === '')).toBe(true)
  })

  it('fires email_verification_failed with reason "invalid_code"', async () => {
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    mockVerifyEmailOtp.mockResolvedValue({
      error: 'That code is invalid or has expired. Request a new one.',
    })

    render(<VerifyForm />)
    const inputs = await waitForReady()
    typeCode(inputs, '999999')

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('email_verification_failed', {
        reason: 'invalid_code',
      })
    })
  })

  it('disables Resend button initially and shows countdown', async () => {
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    render(<VerifyForm />)
    await waitForReady()
    // Resend button should not be present (it's a span "Resend in 60s")
    expect(screen.getByText(/resend in 60s/i)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /resend code/i }),
    ).toBeNull()
  })

  it('renders "Not now" link to the redirect target', async () => {
    mockFromParam = '/profile'
    mockSendVerificationOtp.mockResolvedValue({ success: true })
    render(<VerifyForm />)
    await waitForReady()
    const notNow = screen.getByRole('link', { name: /not now/i })
    expect(notNow.getAttribute('href')).toBe('/profile')
  })

  it('skips the code-entry screen and shows success when already verified', async () => {
    mockSendVerificationOtp.mockResolvedValue({
      success: true,
      alreadyVerified: true,
    })

    render(<VerifyForm />)

    // Should jump straight to success — no digit inputs ever appear.
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /email verified/i }),
      ).toBeTruthy()
    })

    // The misleading "Enter the 6-digit code" copy should never have shown.
    expect(
      screen.queryByText(/enter the 6-digit code/i),
    ).toBeNull()

    // verifyEmailOtp should NOT have been called — there's no code to verify.
    expect(mockVerifyEmailOtp).not.toHaveBeenCalled()

    // Analytics: should fire completed (not failed)
    expect(mockTrack).toHaveBeenCalledWith('email_verification_completed', {})
  })

  // NOTE: countdown-tick test deferred to follow-up — fake-timer interaction
  // with the async auto-send + React effects requires a more elaborate
  // act() / microtask-draining setup than is worth bolting on here.
  // The initial state ("Resend in 60s" rendered, button hidden) is already
  // covered above; the per-second countdown logic is simple enough that
  // the regression surface is small. Tracked in docs/FOLLOW-UPS.md.
})
