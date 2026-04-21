// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

vi.mock('next/navigation', () => ({
  usePathname: () => '/events/wine-and-wisdom',
}))

import { VerifyPromptModal } from '../VerifyPromptModal'

describe('VerifyPromptModal', () => {
  it('renders nothing when isOpen=false', () => {
    const { queryByRole } = render(
      <VerifyPromptModal isOpen={false} onClose={() => {}} />,
    )
    expect(queryByRole('dialog')).toBeNull()
  })

  it('renders heading and body when open', () => {
    render(<VerifyPromptModal isOpen={true} onClose={() => {}} />)
    expect(
      screen.getByRole('heading', { name: /verify your email to book/i }),
    ).toBeTruthy()
    expect(screen.getByText(/before you can book/i)).toBeTruthy()
  })

  it('renders "Verify now" link with /verify?from=<currentPath>', () => {
    render(<VerifyPromptModal isOpen={true} onClose={() => {}} />)
    const cta = screen.getByRole('link', { name: /verify now/i })
    expect(cta.getAttribute('href')).toBe(
      '/verify?from=' + encodeURIComponent('/events/wine-and-wisdom'),
    )
  })

  it('calls onClose when Cancel button is clicked', () => {
    const handleClose = vi.fn()
    render(<VerifyPromptModal isOpen={true} onClose={handleClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(handleClose).toHaveBeenCalled()
  })

  it('calls onClose when X close button is clicked', () => {
    const handleClose = vi.fn()
    render(<VerifyPromptModal isOpen={true} onClose={handleClose} />)
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(handleClose).toHaveBeenCalled()
  })
})
