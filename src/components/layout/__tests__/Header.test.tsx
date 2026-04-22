// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Mock framer-motion to render children directly
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div {...filterDomProps(props)}>{children}</div>
    ),
    p: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <p {...filterDomProps(props)}>{children}</p>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useInView: () => true,
}))

// Filter out framer-motion specific props that aren't valid DOM attributes
function filterDomProps(props: Record<string, unknown>) {
  const invalid = ['variants', 'initial', 'animate', 'exit', 'whileInView', 'viewport', 'transition', 'custom']
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (!invalid.includes(key)) filtered[key] = value
  }
  return filtered
}

// Mock next/navigation with a mutable pathname so tests can simulate navigation
let mockPathname = '/events'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => mockPathname,
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string; [key: string]: unknown }) => (
    <img alt={alt} {...filterImgProps(props)} />
  ),
}))

function filterImgProps(props: Record<string, unknown>) {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string' || typeof value === 'number') {
      filtered[key] = value
    }
  }
  return filtered
}

// Mock ThemeProvider
vi.mock('@/components/layout/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}))

// Mock AvatarDropdown
vi.mock('@/components/layout/AvatarDropdown', () => ({
  AvatarDropdown: () => <div data-testid="avatar-dropdown" />,
}))

// Mock supabase client — dynamic import, so we mock the module.
// Returns the same instance each call to mirror the real singleton.
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null } })
const mockOnAuthStateChange = vi.fn().mockReturnValue({
  data: { subscription: { unsubscribe: vi.fn() } },
})
const mockProfileSingle = vi.fn().mockResolvedValue({ data: null })
vi.mock('@/lib/supabase/client', () => {
  const mockClient = {
    auth: {
      getSession: mockGetSession,
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: mockOnAuthStateChange,
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockProfileSingle,
    }),
  }
  return { createClient: () => mockClient }
})

import { Header } from '../Header'

describe('Header (unauthenticated)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/events'
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockProfileSingle.mockResolvedValue({ data: null })
  })

  it('renders without crashing', () => {
    const { container } = render(<Header />)
    expect(container.querySelector('header')).toBeTruthy()
  })

  it('renders logo with link to home', () => {
    render(<Header />)
    const logoLink = screen.getByRole('link', { name: /the social seen/i })
    expect(logoLink.getAttribute('href')).toBe('/')
  })

  it('renders Events nav link with route href /events', () => {
    render(<Header />)
    const links = screen.getAllByRole('link', { name: /^events$/i })
    const hasRouteLink = links.some((l) => l.getAttribute('href') === '/events')
    expect(hasRouteLink).toBe(true)
  })

  it('renders Gallery nav link with route href /gallery', () => {
    render(<Header />)
    const links = screen.getAllByRole('link', { name: /^gallery$/i })
    const hasRouteLink = links.some((l) => l.getAttribute('href') === '/gallery')
    expect(hasRouteLink).toBe(true)
  })

  it('renders Join nav link with route href /join', () => {
    render(<Header />)
    const links = screen.getAllByRole('link', { name: /^join$/i })
    const hasRouteLink = links.some((l) => l.getAttribute('href') === '/join')
    expect(hasRouteLink).toBe(true)
  })

  it('renders Sign In link with route href /login (after auth resolves)', async () => {
    render(<Header />)
    // Auth is async — initial render shows a loading placeholder to prevent
    // the Sign In button from flashing for authenticated users.
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /sign in/i })
      const hasRouteLink = links.some((l) => l.getAttribute('href') === '/login')
      expect(hasRouteLink).toBe(true)
    })
  })

  it('does NOT render "About" in any nav link', () => {
    render(<Header />)
    const aboutLinks = screen.queryAllByRole('link', { name: /^about$/i })
    expect(aboutLinks.length).toBe(0)
  })

  it('has no hash anchor hrefs in any link', () => {
    render(<Header />)
    const allLinks = screen.getAllByRole('link')
    const hashLinks = allLinks.filter((l) => {
      const href = l.getAttribute('href') ?? ''
      return href.startsWith('#')
    })
    expect(hashLinks.length).toBe(0)
  })

  it('renders theme toggle button with accessible label', () => {
    render(<Header />)
    const toggles = screen.getAllByRole('button', { name: /switch to .* mode/i })
    expect(toggles.length).toBeGreaterThan(0)
  })

  it('renders mobile menu hamburger button', () => {
    render(<Header />)
    const hamburger = screen.getByRole('button', { name: /open menu/i })
    expect(hamburger).toBeTruthy()
  })
})

describe('Header (Server-Action login — pathname re-check)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/login'
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockProfileSingle.mockResolvedValue({ data: null })
  })

  it('swaps Sign In for the avatar when pathname changes after Server-Action login', async () => {
    // Initial render on /login with no session → Sign In visible.
    const { rerender } = render(<Header />)
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /sign in/i })
      expect(links.some((l) => l.getAttribute('href') === '/login')).toBe(true)
    })

    // Simulate what a Server-Action login does:
    //   1. Server sets the session cookie in the response
    //   2. Client does router.push('/events') + router.refresh()
    //   3. Supabase browser client sees the new cookie on next getSession()
    //
    // onAuthStateChange is NOT fired (the session was established server-side),
    // so the Header has to re-read the cookie when the pathname changes.
    const fakeSession = {
      user: { id: 'user-1', user_metadata: { full_name: 'Test User' } },
    }
    mockGetSession.mockResolvedValue({ data: { session: fakeSession } })
    mockProfileSingle.mockResolvedValue({ data: { role: 'member' } })
    mockPathname = '/events'
    rerender(<Header />)

    await waitFor(() => {
      expect(screen.getByTestId('avatar-dropdown')).toBeTruthy()
    })

    // And Sign In should be gone.
    const remainingSignIns = screen
      .queryAllByRole('link', { name: /sign in/i })
      .filter((l) => l.getAttribute('href') === '/login')
    expect(remainingSignIns.length).toBe(0)
  })
})
