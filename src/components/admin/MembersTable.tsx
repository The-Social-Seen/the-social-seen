'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useTransition } from 'react'
import Image from 'next/image'
import { Download, Search } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils/cn'
import { exportMembersCSV } from '@/app/(admin)/admin/actions'
import type { MemberWithStats } from '@/types'

interface MembersTableProps {
  members: MemberWithStats[]
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'most_active', label: 'Most Active' },
  { value: 'alphabetical', label: 'Alphabetical' },
] as const

export default function MembersTable({ members }: MembersTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [isExporting, startExport] = useTransition()

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
      {/* Search + Sort + Export */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
          />
        </div>

        <select
          value={currentSort}
          onChange={(e) => handleSort(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {isExporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-text-tertiary py-8 text-center">No members found</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-3 font-medium text-text-tertiary">Name</th>
                <th className="pb-3 font-medium text-text-tertiary hidden md:table-cell">Email</th>
                <th className="pb-3 font-medium text-text-tertiary hidden lg:table-cell">Job Title</th>
                <th className="pb-3 font-medium text-text-tertiary hidden lg:table-cell">Company</th>
                <th className="pb-3 font-medium text-text-tertiary hidden md:table-cell">Events</th>
                <th className="pb-3 font-medium text-text-tertiary hidden md:table-cell">Joined</th>
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
                  <td className="py-3 pr-4 text-text-secondary hidden md:table-cell truncate max-w-[200px]">
                    {member.email}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary hidden lg:table-cell">
                    {member.job_title ?? '—'}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary hidden lg:table-cell">
                    {member.company ?? '—'}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary hidden md:table-cell">
                    {member.events_attended}
                  </td>
                  <td className="py-3 pr-4 text-text-tertiary hidden md:table-cell whitespace-nowrap">
                    {formatDistanceToNow(new Date(member.created_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
