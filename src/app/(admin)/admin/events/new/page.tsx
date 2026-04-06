import EventForm from '@/components/admin/EventForm'

export const metadata = {
  title: 'Create Event — Admin — The Social Seen',
}

export default function CreateEventPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-bold text-text-primary">
        Create Event
      </h1>
      <EventForm />
    </div>
  )
}
