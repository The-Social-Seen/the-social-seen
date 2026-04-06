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
  for (const [key, value] of Object.entries(props)) {
    if (!invalid.includes(key)) filtered[key] = value
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
let mockRedirectParam: string | null = null

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'redirect' ? mockRedirectParam : null),
  }),
}))

const mockSignIn = vi.fn()

vi.mock('../actions', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}))

// The updated LoginForm does a dynamic import of the browser Supabase client
// after a successful sign-in to sync auth state. Mock it here so tests don't
// hit the real client (which would throw for missing env vars).
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  }),
}))

import { LoginForm } from '../login/login-form'

// ── Tests ──────────────────────────────────────────────────────────────────

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedirectParam = null
  })

  it('renders "Welcome Back" heading', () => {
    render(<LoginForm />)
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeTruthy()
  })

  it('renders email and password fields', () => {
    render(<LoginForm />)
    expect(screen.getByLabelText(/email address/i)).toBeTruthy()
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy()
  })

  it('renders "Sign In" submit button', () => {
    render(<LoginForm />)
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy()
  })

  it('renders disabled Google OAuth button', () => {
    render(<LoginForm />)
    const googleBtn = screen.getByRole('button', { name: /continue with google/i })
    expect(googleBtn.hasAttribute('disabled')).toBe(true)
  })

  it('renders "Coming soon" tooltips for disabled features', () => {
    render(<LoginForm />)
    const tooltips = screen.getAllByText('Coming soon')
    expect(tooltips.length).toBeGreaterThanOrEqual(1)
  })

  it('renders "Forgot password?" as disabled button', () => {
    render(<LoginForm />)
    const forgotBtn = screen.getByRole('button', { name: /forgot password/i })
    expect(forgotBtn.hasAttribute('disabled')).toBe(true)
  })

  it('renders "Join now" link pointing to /join', () => {
    render(<LoginForm />)
    const joinLink = screen.getByRole('link', { name: /join now/i })
    expect(joinLink.getAttribute('href')).toBe('/join')
  })

  it('shows error when submitting with empty fields', async () => {
    render(<LoginForm />)
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(screen.getByText(/please enter your email and password/i)).toBeTruthy()
    })
  })

  it('shows "Invalid email or password" on auth failure', async () => {
    mockSignIn.mockResolvedValue({ error: 'Invalid email or password' })

    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'test@test.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'wrongpassword' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password')).toBeTruthy()
    })
  })

  it('redirects to /events on successful sign in (default)', async () => {
    mockSignIn.mockResolvedValue({ success: true, redirectTo: '/events' })

    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'test@test.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/events')
    })
  })

  it('preserves redirect URL and passes it to signIn action', async () => {
    mockRedirectParam = '/events/wine-and-wisdom'
    mockSignIn.mockResolvedValue({
      success: true,
      redirectTo: '/events/wine-and-wisdom',
    })

    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'test@test.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'test@test.com',
        password: 'password123',
        redirectTo: '/events/wine-and-wisdom',
      })
      expect(mockPush).toHaveBeenCalledWith('/events/wine-and-wisdom')
    })
  })

  it('renders password visibility toggle', () => {
    render(<LoginForm />)
    const toggleBtn = screen.getByRole('button', { name: /show password/i })
    expect(toggleBtn).toBeTruthy()
  })

  it('toggles password field type on visibility click', () => {
    render(<LoginForm />)
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement
    expect(passwordInput.type).toBe('password')

    fireEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(passwordInput.type).toBe('text')

    fireEvent.click(screen.getByRole('button', { name: /hide password/i }))
    expect(passwordInput.type).toBe('password')
  })
})
