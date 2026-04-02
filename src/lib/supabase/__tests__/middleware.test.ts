import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.mock() is hoisted, so factory functions must be self-contained
// (no references to variables declared outside the factory).
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}))

// Define next and redirect as vi.fn() directly inside the factory — no outer refs
vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(() => ({
      cookies: { set: vi.fn() },
      status: 200,
    })),
    redirect: vi.fn((url: URL) => ({
      url: url.toString(),
      status: 307,
    })),
  },
}))

// ---------------------------------------------------------------------------
// Subject under test — imported AFTER vi.mock() declarations
// ---------------------------------------------------------------------------
import { updateSession } from '../middleware'
import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Helper: creates a minimal NextRequest-shaped object for a given pathname
// ---------------------------------------------------------------------------
function makeRequest(pathname: string) {
  const baseUrl = new URL(`http://localhost${pathname}`)
  return {
    nextUrl: {
      pathname,
      /** Returns a real URL so the middleware can set .pathname and .searchParams */
      clone: () => new URL(baseUrl.toString()),
    },
    cookies: {
      getAll: vi.fn(() => []),
      set: vi.fn(),
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('updateSession middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  })

  // --- env var guard -------------------------------------------------------

  it('redirects to /login?error=configuration when env vars are missing on a protected route', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const req = makeRequest('/profile')
    await updateSession(req)

    expect(NextResponse.redirect).toHaveBeenCalledOnce()
    const redirectUrl: URL = vi.mocked(NextResponse.redirect).mock.calls[0][0]
    expect(redirectUrl.pathname).toBe('/login')
    expect(redirectUrl.searchParams.get('error')).toBe('configuration')
  })

  it('passes the request through when env vars are missing on a public route', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    const req = makeRequest('/events')
    await expect(updateSession(req)).resolves.toBeDefined()
    expect(NextResponse.redirect).not.toHaveBeenCalled()
  })

  // --- unauthenticated user on protected routes ----------------------------

  it('redirects unauthenticated user from /profile to /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/profile'))

    expect(NextResponse.redirect).toHaveBeenCalledOnce()
    const redirectUrl: URL = vi.mocked(NextResponse.redirect).mock.calls[0][0]
    expect(redirectUrl.pathname).toBe('/login')
  })

  it('includes original path as ?redirect= query param', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/profile'))

    const redirectUrl: URL = vi.mocked(NextResponse.redirect).mock.calls[0][0]
    expect(redirectUrl.searchParams.get('redirect')).toBe('/profile')
  })

  it('redirects unauthenticated user from /bookings to /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/bookings'))

    expect(NextResponse.redirect).toHaveBeenCalledOnce()
    const redirectUrl: URL = vi.mocked(NextResponse.redirect).mock.calls[0][0]
    expect(redirectUrl.pathname).toBe('/login')
  })

  it('redirects unauthenticated user from /admin to /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/admin'))

    expect(NextResponse.redirect).toHaveBeenCalledOnce()
    const redirectUrl: URL = vi.mocked(NextResponse.redirect).mock.calls[0][0]
    expect(redirectUrl.pathname).toBe('/login')
  })

  it('redirects unauthenticated user from /admin/events (nested path)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/admin/events'))

    expect(NextResponse.redirect).toHaveBeenCalledOnce()
  })

  it('redirects unauthenticated user from /profile/edit (nested path)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/profile/edit'))

    expect(NextResponse.redirect).toHaveBeenCalledOnce()
  })

  // --- unauthenticated user on public routes --------------------------------

  it('allows unauthenticated user on / (landing page)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/'))

    expect(NextResponse.redirect).not.toHaveBeenCalled()
    expect(NextResponse.next).toHaveBeenCalled()
  })

  it('allows unauthenticated user on /events', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/events'))

    expect(NextResponse.redirect).not.toHaveBeenCalled()
  })

  it('allows unauthenticated user on /events/:slug', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/events/wine-tasting-soho'))

    expect(NextResponse.redirect).not.toHaveBeenCalled()
  })

  it('allows unauthenticated user on /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/login'))

    expect(NextResponse.redirect).not.toHaveBeenCalled()
  })

  it('allows unauthenticated user on /join', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/join'))

    expect(NextResponse.redirect).not.toHaveBeenCalled()
  })

  it('allows unauthenticated user on /gallery', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    await updateSession(makeRequest('/gallery'))

    expect(NextResponse.redirect).not.toHaveBeenCalled()
  })

  // --- authenticated user on protected routes ------------------------------

  it('allows authenticated user to access /profile', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'charlotte@example.com' } },
    })

    await updateSession(makeRequest('/profile'))

    expect(NextResponse.redirect).not.toHaveBeenCalled()
    expect(NextResponse.next).toHaveBeenCalled()
  })

  it('allows authenticated user to access /admin', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-456', email: 'mitesh50@hotmail.com' } },
    })

    await updateSession(makeRequest('/admin'))

    expect(NextResponse.redirect).not.toHaveBeenCalled()
  })

  it('allows authenticated user to access /bookings', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-789', email: 'james@example.com' } },
    })

    await updateSession(makeRequest('/bookings'))

    expect(NextResponse.redirect).not.toHaveBeenCalled()
  })
})
