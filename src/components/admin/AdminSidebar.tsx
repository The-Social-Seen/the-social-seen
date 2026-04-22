'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Calendar,
  Users,
  Star,
  Bell,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/admin', icon: LayoutDashboard },
  { label: 'Events', href: '/admin/events', icon: Calendar },
  { label: 'Members', href: '/admin/members', icon: Users },
  { label: 'Reviews', href: '/admin/reviews', icon: Star },
  { label: 'Notifications', href: '/admin/notifications', icon: Bell },
]

interface AdminSidebarProps {
  adminName: string
  adminAvatarUrl: string | null
  /**
   * Count of `notifications` rows with channel='email' status='failed'.
   * Rendered as a small pill on the Notifications nav item when > 0
   * so admins notice new failures without clicking through.
   */
  failedNotificationsCount?: number
}

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin'
  return pathname.startsWith(href)
}

function FailedBadge({ count }: { count: number }) {
  if (count <= 0) return null
  const display = count > 99 ? '99+' : String(count)
  return (
    <span
      aria-label={`${count} failed notification${count === 1 ? '' : 's'}`}
      className="ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold leading-5 text-white"
    >
      {display}
    </span>
  )
}

export default function AdminSidebar({
  adminName,
  adminAvatarUrl,
  failedNotificationsCount = 0,
}: AdminSidebarProps) {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-charcoal dark:bg-[var(--color-bg-primary)]">
        {/* Logo */}
        <div className="flex items-center px-6 h-16 border-b border-white/10">
          <Link href="/admin" className="font-serif text-lg tracking-wide text-gold">
            THE SOCIAL <span className="italic">SEEN</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Admin navigation">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            const isNotifications = item.href === '/admin/notifications'
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-white/10 text-white'
                    : 'text-[var(--color-text-tertiary)] hover:bg-white/5 hover:text-white'
                )}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {item.label}
                {isNotifications && (
                  <FailedBadge count={failedNotificationsCount} />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Admin profile */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 rounded-full overflow-hidden bg-gold/20 shrink-0">
              {adminAvatarUrl ? (
                <Image
                  src={adminAvatarUrl}
                  alt={adminName}
                  fill
                  className="object-cover"
                  sizes="36px"
                />
              ) : (
                <span className="flex items-center justify-center w-full h-full text-sm font-medium text-gold">
                  {adminName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{adminName}</p>
              <p className="text-xs text-gold">Admin</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-charcoal dark:bg-[var(--color-bg-primary)] border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
        aria-label="Admin navigation"
      >
        <div className="flex items-center justify-around h-16">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            const isNotifications = item.href === '/admin/notifications'
            const showBadge =
              isNotifications && failedNotificationsCount > 0
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[44px] min-h-[44px]',
                  active ? 'text-gold' : 'text-[var(--color-text-tertiary)]'
                )}
                aria-current={active ? 'page' : undefined}
                aria-label={
                  showBadge
                    ? `${item.label} — ${failedNotificationsCount} failed`
                    : item.label
                }
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
                {showBadge && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 min-w-[16px] rounded-full bg-danger px-1 text-[9px] font-semibold leading-4 text-white"
                  >
                    {failedNotificationsCount > 99
                      ? '99+'
                      : failedNotificationsCount}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
