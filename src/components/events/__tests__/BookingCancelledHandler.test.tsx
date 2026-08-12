// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * Coverage for BookingCancelledHandler.
 *
 * ── Why this file was rewritten ─────────────────────────────────────────
 *
 * The P0 fix to `abandonPendingCheckout` (src/app/events/[slug]/actions.ts)
 * means this component's `?from=` forwarding is now diagnostics-only —
 * the server action never trusts it for the rollback decision. The
 * load-bearing behaviour that actually matters here now is: **toast copy
 * must be driven by the Server Action's REAL returned `result.status`,
 * never by the (untrusted, spoofable) `?from=` URL param.** The previous
 * version of this file asserted toast copy purely from the `from` value
 * it set in the URL, which would have silently re-validated a spoofed
 * outcome as "correct" even after the server-side fix landed. That
 * category of test — matching the vulnerable shape instead of defending
 * against it — is exactly what this rewrite avoids.
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

  it("no ?from param → forwards {from: 'book'} (diagnostics hint default)", async () => {
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

  it("?from=admin_hold → forwards {from: 'admin_hold'} verbatim (diagnostics hint only — does not decide the outcome server-side)", async () => {
    setUrl('?cancelled=1&from=admin_hold')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1))
    expect(mockAbandon).toHaveBeenCalledWith('evt-1', { from: 'admin_hold' })
  })

  it("?from=admin_remediation → forwards {from: 'admin_remediation'} verbatim (diagnostics hint only)", async () => {
    setUrl('?cancelled=1&from=admin_remediation')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1))
    expect(mockAbandon).toHaveBeenCalledWith('evt-1', { from: 'admin_remediation' })
  })

  it("an unrecognised ?from value falls back to 'book' (defensive)", async () => {
    setUrl('?cancelled=1&from=something-unexpected')
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => expect(mockAbandon).toHaveBeenCalledTimes(1))
    expect(mockAbandon).toHaveBeenCalledWith('evt-1', { from: 'book' })
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

// ════════════════════════════════════════════════════════════════════════════
// SECURITY-ADJACENT: toast copy is driven by the REAL result.status, never
// by the (spoofable) ?from= URL param. This is the load-bearing behaviour
// this file exists to defend now that the server-side vulnerability is
// closed — the client must not independently re-open it by trusting `from`
// for what it TELLS the user, even though it never used `from` to decide
// what it DOES to the database.
// ════════════════════════════════════════════════════════════════════════════

describe('BookingCancelledHandler — toast copy reflects the real result.status, never the spoofed ?from param', () => {
  it("result.status = 'waitlisted' → shows the waitlist-preserved toast, regardless of from", async () => {
    setUrl('?cancelled=1&from=book')
    mockAbandon.mockResolvedValue({ success: true, status: 'waitlisted' })
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/still on the waitlist/i),
    )
  })

  it("result.status = 'confirmed' → shows the 'spot is still confirmed' toast, regardless of from", async () => {
    setUrl('?cancelled=1&from=book')
    mockAbandon.mockResolvedValue({ success: true, status: 'confirmed' })
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => {
      const text = screen.getByRole('status').textContent ?? ''
      expect(text).toMatch(/spot is still confirmed/i)
      expect(text).not.toMatch(/still on the waitlist/i)
    })
  })

  it("result.status = 'cancelled' → shows the generic 'payment cancelled' toast, regardless of from", async () => {
    setUrl('?cancelled=1&from=book')
    mockAbandon.mockResolvedValue({ success: true, status: 'cancelled' })
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/payment cancelled/i),
    )
  })

  it("SECURITY-ADJACENT: from=admin_remediation (implies 'confirmed') but the REAL outcome is 'cancelled' (the exploit attempt was rejected server-side) → toast shows the generic cancelled copy, NOT 'spot is still confirmed'", async () => {
    // Simulates exactly what happens when a member spoofs
    // ?from=admin_remediation on an ordinary self-booked pending_payment
    // row: the server action (now fixed) derives 'cancelled' from the
    // real row columns and ignores the spoofed hint. The toast must tell
    // the truth, not what the attacker's URL implied.
    setUrl('?cancelled=1&from=admin_remediation')
    mockAbandon.mockResolvedValue({ success: true, status: 'cancelled' })
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => {
      const text = screen.getByRole('status').textContent ?? ''
      expect(text).toMatch(/payment cancelled/i)
      expect(text).not.toMatch(/spot is still confirmed/i)
    })
  })

  it("SECURITY-ADJACENT: from=claim (implies 'waitlisted') but the REAL outcome is 'cancelled' → toast shows the generic cancelled copy, NOT 'still on the waitlist'", async () => {
    setUrl('?cancelled=1&from=claim')
    mockAbandon.mockResolvedValue({ success: true, status: 'cancelled' })
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => {
      const text = screen.getByRole('status').textContent ?? ''
      expect(text).toMatch(/payment cancelled/i)
      expect(text).not.toMatch(/still on the waitlist/i)
    })
  })

  it("SECURITY-ADJACENT: from=book (implies generic 'cancelled') but the REAL outcome is 'waitlisted' → toast shows the waitlist-preserved copy, NOT the generic cancelled copy", async () => {
    // Inverse direction: proves the toast isn't just defaulting to the
    // safe/generic copy whenever `from` is missing or wrong — it actively
    // reflects whatever the server really did, in both directions.
    setUrl('?cancelled=1&from=book')
    mockAbandon.mockResolvedValue({ success: true, status: 'waitlisted' })
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() => {
      const text = screen.getByRole('status').textContent ?? ''
      expect(text).toMatch(/still on the waitlist/i)
      expect(text).not.toMatch(/^payment cancelled/i)
    })
  })

  it("no status on the result (e.g. legacy no-op {success: true} shape) falls back to the generic 'payment cancelled' toast copy", async () => {
    setUrl('?cancelled=1&from=admin_remediation')
    mockAbandon.mockResolvedValue({ success: true })
    render(<BookingCancelledHandler eventId="evt-1" />)

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/payment cancelled/i),
    )
  })
})
