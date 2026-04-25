'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useTransition } from 'react'
import Image from 'next/image'
import { Download, Search, ShieldAlert } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils/cn'
import { exportMembersCSV } from '@/app/(admin)/admin/actions'
import type { MemberWithStats, UserStatus } from '@/types'
import MemberModerationDialog from './MemberModerationDialog'

interface MembersTableProps {
  members: MemberWithStats[]
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'most_active', label: 'Most Active' },
  { value: 'alphabetical', label: 'Alphabetical' },
] as const

function statusBadge(status: UserStatus) {
  switch (status) {
    case 'active':
      return (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
          Active
        </span>
      )
    case 'suspended':
      return (
        <span className="rounded-full bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
          Suspended
        </span>
      )
    case 'banned':
      return (
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950/30 dark:text-red-400">
          Banned
        </span>
      )
  }
}

export default function MembersTable({ members }: MembersTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [isExporting, startExport] = useTransition()
  const [moderating, setModerating] = useState<{
    id: string
    full_name: string
    status: UserStatus
  } | null>(null)

  // Debounced search via URL params
  useEffect(() => {
    const timeout = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (search.trim()) {
        params.set('search', search.trim())
      } else {
        params.delete('search')
      }
      router.replace(`/admin/members?${params.toString()}`)
    }, 400)
    return () => clearTimeout(timeout)
  }, [search, router, searchParams])

  function handleSort(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('sort', value)
    router.replace(`/admin/members?${params.toString()}`)
  }

  function handleExport() {
    startExport(async () => {
      const csv = await exportMembersCSV(searchParams.get('search') ?? undefined)
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'members.csv'
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  const currentSort = searchParams.get('sort') ?? 'newest'

  return (
    <div className="space-y-4">
      {/* Search + Sort + Export — vertical stack on mobile, horizontal on md+ */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            aria-label="Search members by name or email"
            className="w-full pl-9 pr-3 h-11 md:h-9 rounded-lg border border-border bg-bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
          />
        </div>

        <label className="flex flex-col gap-1 md:flex-row md:items-center md:gap-2">
          <span className="text-xs text-text-tertiary md:hidden">Sort by</span>
          <select
            value={currentSort}
            onChange={(e) => handleSort(e.target.value)}
            aria-label="Sort members"
            className="w-full md:w-auto px-3 h-11 md:h-9 rounded-lg border border-border bg-bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-gold border border-gold/40 rounded-full w-full h-11 md:w-auto md:h-auto md:border-0 md:rounded-none md:px-0 md:text-text-secondary md:hover:bg-transparent md:hover:text-text-primary hover:bg-gold/5 transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {isExporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-text-tertiary py-8 text-center">No members found</p>
      ) : (
        <>
          {/* Desktop table (≥ md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-3 font-medium text-text-tertiary">Name</th>
                  <th className="pb-3 font-medium text-text-tertiary">Email</th>
                  <th className="pb-3 font-medium text-text-tertiary hidden lg:table-cell">Job Title</th>
                  <th className="pb-3 font-medium text-text-tertiary hidden lg:table-cell">Company</th>
                  <th className="pb-3 font-medium text-text-tertiary">Events</th>
                  <th className="pb-3 font-medium text-text-tertiary">Joined</th>
                  <th className="pb-3 font-medium text-text-tertiary">Status</th>
                  <th className="pb-3 font-medium text-text-tertiary text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-bg-secondary/50 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div className="relative w-8 h-8 rounded-full overflow-hidden bg-gold/20 shrink-0">
                          {member.avatar_url ? (
                            <Image
                              src={member.avatar_url}
                              alt={member.full_name}
                              fill
                              className="object-cover"
                              sizes="32px"
                            />
                          ) : (
                            <span className="flex items-center justify-center w-full h-full text-xs font-medium text-gold">
                              {member.full_name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <span className="font-medium text-text-primary truncate max-w-[160px]">
                          {member.full_name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-text-secondary truncate max-w-[200px]">
                      {member.email}
                    </td>
                    <td className="py-3 pr-4 text-text-secondary hidden lg:table-cell">
                      {member.job_title ?? '—'}
                    </td>
                    <td className="py-3 pr-4 text-text-secondary hidden lg:table-cell">
                      {member.company ?? '—'}
                    </td>
                    <td className="py-3 pr-4 text-text-secondary">
                      {member.events_attended}
                    </td>
                    <td className="py-3 pr-4 text-text-tertiary whitespace-nowrap">
                      {formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}
                    </td>
                    <td className="py-3 pr-4">
                      {statusBadge(member.status)}
                    </td>
                    <td className="py-3 text-right">
                      {member.role === 'admin' ? (
                        <span className="text-xs text-text-tertiary">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setModerating({
                              id: member.id,
                              full_name: member.full_name,
                              status: member.status,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-text-primary hover:bg-bg-secondary"
                        >
                          <ShieldAlert className="h-3 w-3" />
                          Moderate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (< md) */}
          <ul className="md:hidden space-y-3">
            {members.map((member) => {
              const isAdmin = member.role === 'admin'
              return (
                <li key={member.id}>
                  <article className="rounded-lg border border-border bg-bg-card p-4 space-y-3">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="relative w-10 h-10 rounded-full overflow-hidden bg-gold/20 shrink-0">
                          {member.avatar_url ? (
                            <Image
                              src={member.avatar_url}
                              alt={member.full_name}
                              fill
                              className="object-cover"
                              sizes="40px"
                            />
                          ) : (
                            <span className="flex items-center justify-center w-full h-full text-sm font-medium text-gold">
                              {member.full_name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-text-primary truncate">
                            {member.full_name}
                          </p>
                          <p
                            className="text-xs text-text-tertiary truncate"
                            title={member.email}
                          >
                            {member.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {statusBadge(member.status)}
                        {isAdmin && (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-gold">
                            Admin
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Body */}
                    <dl className="space-y-1.5 text-sm">
                      {member.job_title && (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-text-tertiary">Title</dt>
                          <dd className="text-text-secondary text-right truncate max-w-[60%]">
                            {member.job_title}
                          </dd>
                        </div>
                      )}
                      {member.company && (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-text-tertiary">Company</dt>
                          <dd className="text-text-secondary text-right truncate max-w-[60%]">
                            {member.company}
                          </dd>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-text-tertiary">Events</dt>
                        <dd className="text-text-secondary">{member.events_attended}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-text-tertiary">Joined</dt>
                        <dd className="text-text-secondary">
                          {formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}
                        </dd>
                      </div>
                    </dl>

                    {/* Action row — only for non-admin members */}
                    {!isAdmin && (
                      <div className="flex items-center border-t border-border pt-3">
                        <button
                          type="button"
                          onClick={() =>
                            setModerating({
                              id: member.id,
                              full_name: member.full_name,
                              status: member.status,
                            })
                          }
                          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full border border-border text-sm font-medium text-text-primary hover:bg-bg-secondary transition-colors min-h-[44px]"
                        >
                          <ShieldAlert className="h-4 w-4" />
                          Moderate
                        </button>
                      </div>
                    )}
                  </article>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {moderating && (
        <MemberModerationDialog
          open={true}
          member={moderating}
          onClose={() => setModerating(null)}
        />
      )}
    </div>
  )
}
