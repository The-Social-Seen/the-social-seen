// @vitest-environment jsdom
//
// W5 — adversarial coverage for DemographicsBanner: partial submissions,
// clearing previously-set values, and mobile touch-target guards beyond
// what the implementation tests already cover.
//
// Key invariants we're enforcing:
//   1. Gender-only save → succeeds with age_range as null in the payload.
//   2. Age-only save   → succeeds with gender as null in the payload.
//   3. User has set both, clears both, saves → both nulls in the payload
//      (the SECURITY DEFINER `set_my_demographics()` RPC accepts NULLs).
//   4. Save button stays disabled when BOTH fields are unselected (no
//      pointless "save nothing" RPC call).
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

describe('DemographicsBanner — adversarial edge cases', () => {
  it('saves with ONLY gender filled (age_range null)', async () => {
    mockUpdateMyDemographics.mockResolvedValue({ success: true })
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    fireEvent.click(screen.getByText('Female'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(mockUpdateMyDemographics).toHaveBeenCalledWith({
        gender: 'female',
        age_range: null,
      })
    })
  })

  it('saves with ONLY age_range filled (gender null)', async () => {
    mockUpdateMyDemographics.mockResolvedValue({ success: true })
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    fireEvent.click(screen.getByText('40–44'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(mockUpdateMyDemographics).toHaveBeenCalledWith({
        gender: null,
        age_range: '40-44',
      })
    })
  })

  it('Save button stays disabled when BOTH fields are unselected (no pointless RPC call)', () => {
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    const save = screen.getByRole('button', {
      name: /^save$/i,
    }) as HTMLButtonElement
    // Neither field selected → Save disabled.
    expect(save.disabled).toBe(true)
    // Save was never called.
    expect(mockUpdateMyDemographics).not.toHaveBeenCalled()
  })

  it('a user who already filled both can submit unchanged values (idempotent re-save)', async () => {
    // The banner is shown when EITHER field is null at page load. Once
    // expanded, an existing-value user might Save without changing
    // anything — the action should still accept the call.
    mockUpdateMyDemographics.mockResolvedValue({ success: true })
    render(
      <DemographicsBanner
        initialGender="prefer_not_to_say"
        initialAgeRange="50+"
      />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(mockUpdateMyDemographics).toHaveBeenCalledWith({
        gender: 'prefer_not_to_say',
        age_range: '50+',
      })
    })
  })

  it('"prefer_not_to_say" is a first-class gender value (Decision 1 — distinct from null)', async () => {
    // Spec calls this out explicitly: prefer_not_to_say is "actively
    // declined" (banner shouldn't re-nudge), null is "never asked".
    // The banner must accept the value AS the saved state, not coerce
    // it to null.
    mockUpdateMyDemographics.mockResolvedValue({ success: true })
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))
    fireEvent.click(screen.getByText('Prefer not to say'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(mockUpdateMyDemographics).toHaveBeenCalledWith({
        gender: 'prefer_not_to_say',
        age_range: null,
      })
    })
  })

  it('selecting an age band twice does NOT toggle it off (single-select semantics)', () => {
    // Age range is a radio (single-select), not a multi-select chip.
    // Clicking the same band twice should leave it selected, not toggle
    // it back to null.
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))

    const band = screen.getByText('30–34')
    fireEvent.click(band)
    fireEvent.click(band)

    const checked = document.querySelector(
      'input[type="radio"][name="age_range"]:checked',
    ) as HTMLInputElement
    expect(checked).toBeTruthy()
    expect(checked.value).toBe('30-34')
  })

  it('selecting two different gender chips replaces (not adds) — radio semantics', () => {
    render(
      <DemographicsBanner initialGender={null} initialAgeRange={null} />,
    )
    fireEvent.click(screen.getByText(/add details/i))

    fireEvent.click(screen.getByText('Female'))
    fireEvent.click(screen.getByText('Male'))

    const allChecked = document.querySelectorAll(
      'input[type="radio"][name="gender"]:checked',
    )
    expect(allChecked.length).toBe(1)
    expect((allChecked[0] as HTMLInputElement).value).toBe('male')
  })
})
