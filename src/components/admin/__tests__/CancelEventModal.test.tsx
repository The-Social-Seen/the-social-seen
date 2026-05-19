// @vitest-environment jsdom
//
// Tests for the admin "Cancel & Refund" confirmation modal.
//
// Coverage:
//   - All four copy variants (paid / free / waitlist-only / empty) from
//     spec §8.8 render with the verbatim copy strings.
//   - The destructive CTA is disabled while the action is in flight
//     (no double-submit) and the cancel/close button is also disabled.
//   - `failedRefunds` from a partial-failure response surfaces in an
//     expandable panel on the modal post-submit, not just in a toast.
//   - Success path swaps the modal body for a success status block.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { CancelEventResult } from '@/app/(admin)/admin/actions'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import CancelEventModal from '../CancelEventModal'

/**
 * Whole-element text matcher restricted to the innermost element
 * whose textContent matches.
 *
 * The modal renders copy with inline <span>s for emphasis (price, count)
 * and curly quotes around the event title, so the text we care about is
 * split across multiple text nodes inside a single <p>. The default
 * `getByText` substring match only sees one node at a time and misses
 * the joined sentence. A textContent matcher fixes that but matches
 * every ancestor too — so we additionally require that no child element
 * already satisfies the match. That pins the "smallest" element.
 */
function textMatcher(needle: RegExp) {
  return (_content: string, element: Element | null) => {
    if (!element) return false
    const normalise = (s: string) =>
      s
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/…/g, '...')

    const text = normalise(element.textContent ?? '')
    if (!needle.test(text)) return false

    // Reject the match if a direct-element child already matches —
    // this restricts us to the innermost element holding the full
    // sentence.
    for (const child of Array.from(element.children)) {
      if (needle.test(normalise(child.textContent ?? ''))) return false
    }
    return true
  }
}

const baseEvent = {
  id: 'evt-1',
  title: 'Wine & Wisdom',
  slug: 'wine-and-wisdom',
}

const baseSummary: NonNullable<CancelEventResult['summary']> = {
  eventId: 'evt-1',
  eventTitle: 'Wine & Wisdom',
  totalBookings: 3,
  refundedCount: 3,
  refundedTotalPence: 6180, // 3 × £20.60
  cancelledFreeCount: 0,
  cancelledWaitlistCount: 0,
  cancelledPendingCount: 0,
  failedRefunds: [],
  emailedCount: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CancelEventModal — copy variants', () => {
  it('renders the paid-bookings copy when confirmedPaid > 0', () => {
    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 3,
          confirmedFree: 0,
          waitlisted: 0,
          totalRefundPence: 6180,
        }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // Title contains the event title — broken across nodes by the
    // styled curly quotes, so the function matcher anchors on the
    // title element itself.
    expect(screen.getByText(textMatcher(/Cancel "Wine & Wisdom"\?/i))).toBeTruthy()
    expect(screen.getByText('£61.80')).toBeTruthy()
    // Whole sentence rendered across multiple spans.
    expect(
      screen.getByText(textMatcher(/refund a total of .* to 3 members/i)),
    ).toBeTruthy()
    expect(
      screen.getByText(
        textMatcher(
          /booking fees we charge for card processing.*absorbed by the platform/i,
        ),
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(textMatcher(/Members will receive a cancellation email/i)),
    ).toBeTruthy()
    expect(screen.getByText(/This action cannot be undone/)).toBeTruthy()
  })

  it('renders the free-bookings copy when only confirmedFree > 0', () => {
    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 0,
          confirmedFree: 5,
          waitlisted: 0,
          totalRefundPence: 0,
        }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/will cancel the event and notify 5 confirmed members/i),
    ).toBeTruthy()
    expect(screen.getByText(/No refunds needed \(free event\)/)).toBeTruthy()
    // Make sure we don't accidentally render the paid disclosure too.
    expect(screen.queryByText(/refund a total of/)).toBeNull()
  })

  it('renders the waitlist-only copy when only waitlisted > 0', () => {
    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 0,
          confirmedFree: 0,
          waitlisted: 4,
          totalRefundPence: 0,
        }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/will cancel the event and notify 4 waitlisted members/i),
    ).toBeTruthy()
    expect(screen.queryByText(/No refunds needed/)).toBeNull()
    expect(screen.queryByText(/refund a total of/)).toBeNull()
  })

  it('renders the zero-bookings copy when all counts are 0', () => {
    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 0,
          confirmedFree: 0,
          waitlisted: 0,
          totalRefundPence: 0,
        }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/will cancel the event\. No members will be affected/i),
    ).toBeTruthy()
  })

  it('uses singular grammar when there is exactly one member', () => {
    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 1,
          confirmedFree: 0,
          waitlisted: 0,
          totalRefundPence: 2060,
        }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // "to 1 member" — singular. A regression to "to 1 members" would
    // be ugly enough that the copy lead would notice in QA.
    expect(screen.getByText(/to 1 member\b/)).toBeTruthy()
  })
})

describe('CancelEventModal — submission lifecycle', () => {
  it('disables the destructive CTA while the action is in flight', async () => {
    // never-resolving promise so the button stays in its pending state.
    let resolve: ((v: CancelEventResult) => void) | null = null
    const onConfirm = vi.fn(
      () =>
        new Promise<CancelEventResult>((res) => {
          resolve = res
        }),
    )

    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 1,
          confirmedFree: 0,
          waitlisted: 0,
          totalRefundPence: 2060,
        }}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    const cta = screen.getByRole('button', { name: /Cancel Event & Refund/i })
    expect((cta as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(cta)
    })

    // While the promise is still pending the CTA shows the "Cancelling…"
    // label and is disabled.
    const ctaPending = screen.getByRole('button', { name: /Cancelling/i })
    expect((ctaPending as HTMLButtonElement).disabled).toBe(true)

    // Resolve the promise so React can flush.
    await act(async () => {
      resolve?.({ success: true, summary: baseSummary })
    })
  })

  it('renders a success status block when the action returns success with no failures', async () => {
    const onConfirm = vi.fn(async (): Promise<CancelEventResult> => ({
      success: true,
      summary: baseSummary,
    }))

    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 3,
          confirmedFree: 0,
          waitlisted: 0,
          totalRefundPence: 6180,
        }}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Cancel Event & Refund/i }),
      )
    })

    // Spec §8.8 success copy. Text is split across nodes (curly
    // quotes wrap the title) so a function matcher is required.
    expect(
      screen.getByText(
        textMatcher(/Cancelled "Wine & Wisdom"\. Refunded £61\.80 to 3 members/i),
      ),
    ).toBeTruthy()
    // Destructive CTA gone; only a "Done" close remains.
    expect(
      screen.queryByRole('button', { name: /Cancel Event & Refund/i }),
    ).toBeNull()
  })

  it('surfaces failedRefunds in an expandable panel on partial failure', async () => {
    const partialSummary: NonNullable<CancelEventResult['summary']> = {
      ...baseSummary,
      refundedCount: 2,
      failedRefunds: [
        {
          bookingId: 'bk-failed-1',
          userEmail: 'alice@example.com',
          error: 'Stripe error: charge already refunded',
        },
        {
          bookingId: 'bk-failed-2',
          userEmail: 'bob@example.com',
          error: 'Stripe error: card declined',
        },
      ],
    }

    const onConfirm = vi.fn(async (): Promise<CancelEventResult> => ({
      success: true,
      summary: partialSummary,
    }))

    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 4,
          confirmedFree: 0,
          waitlisted: 0,
          totalRefundPence: 8240,
        }}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Cancel Event & Refund/i }),
      )
    })

    // Partial-failure summary appears, with the spec §8.8 phrasing.
    expect(
      screen.getByText(
        textMatcher(
          /Cancelled "Wine & Wisdom"\. 2 of 4 refunds processed\. 2 failed/i,
        ),
      ),
    ).toBeTruthy()
    expect(
      screen.getByText(textMatcher(/see Stripe dashboard for manual retry/i)),
    ).toBeTruthy()

    // Toggle to expand the failed-refund details.
    const toggle = screen.getByRole('button', { name: /Show 2 failed refunds/i })
    await act(async () => {
      fireEvent.click(toggle)
    })

    // Both booking IDs + emails + Stripe errors visible.
    expect(screen.getByText('bk-failed-1')).toBeTruthy()
    expect(screen.getByText('alice@example.com')).toBeTruthy()
    expect(screen.getByText(/charge already refunded/)).toBeTruthy()
    expect(screen.getByText('bk-failed-2')).toBeTruthy()
    expect(screen.getByText('bob@example.com')).toBeTruthy()
    expect(screen.getByText(/card declined/)).toBeTruthy()
  })

  it('renders the Server Action error in the modal when success=false', async () => {
    const onConfirm = vi.fn(async (): Promise<CancelEventResult> => ({
      success: false,
      error: 'Event not found',
    }))

    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 1,
          confirmedFree: 0,
          waitlisted: 0,
          totalRefundPence: 2060,
        }}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Cancel Event & Refund/i }),
      )
    })

    expect(screen.getByText('Event not found')).toBeTruthy()
    // CTA re-enabled for a retry attempt.
    expect(
      screen.getByRole('button', { name: /Cancel Event & Refund/i }),
    ).toBeTruthy()
  })
})

describe('CancelEventModal — accessibility', () => {
  it('does NOT auto-focus the destructive CTA on open', () => {
    // The destructive button must require deliberate interaction. We
    // can't assert the focus ring directly in jsdom, but the absence
    // of `autoFocus` on the rendered button is a strong signal.
    render(
      <CancelEventModal
        open={true}
        event={baseEvent}
        bookingCounts={{
          confirmedPaid: 1,
          confirmedFree: 0,
          waitlisted: 0,
          totalRefundPence: 2060,
        }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const cta = screen.getByRole('button', { name: /Cancel Event & Refund/i })
    // jsdom + Radix Dialog: nothing should claim focus on open by
    // default. We pin the absence of an explicit `autofocus` attribute
    // on the CTA — a regression that re-introduces autoFocus would
    // surface here.
    expect(cta.getAttribute('autofocus')).toBeNull()
  })
})
