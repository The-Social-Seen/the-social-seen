import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getEventBookings, getAdminEventById } from '../../../actions'
import BookingsTable from '@/components/admin/BookingsTable'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  try {
    const event = await getAdminEventById(id)
    return { title: `Bookings — ${event.title} — Admin — The Social Seen` }
  } catch {
    return { title: 'Bookings — Admin — The Social Seen' }
  }
}

export default async function AdminEventBookingsPage({ params }: PageProps) {
  const { id } = await params

  const [event, bookings] = await Promise.all([
    getAdminEventById(id),
    getEventBookings(id),
  ])

  // Normalise profile join (Supabase may return array or object)
  const normalisedBookings = bookings.map((b) => ({
    ...b,
    profile: Array.isArray(b.profile) ? b.profile[0] ?? null : b.profile ?? null,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/events"
          className="p-2 rounded-lg hover:bg-bg-secondary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Back to events"
        >
          <ArrowLeft className="w-5 h-5 text-text-tertiary" />
        </Link>
        <div>
          <h1 className="font-serif text-2xl text-text-primary">{event.title}</h1>
          <p className="text-sm text-text-tertiary">
            {normalisedBookings.filter((b) => b.status === 'confirmed').length} confirmed
            {' · '}
            {normalisedBookings.filter((b) => b.status === 'waitlisted').length} waitlisted
          </p>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-6">
        <BookingsTable bookings={normalisedBookings} eventId={id} />
      </div>
    </div>
  )
}
