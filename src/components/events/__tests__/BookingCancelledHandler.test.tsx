// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * Coverage for BookingCancelledHandler — previously ZERO test coverage.
 * The load-bearing new behaviour (SYSTEM-DESIGN-admin-waitlist-promotion-
 * payment.md §5 site #2) is the query-param forwarding logic: `?from=`
 * must pass through 'admin_hold' to abandonPendingCheckout unchanged,
 * rather than collapsing it to the 'book' default the way the OLD
 * implementation collapsed everything but 'claim'.
 */

const mockAbandon = vi.fn()
vi.mock('@/app/events/[slug]/actions', () => ({
  abandonPendingCheckout: (...args: unknown[]) => mockAbandon(...args),
}))

const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams(),
}))

// Mutable per-test search-params source. useSearchParams() is called on
// every render, so tests configure this before rendering.
let currentParams = new URLSearchParams()
function mockSearchParams() {
  return currentParams
}

import BookingCancelledHandler from '../BookingCancelledHandler'

function setUrl(search: string) {
  currentParams = new URLSearchParams(search)
  // The component also reads window.location.href directly (to build the
  // stripped-query-param replace() target) — keep jsdom's location in
  // sync so that logic exercises the real path.
  window.history.replaceState({}, '', `/events/wine-tasting${search}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAbandon.mockResolvedValue({ success: true })
  setUrl('')
})

describe('BookingCancelledHandler', () => {
  it('does nothing when ?cancelled=1 is absent', async () => {
    setUrl('?from=admin_hold')
    render(<BookingCancelledHandler eventId="evt-1" />)

    // Give the effect's microtask queue a tick to prove it did NOT fire.
    await new Promise((r) => setTimeout(r, 0))
    expect(mockAbandon).not.toHaveBeenCalled()
  })

  it("no ?from param → forwards {from: 'book'} (default)", async () => {
    setUrl('?cancelled=1')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1))
    expect(mockAbandon).toHaveBeenCalledWith('evt-1', { from: 'book' })
  })

  it("?from=claim → forwards {from: 'claim'} unchanged", async () => {
    setUrl('?cancelled=1&from=claim')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1))
    expect(mockAbandon).toHaveBeenCalledWith('evt-1', { from: 'claim' })
  })

  it("INVARIANT: ?from=admin_hold → forwards {from: 'admin_hold'} verbatim, NOT collapsed to 'book'", async () => {
    // This is the regression this component test exists to catch: the
    // OLD implementation only recognised 'claim' and collapsed every
    // other value (including a hypothetical future 'admin_hold') to
    // 'book' — which would have caused abandonPendingCheckout to
    // CANCEL the booking (losing the member's waitlist position
    // entirely) instead of restoring it to 'waitlisted'.
    setUrl('?cancelled=1&from=admin_hold')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1))
    expect(mockAbandon).toHaveBeenCalledWith('evt-1', { from: 'admin_hold' })
  })

  it("an unrecognised ?from value falls back to 'book' (defensive)", async () => {
    setUrl('?cancelled=1&from=something-unexpected')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1))
    expect(mockAbandon).toHaveBeenCalledWith('evt-1', { from: 'book' })
  })

  it("shows the waitlist-preserved toast copy for from=claim AND from=admin_hold alike", async () => {
    setUrl('?cancelled=1&from=admin_hold')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/still on the waitlist/i),
    )
  })

  it("INVARIANT: ?from=admin_remediation -> forwards {from: 'admin_remediation'} verbatim, NOT collapsed to 'book' or 'admin_hold'", async () => {
    // Regression guard for the actual mid-implementation bug (see
    // abandon-pending-checkout.test.ts): if this ever collapsed to
    // 'admin_hold', the server action would wrongly restore this member
    // to 'waitlisted' instead of 'confirmed' -- telling a member who has
    // held a real seat all cycle that they need to wait for one.
    setUrl('?cancelled=1&from=admin_remediation')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1))
    expect(mockAbandon).toHaveBeenCalledWith('evt-1', { from: 'admin_remediation' })
  })

  it("shows the 'spot is still confirmed' toast copy for from=admin_remediation specifically (distinct from the waitlist-preserved copy)", async () => {
    setUrl('?cancelled=1&from=admin_remediation')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => {
      const text = screen.getByRole('status').textContent ?? ''
      expect(text).toMatch(/spot is still confirmed/i)
      expect(text).not.toMatch(/still on the waitlist/i)
    })
  })

  it('shows the generic "payment cancelled" toast copy for the default book flow', async () => {
    setUrl('?cancelled=1')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/payment cancelled/i),
    )
  })

  it('strips both cancelled and from query params from the URL after cleanup runs', async () => {
    setUrl('?cancelled=1&from=admin_hold')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))
    const replacedTo = mockReplace.mock.calls[0][0] as string
    expect(replacedTo).not.toContain('cancelled=1')
    expect(replacedTo).not.toContain('from=admin_hold')
  })

  it('renders nothing (no toast) before cleanup resolves and there was no ?cancelled param', () => {
    setUrl('')
    const { container } = render(<BookingCancelledHandler eventId="evt-1" />)
    expect(container.firstChild).toBeNull()
  })

  it('still calls abandonPendingCheckout and shows the toast even when the cleanup call reports failure (non-blocking)', async () => {
    setUrl('?cancelled=1&from=admin_hold')
    mockAbandon.mockResolvedValue({ success: false, error: 'Could not release the booking' })
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1))
    // The toast still shows — cleanup failure must not block the UI
    // (worst case per the component's own docstring: "the user waits 30
    // min for Stripe's session expiry").
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
  })
})
