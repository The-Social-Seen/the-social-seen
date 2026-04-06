// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Mocks ──────────────────────────────────────────────────────────────────

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

// Render Radix DropdownMenu children directly without portals or animations
vi.mock('@radix-ui/react-dropdown-menu', () => ({
  Root: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Trigger: ({ children }: React.PropsWithChildren<{ asChild?: boolean }>) => <>{children}</>,
  Portal: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Content: ({
    children,
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  Item: ({
    children,
    onSelect,
    asChild,
    className,
  }: React.PropsWithChildren<{
    onSelect?: () => void
    asChild?: boolean
    className?: string
  }>) => {
    if (asChild) return <>{children}</>
    return (
      <button className={className} onClick={onSelect}>
        {children}
      </button>
    )
  },
  Separator: () => <hr />,
}))

import { AvatarDropdown } from '../AvatarDropdown'

// ── Fixtures ────────────────────────────────────────────────────────────────

const baseProps = {
  avatarUrl: null,
  initials: 'JD',
  onSignOut: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AvatarDropdown — always-visible items', () => {
  it('renders without crashing', () => {
    const { container } = render(<AvatarDropdown {...baseProps} />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders the avatar trigger button', () => {
    render(<AvatarDropdown {...baseProps} />)
    expect(screen.getByRole('button', { name: /account menu/i })).toBeTruthy()
  })

  it('renders initials when no avatarUrl is provided', () => {
    render(<AvatarDropdown {...baseProps} initials="AB" />)
    expect(screen.getByText('AB')).toBeTruthy()
  })

  it('renders avatar image when avatarUrl is provided', () => {
    render(
      <AvatarDropdown
        {...baseProps}
        avatarUrl="https://example.com/avatar.jpg"
      />
    )
    expect(screen.getByAltText(/your avatar/i)).toBeTruthy()
  })

  it('always renders Profile link pointing to /profile', () => {
    render(<AvatarDropdown {...baseProps} />)
    const link = screen.getByRole('link', { name: /^profile$/i })
    expect(link.getAttribute('href')).toBe('/profile')
  })

  it('always renders My Bookings link pointing to /bookings', () => {
    render(<AvatarDropdown {...baseProps} />)
    const link = screen.getByRole('link', { name: /my bookings/i })
    expect(link.getAttribute('href')).toBe('/bookings')
  })

  it('always renders Sign Out item', () => {
    render(<AvatarDropdown {...baseProps} />)
    expect(screen.getByText(/sign out/i)).toBeTruthy()
  })

  it('calls onSignOut when Sign Out is clicked', () => {
    const onSignOut = vi.fn()
    render(<AvatarDropdown {...baseProps} onSignOut={onSignOut} />)
    fireEvent.click(screen.getByText(/sign out/i))
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})

describe('AvatarDropdown — isAdmin conditional rendering', () => {
  it('renders Dashboard link when isAdmin=true', () => {
    render(<AvatarDropdown {...baseProps} isAdmin={true} />)
    const link = screen.getByRole('link', { name: /dashboard/i })
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('/admin')
  })

  it('does NOT render Dashboard link when isAdmin=false', () => {
    render(<AvatarDropdown {...baseProps} isAdmin={false} />)
    expect(screen.queryByRole('link', { name: /dashboard/i })).toBeNull()
  })

  it('does NOT render Dashboard link when isAdmin is undefined', () => {
    render(<AvatarDropdown {...baseProps} />)
    expect(screen.queryByRole('link', { name: /dashboard/i })).toBeNull()
  })

  it('Profile and Bookings links still render when isAdmin=true', () => {
    render(<AvatarDropdown {...baseProps} isAdmin={true} />)
    expect(screen.getByRole('link', { name: /^profile$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /my bookings/i })).toBeTruthy()
  })

  it('Profile and Bookings links still render when isAdmin=false', () => {
    render(<AvatarDropdown {...baseProps} isAdmin={false} />)
    expect(screen.getByRole('link', { name: /^profile$/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /my bookings/i })).toBeTruthy()
  })
})
