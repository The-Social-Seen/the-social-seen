import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getAdminEventById } from '../../actions'
import EventForm, { type HostFormRow } from '@/components/admin/EventForm'
import DuplicateEventButton from '@/components/admin/DuplicateEventButton'
import { getActiveTags } from '@/lib/supabase/queries/tags'
import { getEventTagsForEvent } from '@/lib/supabase/queries/tags'

/**
 * Shape of the embedded host row returned by getAdminEventById.
 * `profile` may arrive as either an object or a single-element array
 * depending on Supabase's inference for the FK relationship.
 */
type AdminHostRow = {
  id: string
  role_label: string
  sort_order: number
  profile:
    | {
        id: string
        full_name: string
        avatar_url: string | null
        job_title: string | null
        company: string | null
      }
    | Array<{
        id: string
        full_name: string
        avatar_url: string | null
        job_title: string | null
        company: string | null
      }>
    | null
}

function toHostFormRows(rows: AdminHostRow[]): HostFormRow[] {
  return rows
    .map((r) => {
      const profile = Array.isArray(r.profile) ? r.profile[0] : r.profile
      if (!profile) return null
      return {
        profileId: profile.id,
        roleLabel: r.role_label,
        memberSnapshot: {
          full_name: profile.full_name,
          avatar_url: profile.avatar_url,
          job_title: profile.job_title,
          company: profile.company,
        },
      } satisfies HostFormRow
    })
    .filter((r): r is HostFormRow => r !== null)
}

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
  let initialTagSelection = undefined
  let initialHosts: HostFormRow[] | undefined = undefined

  // The full active taxonomy is needed for both flows (new + edit) to
  // populate the tag picker.
  const availableTags = await getActiveTags()

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
      price: data.price,
      capacity: data.capacity,
      external_attendees: data.external_attendees ?? 0,
      image_url: data.image_url,
      dress_code: data.dress_code,
      refund_window_hours: data.refund_window_hours,
      is_published: data.is_published,
    }
    inclusions = (data.inclusions ?? []).map((inc: { label: string; icon: string | null }) => ({
      label: inc.label,
      icon: inc.icon ?? '',
    }))
    initialTagSelection = await getEventTagsForEvent(data.id)
    initialHosts = toHostFormRows((data.hosts ?? []) as AdminHostRow[])
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
        <EventForm
          event={event}
          inclusions={inclusions}
          availableTags={availableTags}
          initialTagSelection={initialTagSelection}
          initialHosts={initialHosts}
        />
      </div>
    </div>
  )
}
