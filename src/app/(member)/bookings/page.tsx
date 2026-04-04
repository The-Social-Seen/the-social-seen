import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getMyBookings } from '@/lib/supabase/queries/profile'
import { splitBookings } from '@/lib/utils/bookings'
import { BookingsList } from '@/components/profile/BookingsList'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Bookings — The Social Seen',
}

export default async function BookingsPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const bookings = await getMyBookings(user.id)
  const { upcoming, past, waitlisted } = splitBookings(bookings)

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-20">
      <h1 className="mb-6 font-serif text-2xl font-bold text-charcoal dark:text-dark-text md:text-3xl">
        My Bookings
      </h1>
      <BookingsList upcoming={upcoming} past={past} waitlisted={waitlisted} />
    </div>
  )
}
