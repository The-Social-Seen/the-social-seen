import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'

/**
 * Admin layout — protects all routes under (admin)/.
 * Redirects unauthenticated users to /login.
 * Redirects non-admin users to /.
 * Renders the sidebar + content shell.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, avatar_url')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    redirect('/')
  }

  // Failed-send count — surfaces as a badge on the "Notifications"
  // sidebar entry so admins notice new failures without having to
  // click through. `count` head-only query (no rows returned).
  const { count: failedCount } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'email')
    .eq('status', 'failed')

  return (
    <div className="min-h-screen bg-bg-primary">
      <AdminSidebar
        adminName={profile.full_name ?? 'Admin'}
        adminAvatarUrl={profile.avatar_url ?? null}
        failedNotificationsCount={failedCount ?? 0}
      />

      {/* Content area */}
      <main className="lg:pl-64 pb-20 lg:pb-0">
        <div className="p-6">{children}</div>
      </main>
    </div>
  )
}
