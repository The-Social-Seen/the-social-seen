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
})
