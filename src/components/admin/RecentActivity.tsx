import { formatDistanceToNow } from 'date-fns'

interface ActivityItem {
  id: string
  status: string
  created_at: string
  user_name: string
  event_title: string
}

interface RecentActivityProps {
  items: ActivityItem[]
}

function statusLabel(status: string) {
  switch (status) {
    case 'confirmed':
      return 'booked'
    case 'waitlisted':
      return 'joined waitlist for'
    case 'cancelled':
      return 'cancelled'
    default:
      return status
  }
}

export default function RecentActivity({ items }: RecentActivityProps) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-6">
      <h3 className="font-serif text-lg text-text-primary mb-4">Recent Activity</h3>

      {items.length === 0 ? (
        <p className="text-sm text-text-tertiary">No recent activity</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3">
              <span
                className="mt-1.5 w-2 h-2 rounded-full bg-gold shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary">
                  <span className="font-medium">{item.user_name}</span>{' '}
                  {statusLabel(item.status)}{' '}
                  <span className="font-medium">{item.event_title}</span>
                </p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
