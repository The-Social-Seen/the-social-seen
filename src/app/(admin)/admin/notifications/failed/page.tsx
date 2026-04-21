import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getFailedNotifications } from '../../actions'
import FailedNotificationsTable from '@/components/admin/FailedNotificationsTable'

export const metadata = {
  title: 'Failed Notifications — Admin — The Social Seen',
}

export default async function FailedNotificationsPage() {
  const notifications = await getFailedNotifications()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/notifications"
          className="p-2 rounded-lg hover:bg-bg-secondary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Back to notifications"
        >
          <ArrowLeft className="w-5 h-5 text-text-tertiary" />
        </Link>
        <div>
          <h1 className="font-serif text-2xl text-text-primary">
            Failed notifications
          </h1>
          <p className="text-sm text-text-tertiary">
            Email sends the system logged as failed. Use Retry to re-fire the
            same subject/body to the same recipient.
          </p>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-6">
        <FailedNotificationsTable notifications={notifications} />
      </div>
    </div>
  )
}
