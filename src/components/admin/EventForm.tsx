'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { X } from 'lucide-react'
import { slugify } from '@/lib/utils/slugify'
import { penceToPounds } from '@/lib/utils/currency'
import { resolveAvatarUrl, getInitials } from '@/lib/utils/images'
import {
  createEvent,
  saveEventTags,
  updateEvent,
  upsertEventHosts,
  upsertEventInclusions,
  type HostInput,
  type HostPickerMember,
} from '@/app/(admin)/admin/actions'
import InclusionsList from './InclusionsList'
import MemberPicker from './MemberPicker'
import TagPicker from './TagPicker'
import type { Tag } from '@/types'

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
  price: number
  capacity: number | null
  image_url: string | null
  dress_code: string | null
  refund_window_hours: number
  is_published: boolean
}

export interface EventTagSelection {
  primary: string | null
  secondaries: string[]
}

type RefundPolicyChoice = 'none' | 'standard' | 'custom'

function deriveRefundPolicy(hours: number | undefined): {
  choice: RefundPolicyChoice
  customHours: string
} {
  if (hours === undefined || hours === 48) {
    return { choice: 'standard', customHours: '' }
  }
  if (hours === 0) {
    return { choice: 'none', customHours: '' }
  }
  return { choice: 'custom', customHours: String(hours) }
}

interface Inclusion {
  label: string
  icon: string
}

/**
 * In-form representation of a host. The `memberSnapshot` is captured at
 * pick-time so the row renders without a second member-lookup, and so a
 * locally-deleted member doesn't break the UI before save.
 */
export interface HostFormRow {
  profileId: string
  roleLabel: string
  memberSnapshot: {
    full_name: string
    avatar_url: string | null
    job_title: string | null
    company: string | null
  }
}

interface EventFormProps {
  event?: EventData
  inclusions?: Inclusion[]
  /** Active taxonomy — required by the new tag picker. Empty array is treated as "tags not loaded". */
  availableTags?: Tag[]
  /** Pre-existing tag selection for edit screens; null primary means a new event. */
  initialTagSelection?: EventTagSelection
  /** Pre-existing hosts on the edit screen. Empty array on create. */
  initialHosts?: HostFormRow[]
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const offset = d.getTimezoneOffset()
  const local = new Date(d.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

export default function EventForm({
  event,
  inclusions: initialInclusions,
  availableTags = [],
  initialTagSelection,
  initialHosts = [],
}: EventFormProps) {
  const router = useRouter()
  const isEditing = !!event?.id
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [tagError, setTagError] = useState<string | null>(null)

  const [title, setTitle] = useState(event?.title ?? '')
  const [inclusions, setInclusions] = useState<Inclusion[]>(
    initialInclusions ?? []
  )

  // Hosts are listed in the order they were added. Drag-to-reorder is
  // deferred to v2 — admins remove and re-add to change order today.
  const [hosts, setHosts] = useState<HostFormRow[]>(initialHosts)

  function addHost(member: HostPickerMember) {
    setHosts((prev) => [
      ...prev,
      {
        profileId: member.id,
        roleLabel: '',
        memberSnapshot: {
          full_name: member.full_name,
          avatar_url: member.avatar_url,
          job_title: member.job_title,
          company: member.company,
        },
      },
    ])
  }

  function updateHostLabel(profileId: string, value: string) {
    setHosts((prev) =>
      prev.map((h) => (h.profileId === profileId ? { ...h, roleLabel: value } : h)),
    )
  }

  function removeHost(profileId: string) {
    setHosts((prev) => prev.filter((h) => h.profileId !== profileId))
  }

  // Tag picker state — independent of the form, submitted via hidden inputs
  // (primary_tag_slug + secondary_tag_slugs). The Server Action reads
  // primary_tag_slug to derive the legacy `events.category` enum value;
  // saveEventTags is then called separately to write event_tags rows.
  const [primaryTagSlug, setPrimaryTagSlug] = useState<string | null>(
    initialTagSelection?.primary ?? null,
  )
  const [secondaryTagSlugs, setSecondaryTagSlugs] = useState<string[]>(
    initialTagSelection?.secondaries ?? [],
  )

  const initialRefund = deriveRefundPolicy(event?.refund_window_hours)
  const [refundPolicy, setRefundPolicy] = useState<RefundPolicyChoice>(
    initialRefund.choice
  )
  const [customHours, setCustomHours] = useState(initialRefund.customHours)

  const liveSlug = slugify(title)

  function handleSubmit(formData: FormData) {
    setError(null)
    setTagError(null)

    // Client-side guard: primary required.
    if (!primaryTagSlug) {
      setTagError(
        'Pick a primary tag — this is the main category for the event.',
      )
      return
    }
    // Client-side guard: same tag in both slots is forbidden. The picker
    // UI prevents this, but a defensive recheck before submit closes any
    // race window.
    if (secondaryTagSlugs.includes(primaryTagSlug)) {
      setTagError(
        'A tag can’t be both primary and secondary on the same event. Pick one.',
      )
      return
    }

    // Map the local host rows to the server's HostInput shape — trim
    // happens server-side; an empty roleLabel falls back to 'Host' there.
    const hostInputs: HostInput[] = hosts.map((h) => ({
      profileId: h.profileId,
      roleLabel: h.roleLabel,
    }))

    startTransition(async () => {
      const result = isEditing
        ? await updateEvent(event!.id!, formData)
        : await createEvent(formData, hostInputs)

      if ('error' in result && result.error) {
        setError(result.error)
        return
      }

      // Upsert inclusions if we have any
      const eventId = isEditing
        ? event!.id!
        : (result as { event: { id: string } }).event.id

      // On the edit path, sync hosts via the dedicated upsert action.
      // (createEvent handles host insert internally on creation.) Errors
      // here surface to the form but don't roll the event update back —
      // partial success is acceptable; admins can retry.
      if (isEditing) {
        const hostsResult = await upsertEventHosts(eventId, hostInputs)
        if ('error' in hostsResult && hostsResult.error) {
          setError(hostsResult.error)
          return
        }
      }

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

      // Persist event_tags via the dedicated Server Action. Server-side
      // collision guard (defence in depth) re-checks primary !== secondaries.
      const tagsResult = await saveEventTags(
        eventId,
        primaryTagSlug,
        secondaryTagSlugs,
      )
      if (!tagsResult.success) {
        setTagError(tagsResult.error ?? 'Failed to save tags')
        // Don't navigate — the event row exists but tags didn't save.
        // Admin can fix the picker and re-submit.
        return
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
          <p className="mt-1 text-xs text-text-tertiary truncate">
            <span className="hidden md:inline">thesocialseen.com/events/</span>
            <span className="md:hidden">…/events/</span>
            <span className="text-gold">{liveSlug}</span>
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

      {/* Phase 3 W5 — replaces the legacy `category` <select>. The tag
          picker holds primary + secondary slugs in component state and
          submits primary_tag_slug as a hidden input via the radio inputs;
          secondary_tag_slugs is a comma-joined hidden input rendered by
          the picker itself. The legacy events.category column is derived
          server-side via `legacyCategoryForSlug()` and kept in sync by
          the bidirectional trigger from the first event_tags primary
          INSERT onwards. */}
      <TagPicker
        availableTags={availableTags}
        primarySlug={primaryTagSlug}
        secondarySlugs={secondaryTagSlugs}
        onPrimaryChange={setPrimaryTagSlug}
        onSecondariesChange={setSecondaryTagSlugs}
        error={tagError}
      />

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

        <div className="flex items-end md:pb-2">
          <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
            <input
              name="venue_hidden"
              type="checkbox"
              value="true"
              defaultChecked={event ? !event.venue_revealed : true}
              className="sr-only peer"
            />
            <span className="relative w-11 h-6 bg-bg-tertiary rounded-full peer peer-checked:bg-gold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-gold/50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full shrink-0" />
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

      <FormField
        label="Refund Policy"
        hint="When can customers cancel for a refund?"
      >
        <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-3 text-sm text-text-primary min-h-[44px] py-1">
            <input
              type="radio"
              name="refund_policy"
              value="none"
              checked={refundPolicy === 'none'}
              onChange={() => setRefundPolicy('none')}
              className="h-4 w-4 accent-gold shrink-0"
            />
            <span>No refunds &mdash; this event is non-refundable</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-text-primary min-h-[44px] py-1">
            <input
              type="radio"
              name="refund_policy"
              value="standard"
              checked={refundPolicy === 'standard'}
              onChange={() => setRefundPolicy('standard')}
              className="h-4 w-4 accent-gold shrink-0"
            />
            <span>48 hours before the event (recommended)</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-text-primary min-h-[44px] py-1">
            <input
              type="radio"
              name="refund_policy"
              value="custom"
              checked={refundPolicy === 'custom'}
              onChange={() => setRefundPolicy('custom')}
              className="h-4 w-4 accent-gold shrink-0"
            />
            <span>Custom &mdash; refunds close N hours before the event</span>
          </label>
          {refundPolicy === 'custom' && (
            <div className="ml-7 mt-2 max-w-xs">
              <input
                name="refund_window_custom_hours"
                type="number"
                min={1}
                step={1}
                required
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
                className="form-input"
                placeholder="e.g. 72"
                aria-label="Custom refund window in hours"
              />
              <p className="mt-1 text-xs text-text-tertiary">
                Hours before start. e.g. 72 = 3 days, 168 = 7 days.
              </p>
            </div>
          )}
        </div>
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

      <HostsSection
        hosts={hosts}
        onUpdateLabel={updateHostLabel}
        onRemove={removeHost}
        onAdd={addHost}
      />

      <label className="flex cursor-pointer items-center gap-3 min-h-[44px]">
        <span className="relative inline-flex items-center">
          <input
            name="is_published"
            type="checkbox"
            value="true"
            defaultChecked={event?.is_published ?? false}
            className="sr-only peer"
          />
          <span className="w-11 h-6 bg-bg-tertiary rounded-full peer peer-checked:bg-gold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-gold/50 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
        </span>
        <span className="text-sm font-medium text-text-primary">Published</span>
      </label>

      {/*
        Sticky save bar on mobile. position: sticky lets iOS Safari push
        the bar above the keyboard naturally (per the Step-2 brief — `fixed`
        causes the keyboard to occlude the bar). On lg+ this is a normal
        in-flow row with the original styling.

        bottom-16 keeps the bar above the 64px AdminSidebar bottom-nav.
        pb-[max(0.75rem,env(safe-area-inset-bottom))] handles devices with
        a home indicator. -mx-4 / -mb-4 extend the bar to the card edges
        (the wrapper is bg-bg-card border rounded-xl p-6 → effectively p-4
        on mobile after spec §1.1; we negate the horizontal padding here).
      */}
      <div className="sticky bottom-16 lg:static z-10 -mx-6 -mb-6 lg:m-0 mt-6 bg-bg-card border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:bg-transparent lg:border-0 lg:px-0 lg:py-0 lg:pt-4 lg:border-t lg:border-border">
        <div className="flex flex-col-reverse gap-3 lg:flex-row lg:items-center lg:gap-3">
          <button
            type="button"
            onClick={() => router.push('/admin/events')}
            className="border border-border text-text-primary font-medium text-sm px-8 py-3 rounded-full hover:bg-bg-secondary transition-colors min-h-[44px] w-full lg:w-auto"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="bg-gold hover:bg-gold-dark text-white font-medium text-sm px-8 py-3 rounded-full transition-colors disabled:opacity-50 min-h-[44px] w-full lg:w-auto"
          >
            {isPending ? (
              'Saving...'
            ) : isEditing ? (
              <>
                <span className="lg:hidden">Save</span>
                <span className="hidden lg:inline">Update Event</span>
              </>
            ) : (
              <>
                <span className="lg:hidden">Create</span>
                <span className="hidden lg:inline">Create Event</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Style for form inputs — 44px min-height on mobile, 36px on md+. */}
      <style jsx global>{`
        .form-input {
          width: 100%;
          min-height: 2.75rem;
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
        @media (min-width: 768px) {
          .form-input {
            min-height: 0;
          }
        }
      `}</style>
    </form>
  )
}

const HOST_ROLE_LABEL_MAX = 60
const HOST_ROLE_LABEL_COUNT_THRESHOLD = 50

function HostsSection({
  hosts,
  onUpdateLabel,
  onRemove,
  onAdd,
}: {
  hosts: HostFormRow[]
  onUpdateLabel: (profileId: string, value: string) => void
  onRemove: (profileId: string) => void
  onAdd: (member: HostPickerMember) => void
}) {
  const excludeIds = hosts.map((h) => h.profileId)
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-serif text-lg text-text-primary">Hosts</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Add the people who will be hosting this event. They&rsquo;ll appear
          on the public event page in the order shown here. If you don&rsquo;t
          add any, you&rsquo;ll be set as the sole host.
        </p>
      </div>

      {hosts.length > 0 && (
        <ul className="space-y-2">
          {hosts.map((host) => (
            <HostRow
              key={host.profileId}
              host={host}
              onChangeLabel={(v) => onUpdateLabel(host.profileId, v)}
              onRemove={() => onRemove(host.profileId)}
            />
          ))}
        </ul>
      )}

      <MemberPicker
        excludeIds={excludeIds}
        onSelect={onAdd}
        triggerLabel="Add host"
        ariaLabel="Add a host"
      />
    </section>
  )
}

function HostRow({
  host,
  onChangeLabel,
  onRemove,
}: {
  host: HostFormRow
  onChangeLabel: (value: string) => void
  onRemove: () => void
}) {
  const avatarUrl = resolveAvatarUrl(host.memberSnapshot.avatar_url)
  const initials = getInitials(host.memberSnapshot.full_name)
  const showCount = host.roleLabel.length > HOST_ROLE_LABEL_COUNT_THRESHOLD

  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-bg-card p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gold/20 bg-gold/10">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={32}
            height={32}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xs font-semibold text-gold">{initials}</span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {host.memberSnapshot.full_name}
        </span>
        <span className="mt-1 block">
          <input
            type="text"
            value={host.roleLabel}
            onChange={(e) => onChangeLabel(e.target.value)}
            placeholder="Host"
            maxLength={HOST_ROLE_LABEL_MAX}
            aria-label={`Role label for ${host.memberSnapshot.full_name}`}
            className="form-input"
          />
          {showCount && (
            <span className="mt-1 block text-xs text-text-tertiary">
              {host.roleLabel.length} / {HOST_ROLE_LABEL_MAX}
            </span>
          )}
        </span>
      </span>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${host.memberSnapshot.full_name} as host`}
        className="rounded-full p-2 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-danger min-h-[44px] min-w-[44px]"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </li>
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
  // Input lives INSIDE <label> so browsers + screen readers associate
  // them implicitly (no id/htmlFor juggling per field). The label text +
  // hint are wrapped in a block span so they render above the input as
  // before, preserving the visual layout.
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-text-primary">
        {label}
        {hint && <span className="ml-1 font-normal text-text-tertiary">({hint})</span>}
      </span>
      {children}
    </label>
  )
}
