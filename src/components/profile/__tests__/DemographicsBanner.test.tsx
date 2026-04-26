// @vitest-environment jsdom
//
// W5 — DemographicsBanner: optional gender + age_range form on the profile.
// Saves go through the `updateMyDemographics` Server Action which wraps
// the SECURITY DEFINER `set_my_demographics()` RPC. These tests cover the
// client-side interaction (chip toggling, dismiss, save) and verify the
// correct payload is sent to the action — they do NOT exercise the RPC,
// which has its own DB-integration test slot in W4.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockUpdateMyDemographics = vi.fn()
vi.mock('@/app/(member)/profile/actions', () => ({
  updateMyDemographics: (...args: unknown[]) => mockUpdateMyDemographics(...args),
}))

import { DemographicsBanner } from '../DemographicsBanner'

beforeEach(() => {
  mockUpdateMyDemographics.mockReset()
})

describe('DemographicsBanner', () => {
  it('renders the prompt collapsed (no form) by default', () => {
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    expect(screen.getByText(/help us keep events balanced/i)).toBeTruthy()
    // Form is hidden until the user opens it.
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText(/add details/i)).toBeTruthy()
  })

  it('reveals the gender + age fieldsets when the trigger is clicked', () => {
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    // Two fieldsets — one per question.
    const radiogroups = screen.getAllByRole('radiogroup')
    expect(radiogroups.length).toBe(2)
  })

  it('disables Save until at least one of (gender, age_range) is selected', () => {
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    // Pick a gender — Save unlocks.
    fireEvent.click(screen.getByText('Female'))
    expect(save.disabled).toBe(false)
  })

  it('passes the selected values to updateMyDemographics on Save', async () => {
    mockUpdateMyDemographics.mockResolvedValue({ success: true })
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    fireEvent.click(screen.getByText('Non-binary'))
    fireEvent.click(screen.getByText('30–34'))

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockUpdateMyDemographics).toHaveBeenCalledWith({
        gender: 'non_binary',
        age_range: '30-34',
      })
    })
  })

  it('hides the banner after a successful save (optimistic dismiss)', async () => {
    mockUpdateMyDemographics.mockResolvedValue({ success: true })
    const { container } = render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    fireEvent.click(screen.getByText('Female'))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      // The banner unmounts itself on success — container becomes empty.
      expect(container.firstChild).toBeNull()
    })
  })

  it('surfaces an inline error when the action fails (banner stays visible)', async () => {
    mockUpdateMyDemographics.mockResolvedValue({
      success: false,
      error: 'Failed to save demographics',
    })
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    fireEvent.click(screen.getByText('Female'))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(
        /failed to save demographics/i,
      )
    })
    // Banner is still visible — the user can retry.
    expect(screen.getByText(/help us keep events balanced/i)).toBeTruthy()
  })

  it('"Not now" dismisses the banner without calling the action', () => {
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    fireEvent.click(screen.getByText(/not now/i))
    expect(mockUpdateMyDemographics).not.toHaveBeenCalled()
    // And the banner is gone.
    expect(screen.queryByText(/help us keep events balanced/i)).toBeNull()
  })

  it('the X dismiss button is at least 44px (mobile touch target)', () => {
    const { container } = render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    const dismiss = container.querySelector(
      'button[aria-label="Dismiss banner"]',
    ) as HTMLButtonElement
    expect(dismiss).toBeTruthy()
    expect(dismiss.className).toMatch(/h-11/)
    expect(dismiss.className).toMatch(/w-11/)
  })

  it('all chip rows + Save/Cancel buttons are at least 44px tall', () => {
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))

    // Chip labels carry min-h-[44px]
    const labels = document.querySelectorAll('label')
    for (const l of labels) {
      expect(l.className).toMatch(/min-h-\[44px\]/)
    }

    // Save + Cancel buttons same.
    const save = screen.getByRole('button', { name: /save/i })
    const notNow = screen.getByRole('button', { name: /not now/i })
    expect(save.className).toMatch(/min-h-\[44px\]/)
    expect(notNow.className).toMatch(/min-h-\[44px\]/)
  })

  it('pre-fills with initial values when the user has already set demographics', () => {
    render(
      <DemographicsBanner initialGender="male" initialAgeRange="35-39" />,
    )
    fireEvent.click(screen.getByText(/add details/i))

    // The corresponding chip's hidden radio is checked.
    const maleRadio = document.querySelector(
      'input[type="radio"][name="gender"][value="male"]',
    ) as HTMLInputElement
    expect(maleRadio.checked).toBe(true)

    const ageRadio = document.querySelector(
      'input[type="radio"][name="age_range"][value="35-39"]',
    ) as HTMLInputElement
    expect(ageRadio.checked).toBe(true)
  })
})
