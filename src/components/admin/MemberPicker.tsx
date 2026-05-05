'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { Plus, Search } from 'lucide-react'
import {
  listMembersForHostPicker,
  type HostPickerMember,
} from '@/app/(admin)/admin/actions'
import { resolveAvatarUrl, getInitials } from '@/lib/utils/images'

interface MemberPickerProps {
  /** Currently-selected member IDs — these are excluded from the dropdown */
  excludeIds?: string[]
  /** Called when the user picks a member */
  onSelect: (member: HostPickerMember) => void
  /** Trigger button label */
  triggerLabel?: string
  /** ARIA label for the trigger button */
  ariaLabel?: string
}

export default function MemberPicker({
  excludeIds = [],
  onSelect,
  triggerLabel = 'Add member',
  ariaLabel = 'Add a member',
}: MemberPickerProps) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<HostPickerMember[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Fetch the member list lazily — first time the picker opens. Cached
  // for the lifetime of the component so reopening is instant.
  useEffect(() => {
    if (!open || members !== null) return
    let cancelled = false
    listMembersForHostPicker()
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load members. Try again.')
      })
    return () => {
      cancelled = true
    }
  }, [open, members])

  // Focus the search input when the panel opens; return focus to the
  // trigger when it closes.
  useEffect(() => {
    if (open) {
      searchRef.current?.focus()
    } else {
      triggerRef.current?.focus()
    }
  }, [open])

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds])

  const trimmedQuery = query.trim()

  const filtered = useMemo(() => {
    if (!members) return []
    const q = trimmedQuery.toLowerCase()
    return members
      .filter((m) => !excludeSet.has(m.id))
      .filter((m) => {
        if (!q) return true
        const haystack = [m.full_name, m.job_title ?? '', m.company ?? '']
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
  }, [members, excludeSet, trimmedQuery])

  function handlePick(member: HostPickerMember) {
    onSelect(member)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-card px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:border-gold hover:text-gold min-h-[44px]"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        {triggerLabel}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={ariaLabel}
          className="absolute left-0 z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-bg-card shadow-xl shadow-charcoal/10"
        >
          <div className="relative border-b border-border p-3">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members"
              className="w-full rounded-lg border border-border bg-bg-card py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-gold/50"
              aria-label="Filter members"
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {loadError ? (
              <p className="px-4 py-6 text-center text-sm text-danger">
                {loadError}
              </p>
            ) : members === null ? (
              <MemberRowsSkeleton />
            ) : filtered.length === 0 ? (
              // Empty-state copy is host-specific because this picker has only
              // one consumer today (EventForm hosts). When a second consumer
              // arrives, lift these strings to an optional `messages?` prop
              // rather than continuing to overload the meaning here.
              <p className="px-4 py-6 text-center text-sm text-text-tertiary">
                {members.length === 0
                  ? 'No members available.'
                  : trimmedQuery !== ''
                    ? 'No members match your search.'
                    : 'All other active members are already hosting this event.'}
              </p>
            ) : (
              filtered.map((m) => <MemberRow key={m.id} member={m} onPick={handlePick} />)
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MemberRow({
  member,
  onPick,
}: {
  member: HostPickerMember
  onPick: (m: HostPickerMember) => void
}) {
  const avatarUrl = resolveAvatarUrl(member.avatar_url)
  const initials = getInitials(member.full_name)
  const subtitleParts = [member.job_title, member.company].filter(Boolean) as string[]
  const subtitle = subtitleParts.join(' • ')

  return (
    <button
      type="button"
      onClick={() => onPick(member)}
      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-bg-secondary focus:bg-bg-secondary focus:outline-none"
    >
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
          {member.full_name}
        </span>
        {subtitle && (
          <span className="block truncate text-xs text-text-tertiary">
            {subtitle}
          </span>
        )}
      </span>
    </button>
  )
}

function MemberRowsSkeleton() {
  return (
    <div className="px-3 py-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <div className="h-8 w-8 shrink-0 rounded-full bg-bg-secondary" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded bg-bg-secondary" />
            <div className="h-2.5 w-20 rounded bg-bg-secondary" />
          </div>
        </div>
      ))}
    </div>
  )
}
