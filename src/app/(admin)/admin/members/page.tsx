import { Suspense } from 'react'
import { getAdminMembers } from '../actions'
import MembersTable from '@/components/admin/MembersTable'

export const metadata = {
  title: 'Members — Admin — The Social Seen',
}

interface PageProps {
  searchParams: Promise<{ search?: string; sort?: string }>
}

export default async function AdminMembersPage({ searchParams }: PageProps) {
  const { search, sort } = await searchParams
  const members = await getAdminMembers(search, sort)

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl text-text-primary">Members</h1>

      <div className="bg-bg-card border border-border rounded-xl p-6">
        <Suspense fallback={<div className="h-64 animate-shimmer rounded-lg" />}>
          <MembersTable members={members} />
        </Suspense>
      </div>
    </div>
  )
}
