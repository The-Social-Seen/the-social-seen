// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ── Mocks ──────────────────────────────────────────────────────────────────

// Filter framer-motion props from DOM elements
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
    h1: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <h1 {...filterDomProps(props)}>{children}</h1>
    ),
    h2: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <h2 {...filterDomProps(props)}>{children}</h2>
    ),
    p: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <p {...filterDomProps(props)}>{children}</p>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}))

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: vi.fn().mockReturnValue(null),
  }),
}))

const mockSignUp = vi.fn()
const mockSaveInterests = vi.fn()
const mockCompleteOnboarding = vi.fn()

vi.mock('../actions', () => ({
  signUp: (...args: unknown[]) => mockSignUp(...args),
  saveInterests: (...args: unknown[]) => mockSaveInterests(...args),
  completeOnboarding: (...args: unknown[]) => mockCompleteOnboarding(...args),
}))

import { JoinForm } from '../join/join-form'

// ── Helpers ────────────────────────────────────────────────────────────────

// Fills all required Step 1 fields with valid values. Returns the DOM nodes
// so individual tests can override values or assert further state.
function fillStep1Valid({
  name = 'Charlotte Moreau',
  email = 'charlotte@test.com',
  password = 'password123',
  phoneNumber = '07123 456789',
}: {
  name?: string
  email?: string
  password?: string
  phoneNumber?: string
} = {}) {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: name } })
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: password } })
  fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: phoneNumber } })
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('JoinForm — Step 1 (Account)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders "Create Your Account" heading', () => {
    render(<JoinForm />)
    expect(screen.getByRole('heading', { name: /create your account/i })).toBeTruthy()
  })

  it('renders all required form fields', () => {
    render(<JoinForm />)
    expect(screen.getByLabelText(/full name/i)).toBeTruthy()
    expect(screen.getByLabelText(/email address/i)).toBeTruthy()
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy()
    expect(screen.getByLabelText(/phone number/i)).toBeTruthy()
  })

  it('renders phone number field with helper text', () => {
    render(<JoinForm />)
    expect(screen.getByLabelText(/phone number/i)).toBeTruthy()
    expect(screen.getByText(/for event reminders & venue details/i)).toBeTruthy()
  })

  it('caps phone input at maxLength=24 (paste-attack defence)', () => {
    render(<JoinForm />)
    const phone = screen.getByLabelText(/phone number/i) as HTMLInputElement
    expect(phone.getAttribute('maxLength')).toBe('24')
  })

  it('renders email consent checkbox unchecked by default (GDPR)', () => {
    render(<JoinForm />)
    const checkbox = screen.getByRole('checkbox', {
      name: /keep me updated with new events/i,
    })
    expect(checkbox).toBeTruthy()
    // Radix checkbox exposes checked state via aria-checked
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
  })

  it('toggles email consent checkbox when clicked', () => {
    render(<JoinForm />)
    const checkbox = screen.getByRole('checkbox', {
      name: /keep me updated/i,
    })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(checkbox)
    expect(checkbox.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(checkbox)
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
  })

  it('renders the "How did you hear about us?" optional dropdown', () => {
    render(<JoinForm />)
    expect(screen.getByLabelText(/how did you hear/i)).toBeTruthy()
  })

  it('renders step indicator with Account, Interests, Welcome labels', () => {
    render(<JoinForm />)
    expect(screen.getByText('Account')).toBeTruthy()
    expect(screen.getByText('Interests')).toBeTruthy()
    expect(screen.getByText('Welcome')).toBeTruthy()
  })

  it('renders disabled Google OAuth button', () => {
    render(<JoinForm />)
    const googleBtn = screen.getByRole('button', { name: /continue with google/i })
    expect(googleBtn).toBeTruthy()
    expect(googleBtn.hasAttribute('disabled')).toBe(true)
  })

  it('renders "Coming soon" tooltip for Google button', () => {
    render(<JoinForm />)
    expect(screen.getByText('Coming soon')).toBeTruthy()
  })

  it('renders "Already a member? Sign In" link', () => {
    render(<JoinForm />)
    const signInLink = screen.getByRole('link', { name: /sign in/i })
    expect(signInLink.getAttribute('href')).toBe('/login')
  })

  // Amendment 4.4 validation messages
  it('shows "We\'ll need your name to get started" when name is empty', async () => {
    render(<JoinForm />)
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByText("We'll need your name to get started")).toBeTruthy()
    })
  })

  it('shows "Enter your email to create your account" when email is empty', async () => {
    render(<JoinForm />)
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByText('Enter your email to create your account')).toBeTruthy()
    })
  })

  it('shows "Choose a password (at least 8 characters)" when password is too short', async () => {
    render(<JoinForm />)
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Test' } })
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'test@test.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByText('Choose a password (at least 8 characters)')).toBeTruthy()
    })
  })

  it('shows "already a member" error when email exists', async () => {
    mockSignUp.mockResolvedValue({
      error: "Looks like you're already a member — sign in instead?",
    })

    render(<JoinForm />)
    fillStep1Valid({ email: 'existing@test.com', name: 'Test User' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByText(/already a member/i)).toBeTruthy()
    })
  })

  it('advances to Step 2 on successful signup', async () => {
    mockSignUp.mockResolvedValue({ success: true })

    render(<JoinForm />)
    fillStep1Valid()
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /what interests you/i })).toBeTruthy()
    })
  })

  // ── Phone number validation ──────────────────────────────────────────────
  it('shows "Enter a valid phone number" when phone is empty', async () => {
    render(<JoinForm />)
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Test User' } })
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'test@test.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } })
    // Phone left blank
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByText('Enter a valid phone number')).toBeTruthy()
    })
  })

  it('shows "Enter a valid phone number" when phone contains letters', async () => {
    render(<JoinForm />)
    fillStep1Valid({ phoneNumber: 'abc' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByText('Enter a valid phone number')).toBeTruthy()
    })
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('shows "Enter a valid phone number" when phone is too short', async () => {
    render(<JoinForm />)
    fillStep1Valid({ phoneNumber: '12345' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByText('Enter a valid phone number')).toBeTruthy()
    })
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('accepts UK phone with whitespace and strips it before submit', async () => {
    mockSignUp.mockResolvedValue({ success: true })

    render(<JoinForm />)
    fillStep1Valid({ phoneNumber: '07123 456 789' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumber: '07123456789' }),
      )
    })
  })

  it('accepts +44 international format', async () => {
    mockSignUp.mockResolvedValue({ success: true })

    render(<JoinForm />)
    fillStep1Valid({ phoneNumber: '+44 7123 456789' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumber: '+447123456789' }),
      )
    })
  })

  // ── Email consent passthrough ────────────────────────────────────────────
  it('passes emailConsent: false to signUp when checkbox left unchecked', async () => {
    mockSignUp.mockResolvedValue({ success: true })

    render(<JoinForm />)
    fillStep1Valid()
    // Do NOT click the checkbox
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({ emailConsent: false }),
      )
    })
  })

  it('passes emailConsent: true to signUp when checkbox is checked', async () => {
    mockSignUp.mockResolvedValue({ success: true })

    render(<JoinForm />)
    fillStep1Valid()
    fireEvent.click(
      screen.getByRole('checkbox', { name: /keep me updated/i }),
    )
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({ emailConsent: true }),
      )
    })
  })
})

describe('JoinForm — Step 2 (Interests)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignUp.mockResolvedValue({ success: true })
  })

  async function advanceToStep2() {
    render(<JoinForm />)
    fillStep1Valid({ name: 'Test User', email: 'test@test.com' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /what interests you/i })).toBeTruthy()
    })
  }

  it('renders interest tags from INTEREST_OPTIONS', async () => {
    await advanceToStep2()
    expect(screen.getByRole('button', { name: 'Wine & Cocktails' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fine Dining' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Art & Culture' })).toBeTruthy()
  })

  it('shows error when continuing without selecting any interest', async () => {
    await advanceToStep2()
    // Click Continue without selecting any interest
    const continueBtn = screen.getByRole('button', { name: /^continue$/i })
    fireEvent.click(continueBtn)

    await waitFor(() => {
      expect(screen.getByText(/pick at least one/i)).toBeTruthy()
    })
  })

  it('shows correct error copy per Amendment 4.4', async () => {
    await advanceToStep2()
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(
        screen.getByText("Pick at least one — we'll use this to show you events you'll love")
      ).toBeTruthy()
    })
  })

  it('toggles interest selection on click', async () => {
    await advanceToStep2()
    const tag = screen.getByRole('button', { name: 'Wine & Cocktails' })

    // First click selects
    fireEvent.click(tag)
    // Verify visual change via class (gold bg when selected)
    expect(tag.className).toContain('bg-gold')

    // Second click deselects
    fireEvent.click(tag)
    expect(tag.className).not.toContain('bg-gold text-white')
  })

  it('advances to Step 3 on successful interest save', async () => {
    mockSaveInterests.mockResolvedValue({ success: true })

    await advanceToStep2()
    fireEvent.click(screen.getByRole('button', { name: 'Wine & Cocktails' }))
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /you're in/i })).toBeTruthy()
    })
  })

  it('has a Back button that returns to Step 1', async () => {
    await advanceToStep2()
    fireEvent.click(screen.getByRole('button', { name: /back/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeTruthy()
    })
  })
})

describe('JoinForm — Step 3 (Welcome)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignUp.mockResolvedValue({ success: true })
    mockSaveInterests.mockResolvedValue({ success: true })
    mockCompleteOnboarding.mockResolvedValue({ success: true })
  })

  async function advanceToStep3() {
    render(<JoinForm />)
    // Step 1
    fillStep1Valid()
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /what interests you/i })).toBeTruthy()
    })
    // Step 2
    fireEvent.click(screen.getByRole('button', { name: 'Wine & Cocktails' }))
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /you're in/i })).toBeTruthy()
    })
  }

  it('renders "You\'re In" heading', async () => {
    await advanceToStep3()
    expect(screen.getByRole('heading', { name: /you're in/i })).toBeTruthy()
  })

  it('renders welcome subtext', async () => {
    await advanceToStep3()
    expect(screen.getByText(/london's best evenings start here/i)).toBeTruthy()
  })

  it('renders user initials in avatar', async () => {
    await advanceToStep3()
    expect(screen.getByText('CM')).toBeTruthy()
  })

  it('renders "See What\'s On" CTA linking to /events', async () => {
    await advanceToStep3()
    const eventsLink = screen.getByRole('link', { name: /see what's on/i })
    expect(eventsLink.getAttribute('href')).toBe('/events')
  })

  it('renders "Complete Your Profile" CTA linking to /profile', async () => {
    await advanceToStep3()
    const profileLink = screen.getByRole('link', { name: /complete your profile/i })
    expect(profileLink.getAttribute('href')).toBe('/profile')
  })

  it('calls completeOnboarding on render', async () => {
    await advanceToStep3()
    // `completeOnboarding` fires in a mount-time `useEffect` after
    // the step 3 transition. Wrap the assertion in `waitFor` so the
    // microtask queue drains on slower CI runners — otherwise this
    // test is flaky (caught in P2-8a + P2-8b CI runs).
    await waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalled()
    })
  })
})

describe('JoinForm — Amendment 4.1 (removed fields)', () => {
  it('does NOT render job title, company, industry, LinkedIn, bio, or photo upload', () => {
    render(<JoinForm />)
    expect(screen.queryByLabelText(/job title/i)).toBeNull()
    expect(screen.queryByLabelText(/company/i)).toBeNull()
    expect(screen.queryByLabelText(/industry/i)).toBeNull()
    expect(screen.queryByLabelText(/linkedin/i)).toBeNull()
    expect(screen.queryByLabelText(/bio/i)).toBeNull()
    expect(screen.queryByLabelText(/photo/i)).toBeNull()
  })
})
