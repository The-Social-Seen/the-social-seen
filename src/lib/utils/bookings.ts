import { isPastEvent } from '@/lib/utils/dates'
import type { BookingWithEvent } from '@/types'

export interface SplitBookings {
  upcoming: BookingWithEvent[]
  past: BookingWithEvent[]
  waitlisted: BookingWithEvent[]
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
  }
}
