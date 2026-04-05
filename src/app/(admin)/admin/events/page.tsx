import Link from 'next/link'
import { Plus } from 'lucide-react'
import { getAdminEvents } from '../actions'
import EventsTable from '@/components/admin/EventsTable'

export const metadata = {
  title: 'Events — Admin — The Social Seen',
}

export default async function AdminEventsPage() {
  const events = await getAdminEvents()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-text-primary">Events</h1>
        <Link
          href="/admin/events/new"
          className="inline-flex items-center gap-2 bg-gold hover:bg-gold-dark text-white font-medium text-sm px-6 py-2.5 rounded-full transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Event
        </Link>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-6">
        <EventsTable events={events} />
      </div>
    </div>
  )
}
