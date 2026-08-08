import { isPastEvent } from '@/lib/utils/dates'
import type { BookingWithEvent } from '@/types'

export interface SplitBookings {
  upcoming: BookingWithEvent[]
  past: BookingWithEvent[]
  waitlisted: BookingWithEvent[]
  /**
   * `pending_payment` bookings for events that haven't happened yet.
   * A dedicated bucket (architect's suggested shape,
   * SYSTEM-DESIGN-pending-payment-visibility.md §7.1) rather than
   * folding into `upcoming` — the "action needed" card needs to stand
   * apart from a fully-confirmed one. `BookingsList` merges this bucket
   * into its Upcoming-tab render list (sorted first) and its tab count;
   * `splitBookings` itself just isolates the rows.
   */
  pendingPayment: BookingWithEvent[]
}

export function splitBookings(bookings: BookingWithEvent[]): SplitBookings {
  return {
    upcoming: bookings.filter(
      (b) => b.status === 'confirmed' && !isPastEvent(b.event.date_time),
    ),
    past: bookings.filter(
      (b) =>
        (b.status === 'confirmed' || b.status === 'no_show') &&
        isPastEvent(b.event.date_time),
    ),
    waitlisted: bookings.filter((b) => b.status === 'waitlisted'),
    pendingPayment: bookings.filter(
      (b) => b.status === 'pending_payment' && !isPastEvent(b.event.date_time),
    ),
  }
}
