import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockSignUp = vi.fn()
const mockSignInWithPassword = vi.fn()
const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signUp: mockSignUp,
        signInWithPassword: mockSignInWithPassword,
        getUser: mockGetUser,
      },
      from: mockFrom,
    })
  ),
}))

// Mock next/cache and next/navigation (Server Action dependencies)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

import { signUp, signIn, saveInterests, completeOnboarding } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function mockSupabaseChain(response: { data?: unknown; error?: unknown }) {
  // Every method returns the chain itself, and the chain is also a thenable
  // so it resolves when awaited at any point in the chain.
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'single']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Make the chain thenable so `await supabase.from(...).update(...).eq(...)` resolves
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  mockFrom.mockReturnValue(chain)
  return chain
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('signUp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Shared baseline for signUp tests — all required fields populated.
  // Override fields per test as needed.
  const validInput = {
    fullName: 'Charlotte Moreau',
    email: 'charlotte@example.com',
    password: 'password123',
    phoneNumber: '+447123456789',
    emailConsent: false,
  }

  it('returns error when full name is empty', async () => {
    const result = await signUp({ ...validInput, fullName: '' })
    expect(result).toHaveProperty('error')
  })

  it('returns error when email is invalid', async () => {
    const result = await signUp({ ...validInput, email: 'not-an-email' })
    expect(result).toHaveProperty('error')
  })

  it('returns error when password is too short', async () => {
    const result = await signUp({ ...validInput, password: 'short' })
    expect(result).toHaveProperty('error')
  })

  it('returns error when phone number contains letters', async () => {
    const result = await signUp({ ...validInput, phoneNumber: 'abc' })
    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toContain('phone number')
    }
  })

  it('returns error when phone number is too short', async () => {
    const result = await signUp({ ...validInput, phoneNumber: '12345' })
    expect(result).toHaveProperty('error')
  })

  it('accepts UK phone number in +44 format', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ id: '1' }] } },
      error: null,
    })

    const result = await signUp({ ...validInput, phoneNumber: '+447123456789' })
    expect(result).toEqual({ success: true })
  })

  it('accepts UK phone number in 07... format', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ id: '1' }] } },
      error: null,
    })

    const result = await signUp({ ...validInput, phoneNumber: '07123456789' })
    expect(result).toEqual({ success: true })
  })

  it('returns success for valid input', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ id: '1' }] } },
      error: null,
    })

    const result = await signUp(validInput)

    expect(result).toEqual({ success: true })
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'charlotte@example.com',
      password: 'password123',
      options: {
        data: {
          full_name: 'Charlotte Moreau',
          phone_number: '+447123456789',
          email_consent: false,
        },
      },
    })
  })

  it('passes email_consent: true through to user metadata when opted in', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ id: '1' }] } },
      error: null,
    })

    await signUp({ ...validInput, emailConsent: true })

    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          data: expect.objectContaining({ email_consent: true }),
        },
      }),
    )
  })

  it('passes email_consent: false through to user metadata when opted out', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ id: '1' }] } },
      error: null,
    })

    await signUp({ ...validInput, emailConsent: false })

    expect(mockSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          data: expect.objectContaining({ email_consent: false }),
        },
      }),
    )
  })

  it('returns friendly error when email is already registered', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null },
      error: { message: 'User already registered' },
    })

    const result = await signUp({
      ...validInput,
      email: 'existing@example.com',
    })

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toContain('already a member')
      expect(result.error).toContain('sign in instead')
      // Must NOT expose a raw stack trace or internal error message
      expect(result.error).not.toContain('User already registered')
    }
  })

  it('returns friendly error when identities array is empty (duplicate with no confirmation)', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [] } },
      error: null,
    })

    const result = await signUp({
      ...validInput,
      email: 'existing@example.com',
    })

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toContain('already a member')
    }
  })

  it('saves referral source when provided', async () => {
    const chain = mockSupabaseChain({ data: null, error: null })
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ id: '1' }] } },
      error: null,
    })

    await signUp({ ...validInput, referralSource: 'Instagram' })

    expect(mockFrom).toHaveBeenCalledWith('profiles')
    expect(chain.update).toHaveBeenCalledWith({ referral_source: 'Instagram' })
  })
})

describe('signIn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error for invalid email format', async () => {
    const result = await signIn({
      email: 'not-valid',
      password: 'password123',
    })
    expect(result).toHaveProperty('error')
  })

  it('returns error for empty password', async () => {
    const result = await signIn({
      email: 'test@example.com',
      password: '',
    })
    expect(result).toHaveProperty('error')
  })

  it('returns success with default redirect for valid credentials', async () => {
    // signIn now checks profile.role to determine redirect destination
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    mockSupabaseChain({ data: { role: 'member' } }) // profiles role check

    const result = await signIn({
      email: 'test@example.com',
      password: 'password123',
    })

    expect(result).toEqual({ success: true, redirectTo: '/events' })
  })

  it('redirects admin user to /admin on sign in', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: 'admin-1' } },
      error: null,
    })
    mockSupabaseChain({ data: { role: 'admin' } })

    const result = await signIn({
      email: 'mitesh50@hotmail.com',
      password: 'password123',
    })

    expect(result).toEqual({ success: true, redirectTo: '/admin' })
  })

  it('preserves redirect URL when provided (skips admin check)', async () => {
    // When redirectTo is explicitly provided, no profile lookup is done
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const result = await signIn({
      email: 'test@example.com',
      password: 'password123',
      redirectTo: '/events/wine-and-wisdom',
    })

    expect(result).toEqual({
      success: true,
      redirectTo: '/events/wine-and-wisdom',
    })
  })

  it('returns "Invalid email or password" for wrong credentials', async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: 'Invalid login credentials' },
    })

    const result = await signIn({
      email: 'test@example.com',
      password: 'wrongpassword',
    })

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toBe('Invalid email or password')
      // Must NOT expose the raw Supabase error
      expect(result.error).not.toContain('Invalid login credentials')
    }
  })
})

describe('saveInterests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when interests array is empty', async () => {
    const result = await saveInterests({ interests: [] })
    expect(result).toHaveProperty('error')
  })

  it('returns error when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Not authenticated' },
    })

    const result = await saveInterests({ interests: ['Wine & Cocktails'] })

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toContain('signed in')
    }
  })

  it('saves interests for authenticated user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const chain = mockSupabaseChain({ data: null, error: null })

    const result = await saveInterests({
      interests: ['Wine & Cocktails', 'Fine Dining'],
    })

    expect(result).toEqual({ success: true })
    expect(mockFrom).toHaveBeenCalledWith('user_interests')
    expect(chain.insert).toHaveBeenCalledWith([
      { user_id: 'user-1', interest: 'Wine & Cocktails' },
      { user_id: 'user-1', interest: 'Fine Dining' },
    ])
  })

  it('deletes existing interests before inserting new ones', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const chain = mockSupabaseChain({ data: null, error: null })

    await saveInterests({ interests: ['Technology'] })

    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})

describe('completeOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Not authenticated' },
    })

    const result = await completeOnboarding()

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toContain('signed in')
    }
  })

  it('sets onboarding_complete to true for authenticated user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const chain = mockSupabaseChain({ data: null, error: null })

    const result = await completeOnboarding()

    expect(result).toEqual({ success: true })
    expect(mockFrom).toHaveBeenCalledWith('profiles')
    expect(chain.update).toHaveBeenCalledWith({ onboarding_complete: true })
    expect(chain.eq).toHaveBeenCalledWith('id', 'user-1')
  })
})
