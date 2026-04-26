import EventForm from '@/components/admin/EventForm'
import { getActiveTags } from '@/lib/supabase/queries/tags'

export const metadata = {
  title: 'Create Event — Admin — The Social Seen',
}

export default async function CreateEventPage() {
  const availableTags = await getActiveTags()
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-bold text-text-primary">
        Create Event
      </h1>
      <EventForm availableTags={availableTags} />
    </div>
  )
}
