// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockPromote = vi.fn()

vi.mock('@/app/(admin)/admin/actions', () => ({
  promoteFromWaitlist: (...args: unknown[]) => mockPromote(...args),
}))

import PromoteButton from '../PromoteButton'

describe('PromoteButton', () => {
  it('renders "Promote" button text', () => {
    render(<PromoteButton bookingId="bk-1" />)
    expect(screen.getByText('Promote')).toBeTruthy()
  })

  it('renders as a button element', () => {
    render(<PromoteButton bookingId="bk-1" />)
    const btn = screen.getByRole('button')
    expect(btn).toBeTruthy()
    expect(btn.textContent).toBe('Promote')
  })

  it('calls promoteFromWaitlist with correct bookingId on click', () => {
    mockPromote.mockResolvedValue({ success: true })
    render(<PromoteButton bookingId="bk-42" />)

    fireEvent.click(screen.getByRole('button'))

    expect(mockPromote).toHaveBeenCalledWith('bk-42')
  })

  // admin-waitlist-promotion-payment: the paid branch's success response
  // now carries extra fields (status: 'pending_payment', holdExpiresAt)
  // that this component doesn't currently render anything special for
  // (surfacing "a payment link was emailed" in the admin UI is explicitly
  // out of scope for this backend-focused PR — see the AdminEventBooking
  // type doc comment in src/types/index.ts). This test is a pure
  // regression guard: the component must not crash or mis-render when it
  // receives this new, real-world response shape instead of the plain
  // {success:true} the free path returns.
  it('does not crash when promoteFromWaitlist resolves the new paid-branch shape (status/holdExpiresAt fields)', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    mockPromote.mockResolvedValue({
      success: true,
      promotedName: 'Amy Sangam',
      status: 'pending_payment',
      holdExpiresAt: null,
    })
    render(<PromoteButton bookingId="bk-42" />)

    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Promote')
    // No alert() call — alert() only fires on result.error, which is
    // absent from a successful paid-branch response.
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})
