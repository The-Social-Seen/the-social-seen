// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'

// ── Mocks ──────────────────────────────────────────────────────────────────

function filterDomProps(props: Record<string, unknown>) {
  const invalid = [
    'variants', 'initial', 'animate', 'exit',
    'whileInView', 'viewport', 'transition', 'custom',
  ]
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!invalid.includes(key)) filtered[key] = value
  }
  return filtered
}

vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...filterDomProps(props)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string; [key: string]: unknown }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}))

import { MobileMenu } from '../MobileMenu'

// ── Fixtures ────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
} as unknown as User

const navLinks = [
  { label: 'Events', href: '/events' },
  { label: 'Gallery', href: '/gallery' },
] as const

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  user: mockUser,
  navLinks,
  userFullName: 'John Doe',
  userInitials: 'JD',
  avatarUrl: null,
  onSignOut: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('MobileMenu — visibility', () => {
  it('renders nothing when isOpen=false', () => {
    const { container } = render(<MobileMenu {...baseProps} isOpen={false} />)
    // The isOpen && (...) guard keeps drawer off-screen when false
    expect(container.textContent).toBe('')
  })

  it('renders nav links when isOpen=true', () => {
    render(<MobileMenu {...baseProps} />)
    expect(screen.getByRole('link', { name: /^events$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^gallery$/i })).toBeTruthy()
  })

  it('renders a close button', () => {
    render(<MobileMenu {...baseProps} />)
    expect(screen.getByRole('button', { name: /close menu/i })).toBeTruthy()
  })
})

describe('MobileMenu — unauthenticated state', () => {
  it('renders Sign In link when user is null', () => {
    render(<MobileMenu {...baseProps} user={null} />)
    expect(screen.getByRole('link', { name: /sign in/i })).toBeTruthy()
  })

  it('does NOT render Sign Out button when user is null', () => {
    render(<MobileMenu {...baseProps} user={null} />)
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull()
  })
})

describe('MobileMenu — authenticated state', () => {
  it('renders the user full name in header', () => {
    render(<MobileMenu {...baseProps} />)
    expect(screen.getByText('John Doe')).toBeTruthy()
  })

  it('renders Sign Out button when user is logged in', () => {
    render(<MobileMenu {...baseProps} />)
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy()
  })

  it('does NOT render Sign In link when user is logged in', () => {
    render(<MobileMenu {...baseProps} />)
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull()
  })
})

describe('MobileMenu — isAdmin conditional rendering', () => {
  it('renders Dashboard link when user is set and isAdmin=true', () => {
    render(<MobileMenu {...baseProps} isAdmin={true} />)
    const adminLinks = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href') === '/admin')
    expect(adminLinks).toHaveLength(1)
  })

  it('Dashboard link points to /admin', () => {
    render(<MobileMenu {...baseProps} isAdmin={true} />)
    const link = screen.getByRole('link', { name: /dashboard/i })
    expect(link.getAttribute('href')).toBe('/admin')
  })

  it('does NOT render Dashboard link when isAdmin=false', () => {
    render(<MobileMenu {...baseProps} isAdmin={false} />)
    const adminLinks = screen
      .queryAllByRole('link')
      .filter((l) => l.getAttribute('href') === '/admin')
    expect(adminLinks).toHaveLength(0)
  })

  it('does NOT render Dashboard link when isAdmin is undefined', () => {
    render(<MobileMenu {...baseProps} />)
    const adminLinks = screen
      .queryAllByRole('link')
      .filter((l) => l.getAttribute('href') === '/admin')
    expect(adminLinks).toHaveLength(0)
  })

  it('does NOT render Dashboard when user is null even if isAdmin=true', () => {
    render(<MobileMenu {...baseProps} user={null} isAdmin={true} />)
    const adminLinks = screen
      .queryAllByRole('link')
      .filter((l) => l.getAttribute('href') === '/admin')
    expect(adminLinks).toHaveLength(0)
  })

  it('still renders regular nav links when isAdmin=true', () => {
    render(<MobileMenu {...baseProps} isAdmin={true} />)
    expect(screen.getByRole('link', { name: /^events$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /^gallery$/i })).toBeTruthy()
  })
})
