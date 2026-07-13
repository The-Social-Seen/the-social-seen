// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockDemote = vi.fn()

vi.mock('@/app/(admin)/admin/actions', () => ({
  demoteAdminHold: (...args: unknown[]) => mockDemote(...args),
}))

import DemoteHoldButton from '../DemoteHoldButton'

beforeEach(() => {
  mockDemote.mockReset()
  vi.restoreAllMocks()
})

describe('DemoteHoldButton', () => {
  it('renders "Move to Waitlist" button text', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DemoteHoldButton bookingId="bk-1" />)
    expect(screen.getByText('Move to Waitlist')).toBeTruthy()
  })

  describe('confirm() guard', () => {
    it('INVARIANT: shows a confirm() dialog before calling demoteAdminHold — the action must NOT fire until the admin confirms', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockDemote.mockResolvedValue({ success: true, memberName: 'Amy Sangam', waitlistPosition: 2 })
      render(<DemoteHoldButton bookingId="bk-42" />)

      fireEvent.click(screen.getByRole('button'))

      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(confirmSpy.mock.calls[0][0]).toMatch(/move this person back to the waitlist/i)
      expect(mockDemote).toHaveBeenCalledWith('bk-42')
    })

    it('INVARIANT: cancelling the confirm() dialog prevents demoteAdminHold from being called at all', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<DemoteHoldButton bookingId="bk-42" />)

      fireEvent.click(screen.getByRole('button'))

      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(mockDemote).not.toHaveBeenCalled()
    })

    it('a second click after cancelling shows confirm() again (not permanently disabled)', () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
      render(<DemoteHoldButton bookingId="bk-1" />)

      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByRole('button'))

      expect(confirmSpy).toHaveBeenCalledTimes(2)
      expect(mockDemote).not.toHaveBeenCalled()
    })
  })

  describe('after confirming', () => {
    it('shows "Moving..." while the transition is pending', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      let resolvePromise: (v: unknown) => void = () => {}
      mockDemote.mockImplementation(
        () => new Promise((resolve) => { resolvePromise = resolve }),
      )
      render(<DemoteHoldButton bookingId="bk-1" />)

      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => expect(screen.getByRole('button').textContent).toBe('Moving...'))
      resolvePromise({ success: true, memberName: 'Amy Sangam', waitlistPosition: 2 })
    })

    it('shows the inline success message with the memberName on success', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      mockDemote.mockResolvedValue({ success: true, memberName: 'Amy Sangam', waitlistPosition: 2 })
      render(<DemoteHoldButton bookingId="bk-1" />)

      fireEvent.click(screen.getByRole('button'))

      await screen.findByText('Amy Sangam moved back to waitlist')
    })

    it('calls alert() with the error and shows no success message when the action fails', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      mockDemote.mockResolvedValue({
        error:
          'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.',
      })
      render(<DemoteHoldButton bookingId="bk-1" />)

      fireEvent.click(screen.getByRole('button'))

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith(
          'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.',
        ),
      )
      expect(screen.queryByText(/moved back to waitlist/i)).toBeNull()
    })
  })

  it('fullWidth applies w-full and min-h-[44px] to the button (mobile card action row)', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DemoteHoldButton bookingId="bk-1" fullWidth />)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('w-full')
    expect(btn.className).toContain('min-h-[44px]')
  })
})
