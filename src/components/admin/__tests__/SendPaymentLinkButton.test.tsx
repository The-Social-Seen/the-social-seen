// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockSendPaymentLink = vi.fn()

vi.mock('@/app/(admin)/admin/actions', () => ({
  sendPaymentLinkForConfirmedBooking: (...args: unknown[]) => mockSendPaymentLink(...args),
}))

import SendPaymentLinkButton from '../SendPaymentLinkButton'

describe('SendPaymentLinkButton', () => {
  it('renders "Send Payment Link" button text', () => {
    render(<SendPaymentLinkButton bookingId="bk-1" />)
    expect(screen.getByText('Send Payment Link')).toBeTruthy()
  })

  it('renders as a button element', () => {
    render(<SendPaymentLinkButton bookingId="bk-1" />)
    const btn = screen.getByRole('button')
    expect(btn).toBeTruthy()
    expect(btn.textContent).toBe('Send Payment Link')
  })

  it('calls sendPaymentLinkForConfirmedBooking with the correct bookingId on click', () => {
    mockSendPaymentLink.mockResolvedValue({ success: true, memberName: 'Amy Sangam' })
    render(<SendPaymentLinkButton bookingId="bk-42" />)

    fireEvent.click(screen.getByRole('button'))

    expect(mockSendPaymentLink).toHaveBeenCalledWith('bk-42')
  })

  it('shows "Sending..." while the transition is pending', async () => {
    let resolvePromise: (v: unknown) => void = () => {}
    mockSendPaymentLink.mockImplementation(
      () => new Promise((resolve) => { resolvePromise = resolve }),
    )
    render(<SendPaymentLinkButton bookingId="bk-1" />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('Sending...'))
    resolvePromise({ success: true, memberName: 'Amy Sangam' })
  })

  it('shows the inline success message with the memberName on success', async () => {
    mockSendPaymentLink.mockResolvedValue({ success: true, memberName: 'Amy Sangam' })
    render(<SendPaymentLinkButton bookingId="bk-1" />)

    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Payment link emailed to Amy Sangam')
  })

  it('does NOT show a success message and calls alert() when the action returns an error (e.g. "This booking has already been paid")', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    mockSendPaymentLink.mockResolvedValue({ error: 'This booking has already been paid' })
    render(<SendPaymentLinkButton bookingId="bk-1" />)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('This booking has already been paid'))
    expect(screen.queryByText(/emailed to/i)).toBeNull()
    alertSpy.mockRestore()
  })

  it('fullWidth applies w-full and min-h-[44px] to the button (mobile card action row)', () => {
    render(<SendPaymentLinkButton bookingId="bk-1" fullWidth />)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('w-full')
    expect(btn.className).toContain('min-h-[44px]')
  })

  it('does not call confirm() before sending (unlike DemoteHoldButton — this action is non-destructive to send)', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    mockSendPaymentLink.mockResolvedValue({ success: true, memberName: 'Amy Sangam' })
    render(<SendPaymentLinkButton bookingId="bk-1" />)

    fireEvent.click(screen.getByRole('button'))

    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
