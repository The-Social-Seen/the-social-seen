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
// Programmable per-test search-params lookup. The form reads
// `redirect` (post-auth target) and `step` (deep-link to step N).
// Tests that don't care leave these null; the redirect-preservation
// + Welcome-CTA tests below set them per case.
const mockSearchParams: Record<string, string | null> = {
  redirect: null,
  step: null,
}
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams[key] ?? null,
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
import type { Tag } from '@/types'

// ── Fixtures ───────────────────────────────────────────────────────────────

/**
 * Representative slice of the 15 primary-eligible tags. Picked deliberately
 * to be small (assertions don't need to enumerate the full taxonomy) and
 * to span sort_order so the prop-driven tests still see a meaningful set
 * to click through. Keep this in step with the 15-tag list in
 * supabase/migrations/20260504000001_create_tags_and_event_tags.sql.
 */
const MOCK_INTEREST_TAGS: Tag[] = [
  {
    id: 'tag-uuid-drinks-bars',
    slug: 'drinks-bars',
    label: 'Drinks & Bars',
    parent_id: null,
    sort_order: 10,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    id: 'tag-uuid-theatre-comedy',
    slug: 'theatre-comedy',
    label: 'Theatre & Comedy',
    parent_id: null,
    sort_order: 60,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    id: 'tag-uuid-sport-fitness',
    slug: 'sport-fitness',
    label: 'Sport & Fitness',
    parent_id: null,
    sort_order: 90,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    id: 'tag-uuid-wellness-mindfulness',
    slug: 'wellness-mindfulness',
    label: 'Wellness & Mindfulness',
    parent_id: null,
    sort_order: 140,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
]

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
    mockSearchParams.redirect = null
    mockSearchParams.step = null
  })

  it('renders "Create Your Account" heading', () => {
    render(<JoinForm interestTags={[]} />)
    expect(screen.getByRole('heading', { name: /create your account/i })).toBeTruthy()
  })

  it('renders all required form fields', () => {
    render(<JoinForm interestTags={[]} />)
    expect(screen.getByLabelText(/full name/i)).toBeTruthy()
    expect(screen.getByLabelText(/email address/i)).toBeTruthy()
    expect(screen.getByLabelText(/^password$/i)).toBeTruthy()
    expect(screen.getByLabelText(/phone number/i)).toBeTruthy()
  })

  it('renders phone number field with helper text', () => {
    render(<JoinForm interestTags={[]} />)
    expect(screen.getByLabelText(/phone number/i)).toBeTruthy()
    expect(screen.getByText(/for event reminders & venue details/i)).toBeTruthy()
  })

  it('caps phone input at maxLength=24 (paste-attack defence)', () => {
    render(<JoinForm interestTags={[]} />)
    const phone = screen.getByLabelText(/phone number/i) as HTMLInputElement
    expect(phone.getAttribute('maxLength')).toBe('24')
  })

  it('renders email consent checkbox unchecked by default (GDPR)', () => {
    render(<JoinForm interestTags={[]} />)
    const checkbox = screen.getByRole('checkbox', {
      name: /keep me updated with new events/i,
    })
    expect(checkbox).toBeTruthy()
    // Radix checkbox exposes checked state via aria-checked
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
  })

  it('toggles email consent checkbox when clicked', () => {
    render(<JoinForm interestTags={[]} />)
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
    render(<JoinForm interestTags={[]} />)
    expect(screen.getByLabelText(/how did you hear/i)).toBeTruthy()
  })

  it('renders step indicator with Account, Interests, Welcome labels', () => {
    render(<JoinForm interestTags={[]} />)
    expect(screen.getByText('Account')).toBeTruthy()
    expect(screen.getByText('Interests')).toBeTruthy()
    expect(screen.getByText('Welcome')).toBeTruthy()
  })

  it('renders disabled Google OAuth button', () => {
    render(<JoinForm interestTags={[]} />)
    const googleBtn = screen.getByRole('button', { name: /continue with google/i })
    expect(googleBtn).toBeTruthy()
    expect(googleBtn.hasAttribute('disabled')).toBe(true)
  })

  it('renders "Coming soon" tooltip for Google button', () => {
    render(<JoinForm interestTags={[]} />)
    expect(screen.getByText('Coming soon')).toBeTruthy()
  })

  it('renders "Already a member? Sign In" link', () => {
    render(<JoinForm interestTags={[]} />)
    const signInLink = screen.getByRole('link', { name: /sign in/i })
    expect(signInLink.getAttribute('href')).toBe('/login')
  })

  // INVARIANT: Cross-link (join → login) must preserve the
  // post-auth redirect so a user who arrived via
  // /login?redirect=…?book=1 → "Join now" → "Sign In" round-trips
  // back to the original destination without losing it.
  it('forwards URL-encoded ?redirect to the "Sign In" header link when present', () => {
    mockSearchParams.redirect = '/events/foo?book=1'
    render(<JoinForm interestTags={[]} />)
    const signInLink = screen.getByRole('link', { name: /sign in/i })
    expect(signInLink.getAttribute('href')).toBe(
      '/login?redirect=%2Fevents%2Ffoo%3Fbook%3D1',
    )
  })

  // Amendment 4.4 validation messages
  it('shows "Please enter your first and last name" when name is empty', async () => {
    // Client-side check now runs the same two-word test as the server
    // (name.trim().split(/\s+/).filter(Boolean).length < 2), which also
    // catches the empty-string case — the old empty-only copy is retired.
    render(<JoinForm interestTags={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByText('Please enter your first and last name')).toBeTruthy()
    })
  })

  // ── Two-word full name requirement (client-side) ─────────────────────────
  describe('full name — two-word requirement', () => {
    it('shows "Please enter your first and last name" for a single-word name', async () => {
      render(<JoinForm interestTags={[]} />)
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Charlotte' } })
      fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'test@test.com' } })
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } })
      fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: '07123456789' } })
      fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

      await waitFor(() => {
        expect(screen.getByText('Please enter your first and last name')).toBeTruthy()
      })
      expect(mockSignUp).not.toHaveBeenCalled()
    })

    it('does not block submission on a two-word name', async () => {
      mockSignUp.mockResolvedValue({ success: true })

      render(<JoinForm interestTags={[]} />)
      fillStep1Valid({ name: 'Charlotte Moreau' })
      fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith(
          expect.objectContaining({ fullName: 'Charlotte Moreau' }),
        )
      })
      expect(screen.queryByText('Please enter your first and last name')).toBeNull()
    })

    it('clears the name error and advances once a second word is added and resubmitted', async () => {
      mockSignUp.mockResolvedValue({ success: true })

      render(<JoinForm interestTags={[]} />)
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Charlotte' } })
      fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'test@test.com' } })
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'password123' } })
      fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: '07123456789' } })
      fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

      await waitFor(() => {
        expect(screen.getByText('Please enter your first and last name')).toBeTruthy()
      })

      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Charlotte Moreau' } })
      fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /what interests you/i })).toBeTruthy()
      })
      expect(screen.queryByText('Please enter your first and last name')).toBeNull()
    })
  })

  it('shows "Enter your email to create your account" when email is empty', async () => {
    render(<JoinForm interestTags={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByText('Enter your email to create your account')).toBeTruthy()
    })
  })

  it('shows "Choose a password (at least 8 characters)" when password is too short', async () => {
    render(<JoinForm interestTags={[]} />)
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

    render(<JoinForm interestTags={[]} />)
    fillStep1Valid({ email: 'existing@test.com', name: 'Test User' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByText(/already a member/i)).toBeTruthy()
    })
  })

  it('advances to Step 2 on successful signup', async () => {
    mockSignUp.mockResolvedValue({ success: true })

    render(<JoinForm interestTags={[]} />)
    fillStep1Valid()
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /what interests you/i })).toBeTruthy()
    })
  })

  // ── Phone number validation ──────────────────────────────────────────────
  it('shows "Enter a valid phone number" when phone is empty', async () => {
    render(<JoinForm interestTags={[]} />)
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
    render(<JoinForm interestTags={[]} />)
    fillStep1Valid({ phoneNumber: 'abc' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByText('Enter a valid phone number')).toBeTruthy()
    })
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('shows "Enter a valid phone number" when phone is too short', async () => {
    render(<JoinForm interestTags={[]} />)
    fillStep1Valid({ phoneNumber: '12345' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByText('Enter a valid phone number')).toBeTruthy()
    })
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('accepts UK phone with whitespace and strips it before submit', async () => {
    mockSignUp.mockResolvedValue({ success: true })

    render(<JoinForm interestTags={[]} />)
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

    render(<JoinForm interestTags={[]} />)
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

    render(<JoinForm interestTags={[]} />)
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

    render(<JoinForm interestTags={[]} />)
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
    mockSearchParams.redirect = null
    mockSearchParams.step = null
    mockSignUp.mockResolvedValue({ success: true })
  })

  async function advanceToStep2(interestTags: Tag[] = MOCK_INTEREST_TAGS) {
    render(<JoinForm interestTags={interestTags} />)
    fillStep1Valid({ name: 'Test User', email: 'test@test.com' })
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /what interests you/i })).toBeTruthy()
    })
  }

  it('renders a chip for each tag passed via the interestTags prop', async () => {
    await advanceToStep2()
    // Sample 3 of the 4 fixture labels — the assertion is "an interest
    // chip exists for each prop entry", not "the full canonical list".
    expect(screen.getByRole('button', { name: 'Drinks & Bars' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Theatre & Comedy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Wellness & Mindfulness' })).toBeTruthy()
  })

  it('renders ONLY the labels in interestTags (does not fall back to a hardcoded list)', async () => {
    // Pin the prop-driven contract: a future contributor reverting the
    // chip grid to a hardcoded INTEREST_OPTIONS-style array would fail
    // this test because the fake label can't be sourced from anywhere
    // else.
    const fakeTag: Tag = {
      id: 'tag-uuid-fake',
      slug: 'fake-tag-for-test',
      label: 'Fake Tag For Test',
      parent_id: null,
      sort_order: 999,
      is_active: true,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T00:00:00Z',
    }
    await advanceToStep2([fakeTag])

    expect(screen.getByRole('button', { name: 'Fake Tag For Test' })).toBeTruthy()
    // Old hardcoded labels should not appear unless the prop carried them.
    expect(screen.queryByRole('button', { name: 'Wine & Cocktails' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Drinks & Bars' })).toBeNull()
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
    const tag = screen.getByRole('button', { name: 'Drinks & Bars' })

    // First click selects
    fireEvent.click(tag)
    // Verify visual change via class (gold bg when selected)
    expect(tag.className).toContain('bg-gold')

    // Second click deselects
    fireEvent.click(tag)
    expect(tag.className).not.toContain('bg-gold text-white')
  })

  it('advances to Step 3 on successful interest save and persists by slug', async () => {
    mockSaveInterests.mockResolvedValue({ success: true })

    await advanceToStep2()
    fireEvent.click(screen.getByRole('button', { name: 'Drinks & Bars' }))
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /you're in/i })).toBeTruthy()
    })

    // saveInterests must receive canonical slugs from the prop, not
    // labels — backend validation rejects label-shaped strings via the
    // slug regex.
    expect(mockSaveInterests).toHaveBeenCalledWith({
      interestSlugs: ['drinks-bars'],
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
    mockSearchParams.redirect = null
    mockSearchParams.step = null
    mockSignUp.mockResolvedValue({ success: true })
    mockSaveInterests.mockResolvedValue({ success: true })
    mockCompleteOnboarding.mockResolvedValue({ success: true })
  })

  async function advanceToStep3() {
    render(<JoinForm interestTags={MOCK_INTEREST_TAGS} />)
    // Step 1
    fillStep1Valid()
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /what interests you/i })).toBeTruthy()
    })
    // Step 2
    fireEvent.click(screen.getByRole('button', { name: 'Drinks & Bars' }))
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

  // INVARIANT: After completing onboarding, the primary CTA must
  // resume the original booking flow when ?redirect= was passed.
  // The path is sanitised via sanitizeRedirectPath (off-site URLs
  // fall back to /events) so this is safe to feed straight into href.
  it('uses sanitised ?redirect= for the "See What\'s On" CTA when present', async () => {
    mockSearchParams.redirect = '/events/wine-evening?book=1'
    await advanceToStep3()
    const eventsLink = screen.getByRole('link', { name: /see what's on/i })
    // The raw (sanitised) path is dropped straight into href —
    // we don't double-encode it here because the consumer is the
    // browser's address bar, not a query param.
    expect(eventsLink.getAttribute('href')).toBe(
      '/events/wine-evening?book=1',
    )
  })

  it('uses a path-only ?redirect= (no `?book=1`) verbatim for the "See What\'s On" CTA', async () => {
    mockSearchParams.redirect = '/events/wine-evening'
    await advanceToStep3()
    const eventsLink = screen.getByRole('link', { name: /see what's on/i })
    expect(eventsLink.getAttribute('href')).toBe('/events/wine-evening')
  })

  // INVARIANT: The secondary "Complete Your Profile" CTA is a
  // post-onboarding nudge, NOT the user's original intent — it must
  // ignore ?redirect= and always point at /profile.
  it('keeps the "Complete Your Profile" CTA pointing at /profile even when ?redirect is set', async () => {
    mockSearchParams.redirect = '/events/wine-evening?book=1'
    await advanceToStep3()
    const profileLink = screen.getByRole('link', { name: /complete your profile/i })
    expect(profileLink.getAttribute('href')).toBe('/profile')
  })

  // Defence: an off-site redirect param must fall back to /events.
  // sanitizeRedirectPath already enforces this; this test pins the
  // wiring so a future refactor that bypasses the helper is caught.
  it('falls back to /events when ?redirect= is off-site (sanitised)', async () => {
    mockSearchParams.redirect = 'https://evil.com/phish'
    await advanceToStep3()
    const eventsLink = screen.getByRole('link', { name: /see what's on/i })
    expect(eventsLink.getAttribute('href')).toBe('/events')
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
    render(<JoinForm interestTags={[]} />)
    expect(screen.queryByLabelText(/job title/i)).toBeNull()
    expect(screen.queryByLabelText(/company/i)).toBeNull()
    expect(screen.queryByLabelText(/industry/i)).toBeNull()
    expect(screen.queryByLabelText(/linkedin/i)).toBeNull()
    expect(screen.queryByLabelText(/bio/i)).toBeNull()
    expect(screen.queryByLabelText(/photo/i)).toBeNull()
  })
})
