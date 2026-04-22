// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockReplace = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key),
  }),
}))

import AccountDeletedHandler from '../AccountDeletedHandler'

describe('AccountDeletedHandler', () => {
  beforeEach(() => {
    mockReplace.mockClear()
    mockSearchParams = new URLSearchParams()
  })

  it('renders nothing when ?account_deleted is absent', () => {
    const { container } = render(<AccountDeletedHandler />)
    expect(container.firstChild).toBeNull()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('shows the closure toast when ?account_deleted=1 is present', () => {
    mockSearchParams = new URLSearchParams('account_deleted=1')

    render(<AccountDeletedHandler />)

    expect(screen.getByRole('status').textContent).toMatch(
      /your account has been closed/i,
    )
  })

  it('strips the param via router.replace to prevent re-fire on refresh', () => {
    mockSearchParams = new URLSearchParams('account_deleted=1')

    render(<AccountDeletedHandler />)

    expect(mockReplace).toHaveBeenCalledTimes(1)
    const replacedPath = mockReplace.mock.calls[0][0] as string
    expect(replacedPath).not.toContain('account_deleted')
  })
})
