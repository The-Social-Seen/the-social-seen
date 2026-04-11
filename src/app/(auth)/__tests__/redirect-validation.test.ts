/**
 * Tests for the open-redirect mitigation applied to the signIn action.
 *
 * The validateRedirect() helper inside actions.ts is private, so we test its
 * behaviour through the public signIn() Server Action. Any redirectTo value
 * that would direct the user to an external URL must be rejected and replaced
 * with the safe default (/events).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockSignInWithPassword = vi.fn()
const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signInWithPassword: mockSignInWithPassword,
        getUser: mockGetUser,
      },
      from: mockFrom,
    })
  ),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { signIn } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a chainable Supabase query mock that resolves with `response`. */
function makeChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['select', 'eq', 'single', 'update', 'insert', 'is', 'order']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

function mockSuccessfulSignIn(role: 'member' | 'admin' = 'member') {
  mockSignInWithPassword.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  })
  // from('profiles') → role check (used only when no redirectTo)
  mockFrom.mockReturnValue(makeChain({ data: { role } }))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('signIn — open redirect prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Valid relative paths (should pass through unchanged) ─────────────────

  it('allows /events as redirect target', async () => {
    mockSuccessfulSignIn()
    const result = await signIn({ email: 'a@b.com', password: 'password1', redirectTo: '/events' })
    expect(result).toMatchObject({ success: true, redirectTo: '/events' })
  })

  it('allows /profile as redirect target', async () => {
    mockSuccessfulSignIn()
    const result = await signIn({ email: 'a@b.com', password: 'password1', redirectTo: '/profile' })
    expect(result).toMatchObject({ success: true, redirectTo: '/profile' })
  })

  it('allows /bookings as redirect target', async () => {
    mockSuccessfulSignIn()
    const result = await signIn({ email: 'a@b.com', password: 'password1', redirectTo: '/bookings' })
    expect(result).toMatchObject({ success: true, redirectTo: '/bookings' })
  })

  it('allows deep relative paths like /events/wine-evening', async () => {
    mockSuccessfulSignIn()
    const result = await signIn({ email: 'a@b.com', password: 'password1', redirectTo: '/events/wine-evening' })
    expect(result).toMatchObject({ success: true, redirectTo: '/events/wine-evening' })
  })

  // ── Invalid / external paths (must be rejected → /events) ────────────────

  it('rejects absolute URLs (https://evil.com)', async () => {
    mockSuccessfulSignIn()
    const result = await signIn({ email: 'a@b.com', password: 'password1', redirectTo: 'https://evil.com' })
    // Zod refine should reject this before signIn logic runs
    expect(result).toMatchObject({ error: expect.any(String) })
  })

  it('rejects protocol-relative URLs (//evil.com)', async () => {
    mockSuccessfulSignIn()
    const result = await signIn({ email: 'a@b.com', password: 'password1', redirectTo: '//evil.com' })
    expect(result).toMatchObject({ error: expect.any(String) })
  })

  it('rejects javascript: URIs', async () => {
    mockSuccessfulSignIn()
    const result = await signIn({ email: 'a@b.com', password: 'password1', redirectTo: 'javascript:alert(1)' })
    expect(result).toMatchObject({ error: expect.any(String) })
  })

  it('rejects http:// URLs', async () => {
    mockSuccessfulSignIn()
    const result = await signIn({ email: 'a@b.com', password: 'password1', redirectTo: 'http://evil.com/steal' })
    expect(result).toMatchObject({ error: expect.any(String) })
  })

  // ── Missing / empty redirectTo (defaults to /events or /admin for admins) ─

  it('defaults to /events when redirectTo is omitted', async () => {
    mockSuccessfulSignIn('member')
    const result = await signIn({ email: 'a@b.com', password: 'password1' })
    expect(result).toMatchObject({ success: true, redirectTo: '/events' })
  })

  it('redirects admin to /admin when redirectTo is omitted', async () => {
    mockSuccessfulSignIn('admin')
    const result = await signIn({ email: 'a@b.com', password: 'password1' })
    expect(result).toMatchObject({ success: true, redirectTo: '/admin' })
  })
})
