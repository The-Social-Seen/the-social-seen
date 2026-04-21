import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getAdminEventById } from '../../actions'
import EventForm from '@/components/admin/EventForm'
import DuplicateEventButton from '@/components/admin/DuplicateEventButton'
import type { EventCategory } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  return {
    title: id === 'new'
      ? 'Create Event — Admin — The Social Seen'
      : 'Edit Event — Admin — The Social Seen',
  }
}

export default async function AdminEventEditPage({ params }: PageProps) {
  const { id } = await params
  const isNew = id === 'new'

  let event = undefined
  let inclusions = undefined

  if (!isNew) {
    const data = await getAdminEventById(id)
    event = {
      id: data.id,
      title: data.title,
      slug: data.slug,
      short_description: data.short_description,
      description: data.description,
      date_time: data.date_time,
      end_time: data.end_time,
      venue_name: data.venue_name,
      venue_address: data.venue_address,
      postcode: data.postcode ?? null,
      venue_revealed: data.venue_revealed ?? true,
      category: data.category as EventCategory,
      price: data.price,
      capacity: data.capacity,
      image_url: data.image_url,
      dress_code: data.dress_code,
      is_published: data.is_published,
    }
    inclusions = (data.inclusions ?? []).map((inc: { label: string; icon: string | null }) => ({
      label: inc.label,
      icon: inc.icon ?? '',
    }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/events"
            className="p-2 rounded-lg hover:bg-bg-secondary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Back to events"
          >
            <ArrowLeft className="w-5 h-5 text-text-tertiary" />
          </Link>
          <h1 className="font-serif text-2xl text-text-primary">
            {isNew ? 'Create Event' : 'Edit Event'}
          </h1>
        </div>
        {!isNew && event && <DuplicateEventButton eventId={event.id} />}
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-6">
        <EventForm event={event} inclusions={inclusions} />
      </div>
    </div>
  )
}
