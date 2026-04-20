// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Profile } from '@/types'

vi.mock('lucide-react', () => ({
  X: ({ className }: { className?: string }) => <span data-testid="x-icon" className={className} />,
  UserCircle: ({ className }: { className?: string }) => <span data-testid="user-icon" className={className} />,
}))

import { ProfileCompletionBanner } from '../ProfileCompletionBanner'

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    email: 'charlotte@example.com',
    full_name: 'Charlotte Moreau',
    avatar_url: 'https://example.com/avatar.jpg',
    job_title: 'Product Designer',
    company: 'Monzo',
    industry: 'Fintech',
    bio: 'Design enthusiast',
    linkedin_url: null,
    role: 'member',
    onboarding_complete: true,
    referral_source: null,
    phone_number: null,
    email_consent: false,
    email_verified: false,
    status: 'active',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    deleted_at: null,
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ProfileCompletionBanner', () => {
  it('renders when job_title is null', () => {
    const profile = makeProfile({ job_title: null })
    render(<ProfileCompletionBanner profile={profile} onCompleteClick={() => {}} />)

    expect(screen.getByText(/Profiles with a photo get noticed more/)).toBeTruthy()
  })

  it('renders when avatar_url is null', () => {
    const profile = makeProfile({ avatar_url: null })
    render(<ProfileCompletionBanner profile={profile} onCompleteClick={() => {}} />)

    expect(screen.getByText(/Profiles with a photo get noticed more/)).toBeTruthy()
  })

  it('does not render when profile is complete (has both job_title and avatar_url)', () => {
    const profile = makeProfile() // both set
    const { container } = render(
      <ProfileCompletionBanner profile={profile} onCompleteClick={() => {}} />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('calls onCompleteClick when "Complete yours" is clicked', () => {
    const onComplete = vi.fn()
    const profile = makeProfile({ job_title: null })
    render(<ProfileCompletionBanner profile={profile} onCompleteClick={onComplete} />)

    fireEvent.click(screen.getByText(/Complete yours/))

    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('is dismissed when the X button is clicked', () => {
    const profile = makeProfile({ job_title: null })
    const { container } = render(
      <ProfileCompletionBanner profile={profile} onCompleteClick={() => {}} />,
    )

    // Banner should be visible initially
    expect(screen.getByText(/Profiles with a photo get noticed more/)).toBeTruthy()

    // Click dismiss button
    fireEvent.click(screen.getByLabelText('Dismiss banner'))

    // Banner should be gone
    expect(container.innerHTML).toBe('')
  })
})
