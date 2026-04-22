import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockSignUp = vi.fn()
const mockSignInWithPassword = vi.fn()
const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockSignInWithOtp = vi.fn()
const mockVerifyOtp = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signUp: mockSignUp,
        signInWithPassword: mockSignInWithPassword,
        getUser: mockGetUser,
        signInWithOtp: mockSignInWithOtp,
        verifyOtp: mockVerifyOtp,
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

// Mock the email send wrapper — completeOnboarding fires a welcome email
// via dynamic import. Intercept here so tests don't try the real Resend
// call (which would fail without RESEND_API_KEY set).
const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

import {
  signUp,
  signIn,
  saveInterests,
  completeOnboarding,
  sendVerificationOtp,
  verifyEmailOtp,
} from '../actions'

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
    smsConsent: false,
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
          sms_consent: false,
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
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg' })

    const result = await completeOnboarding()

    expect(result).toEqual({ success: true })
    expect(mockFrom).toHaveBeenCalledWith('profiles')
    expect(chain.update).toHaveBeenCalledWith({ onboarding_complete: true })
    expect(chain.eq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('fires the welcome email after onboarding completes', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'charlotte@example.com',
          user_metadata: { full_name: 'Charlotte Moreau' },
        },
      },
      error: null,
    })

    // The chain helper returns the same response for every from() call.
    // Both the `update` (onboarding) and the subsequent `select` (profile
    // lookup for the email) hit the same mock — return profile data so
    // the welcome email path proceeds.
    mockSupabaseChain({
      data: {
        full_name: 'Charlotte Moreau',
        email: 'charlotte@example.com',
      },
      error: null,
    })
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg_1' })

    await completeOnboarding()

    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'charlotte@example.com',
        templateName: 'welcome',
        relatedProfileId: 'user-1',
      }),
    )
  })

  it('still returns success when the welcome email fails', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: { id: 'user-1', email: 'charlotte@example.com' },
      },
      error: null,
    })

    mockSupabaseChain({
      data: { full_name: 'Charlotte Moreau', email: 'charlotte@example.com' },
      error: null,
    })
    mockSendEmail.mockResolvedValue({
      success: false,
      error: 'Resend down',
    })

    const result = await completeOnboarding()

    // Email failure must NOT roll back onboarding — user gets a clean success.
    expect(result).toEqual({ success: true })
  })
})

describe('sendVerificationOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Not authenticated' },
    })

    const result = await sendVerificationOtp()

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toContain('signed in')
      expect(result.code).toBe('unauthenticated')
    }
    expect(mockSignInWithOtp).not.toHaveBeenCalled()
  })

  it('short-circuits with alreadyVerified flag when profile.email_verified is true', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'charlotte@example.com' } },
      error: null,
    })
    // Profile lookup returns email_verified: true
    mockSupabaseChain({ data: { email_verified: true }, error: null })

    const result = await sendVerificationOtp()

    // Caller (verify-form) keys off alreadyVerified to skip the code-entry screen.
    expect(result).toEqual({ success: true, alreadyVerified: true })
    // Should NOT trigger another OTP email for an already-verified user
    expect(mockSignInWithOtp).not.toHaveBeenCalled()
  })

  it('calls signInWithOtp with shouldCreateUser: false when profile is unverified', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'charlotte@example.com' } },
      error: null,
    })
    mockSupabaseChain({ data: { email_verified: false }, error: null })
    mockSignInWithOtp.mockResolvedValue({ error: null })

    const result = await sendVerificationOtp()

    expect(result).toEqual({ success: true })
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'charlotte@example.com',
      options: { shouldCreateUser: false },
    })
  })

  it('surfaces friendly rate-limit message when Supabase returns rate-limit error', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'charlotte@example.com' } },
      error: null,
    })
    mockSupabaseChain({ data: { email_verified: false }, error: null })
    mockSignInWithOtp.mockResolvedValue({
      error: { message: 'Email rate limit exceeded' },
    })

    const result = await sendVerificationOtp()

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error.toLowerCase()).toContain('wait')
      expect(result.code).toBe('rate_limited')
      // Must NOT leak raw Supabase message
      expect(result.error).not.toContain('Email rate limit exceeded')
    }
  })

  it('returns generic error when Supabase returns non-rate-limit error', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'charlotte@example.com' } },
      error: null,
    })
    mockSupabaseChain({ data: { email_verified: false }, error: null })
    mockSignInWithOtp.mockResolvedValue({
      error: { message: 'Some internal failure' },
    })

    const result = await sendVerificationOtp()

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).not.toContain('Some internal failure')
      expect(result.code).toBe('send_failed')
    }
  })
})

describe('verifyEmailOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when code is too short', async () => {
    const result = await verifyEmailOtp({ code: '12345' })
    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toContain('6-digit')
      expect(result.code).toBe('validation_error')
    }
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('returns error when code contains letters', async () => {
    const result = await verifyEmailOtp({ code: 'abcdef' })
    expect(result).toHaveProperty('error')
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('returns error when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Not authenticated' },
    })

    const result = await verifyEmailOtp({ code: '123456' })

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toContain('signed in')
      expect(result.code).toBe('unauthenticated')
    }
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('calls verifyOtp with type "email" and the 6-digit token', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'charlotte@example.com' } },
      error: null,
    })
    mockVerifyOtp.mockResolvedValue({ error: null })
    mockSupabaseChain({ data: null, error: null })

    const result = await verifyEmailOtp({ code: '123456' })

    expect(result).toEqual({ success: true })
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: 'charlotte@example.com',
      token: '123456',
      type: 'email',
    })
  })

  it('sets email_verified = true on the profile on success', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'charlotte@example.com' } },
      error: null,
    })
    mockVerifyOtp.mockResolvedValue({ error: null })
    const chain = mockSupabaseChain({ data: null, error: null })

    await verifyEmailOtp({ code: '123456' })

    expect(mockFrom).toHaveBeenCalledWith('profiles')
    expect(chain.update).toHaveBeenCalledWith({ email_verified: true })
    expect(chain.eq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('returns friendly "invalid or expired" message when verifyOtp fails', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'charlotte@example.com' } },
      error: null,
    })
    mockVerifyOtp.mockResolvedValue({
      error: { message: 'Token has expired or is invalid' },
    })

    const result = await verifyEmailOtp({ code: '999999' })

    expect(result).toHaveProperty('error')
    if ('error' in result) {
      expect(result.error).toContain('invalid or has expired')
      expect(result.code).toBe('invalid_otp')
      // Must NOT leak the raw Supabase message
      expect(result.error).not.toContain('Token has expired or is invalid')
    }
  })
})
