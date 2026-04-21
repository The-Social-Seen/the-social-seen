'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { slugify } from '@/lib/utils/slugify'
import { penceToPounds } from '@/lib/utils/currency'
import { CATEGORY_LABELS, type EventCategory } from '@/types'
import {
  createEvent,
  updateEvent,
  upsertEventInclusions,
} from '@/app/(admin)/admin/actions'
import InclusionsList from './InclusionsList'

interface EventData {
  id?: string
  title: string
  slug: string
  short_description: string
  description: string
  date_time: string
  end_time: string
  venue_name: string
  venue_address: string
  postcode: string | null
  venue_revealed: boolean
  category: EventCategory
  price: number
  capacity: number | null
  image_url: string | null
  dress_code: string | null
  is_published: boolean
}

interface Inclusion {
  label: string
  icon: string
}

interface EventFormProps {
  event?: EventData
  inclusions?: Inclusion[]
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const offset = d.getTimezoneOffset()
  const local = new Date(d.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

export default function EventForm({ event, inclusions: initialInclusions }: EventFormProps) {
  const router = useRouter()
  const isEditing = !!event?.id
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState(event?.title ?? '')
  const [inclusions, setInclusions] = useState<Inclusion[]>(
    initialInclusions ?? []
  )

  const liveSlug = slugify(title)

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = isEditing
        ? await updateEvent(event!.id!, formData)
        : await createEvent(formData)

      if ('error' in result && result.error) {
        setError(result.error)
        return
      }

      // Upsert inclusions if we have any
      const eventId = isEditing
        ? event!.id!
        : (result as { event: { id: string } }).event.id

      if (inclusions.length > 0) {
        const filtered = inclusions.filter((inc) => inc.label.trim())
        if (filtered.length > 0) {
          await upsertEventInclusions(
            eventId,
            filtered.map((inc) => ({
              label: inc.label,
              icon: inc.icon || undefined,
            }))
          )
        }
      }

      router.push(`/admin/events/${eventId}`)
    })
  }

  return (
    <form action={handleSubmit} className="space-y-6 max-w-2xl">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <FormField label="Title">
        <input
          name="title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="form-input"
          placeholder="Wine & Wisdom at Borough Market"
        />
        {title && (
          <p className="mt-1 text-xs text-text-tertiary">
            thesocialseen.com/events/<span className="text-gold">{liveSlug}</span>
          </p>
        )}
      </FormField>

      <FormField label="Short Description" hint="Max 300 characters">
        <textarea
          name="short_description"
          required
          maxLength={300}
          rows={2}
          defaultValue={event?.short_description ?? ''}
          className="form-input resize-none"
          placeholder="A brief summary for event cards..."
        />
      </FormField>

      <FormField label="Description">
        <textarea
          name="description"
          required
          rows={5}
          defaultValue={event?.description ?? ''}
          className="form-input resize-none"
          placeholder="Full event description..."
        />
      </FormField>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Category">
          <select name="category" required defaultValue={event?.category ?? ''} className="form-input">
            <option value="" disabled>Select category</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Price (£)" hint="0 = free event">
          <input
            name="price"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={event ? penceToPounds(event.price) : 0}
            className="form-input"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Start Date & Time">
          <input
            name="date_time"
            type="datetime-local"
            required
            defaultValue={event ? toDatetimeLocal(event.date_time) : ''}
            className="form-input"
          />
        </FormField>

        <FormField label="End Date & Time">
          <input
            name="end_time"
            type="datetime-local"
            required
            defaultValue={event ? toDatetimeLocal(event.end_time) : ''}
            className="form-input"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Venue Name">
          <input
            name="venue_name"
            type="text"
            required
            defaultValue={event?.venue_name ?? ''}
            className="form-input"
            placeholder="The Vinopolis Wine Cellar"
          />
        </FormField>

        <FormField label="Venue Address">
          <input
            name="venue_address"
            type="text"
            required
            defaultValue={event?.venue_address ?? ''}
            className="form-input"
            placeholder="1 Bank End, London"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="Postcode" hint="Optional — used for the map link">
          <input
            name="postcode"
            type="text"
            defaultValue={event?.postcode ?? ''}
            className="form-input"
            placeholder="SE1 9BU"
          />
        </FormField>

        <div className="flex items-end pb-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              name="venue_hidden"
              type="checkbox"
              value="true"
              defaultChecked={event ? !event.venue_revealed : true}
              className="sr-only peer"
            />
            <div className="relative w-11 h-6 bg-bg-tertiary rounded-full peer peer-checked:bg-gold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-gold/50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
            <span className="text-sm font-medium text-text-primary">
              Hide venue until 1 week before
            </span>
          </label>
        </div>
      </div>

      <FormField label="Capacity" hint="Leave empty for unlimited">
        <input
          name="capacity"
          type="number"
          min={1}
          defaultValue={event?.capacity ?? ''}
          className="form-input"
          placeholder="Unlimited"
        />
      </FormField>

      <FormField label="Image URL" hint="External image URL for the event">
        <input
          name="image_url"
          type="url"
          defaultValue={event?.image_url ?? ''}
          className="form-input"
          placeholder="https://images.unsplash.com/..."
        />
      </FormField>

      <FormField label="Dress Code" hint="Optional">
        <input
          name="dress_code"
          type="text"
          defaultValue={event?.dress_code ?? ''}
          className="form-input"
          placeholder="Smart Casual"
        />
      </FormField>

      <InclusionsList items={inclusions} onChange={setInclusions} />

      <div className="flex items-center gap-3">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            name="is_published"
            type="checkbox"
            value="true"
            defaultChecked={event?.is_published ?? false}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-bg-tertiary rounded-full peer peer-checked:bg-gold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-gold/50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
        </label>
        <span className="text-sm font-medium text-text-primary">Published</span>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-border">
        <button
          type="submit"
          disabled={isPending}
          className="bg-gold hover:bg-gold-dark text-white font-medium text-sm px-8 py-3 rounded-full transition-colors disabled:opacity-50"
        >
          {isPending ? 'Saving...' : isEditing ? 'Update Event' : 'Create Event'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/admin/events')}
          className="border border-border text-text-primary font-medium text-sm px-8 py-3 rounded-full hover:bg-bg-secondary transition-colors"
        >
          Cancel
        </button>
      </div>

      {/* Style for form inputs */}
      <style jsx global>{`
        .form-input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid var(--color-border);
          background-color: var(--color-bg-card);
          color: var(--color-text-primary);
          font-size: 0.875rem;
        }
        .form-input:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(201, 169, 110, 0.5);
        }
      `}</style>
    </form>
  )
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-1">
        {label}
        {hint && <span className="font-normal text-text-tertiary ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  )
}
