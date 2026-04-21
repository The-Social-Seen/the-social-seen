import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getNotificationHistory } from '../actions'
import NotificationForm from '@/components/admin/NotificationForm'

export const metadata = {
  title: 'Notifications — Admin — The Social Seen',
}

export default async function AdminNotificationsPage() {
  const history = await getNotificationHistory()

  // Normalise Supabase join
  const normalised = history.map((n) => ({
    ...n,
    sender: Array.isArray(n.sender) ? n.sender[0] : n.sender,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-serif text-2xl text-text-primary">Notifications</h1>
        <Link
          href="/admin/notifications/failed"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-bg-secondary transition-colors text-sm font-medium text-text-primary min-h-[44px]"
        >
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Failed sends
        </Link>
      </div>

      {/* Send form */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <h2 className="font-serif text-lg text-text-primary mb-4">Send Notification</h2>
        <NotificationForm />
      </div>

      {/* History */}
      <div className="bg-bg-card border border-border rounded-xl p-6">
        <h2 className="font-serif text-lg text-text-primary mb-4">History</h2>
        {normalised.length === 0 ? (
          <p className="text-sm text-text-tertiary">No notifications sent yet</p>
        ) : (
          <ul className="divide-y divide-border">
            {normalised.map((n) => {
              const sender = n.sender as { id: string; full_name: string; avatar_url: string | null } | null
              return (
                <li key={n.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary">{n.subject}</p>
                      <p className="text-xs text-text-tertiary mt-0.5">
                        To: <span className="capitalize">{n.recipient_type.replace('_', ' ')}</span>
                        {' · '}
                        By {sender?.full_name ?? 'Admin'}
                      </p>
                    </div>
                    <span className="text-xs text-text-tertiary whitespace-nowrap shrink-0">
                      {formatDistanceToNow(new Date(n.sent_at), { addSuffix: true })}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
