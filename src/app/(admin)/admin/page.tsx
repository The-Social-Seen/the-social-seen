import { Users, Calendar, PoundSterling, Star } from 'lucide-react'
import {
  getDashboardStats,
  getMonthlyBookings,
  getRecentActivity,
} from './actions'
import { formatPrice } from '@/lib/utils/currency'
import KPICard from '@/components/admin/KPICard'
import BookingsChart from '@/components/admin/BookingsChart'
import RecentActivity from '@/components/admin/RecentActivity'

export const metadata = {
  title: 'Admin Dashboard — The Social Seen',
}

export default async function AdminDashboardPage() {
  const [stats, monthlyBookings, recentActivity] = await Promise.all([
    getDashboardStats(),
    getMonthlyBookings(),
    getRecentActivity(),
  ])

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl text-text-primary">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          icon={Users}
          label="Total Members"
          value={stats.totalMembers.toLocaleString()}
          trend="↗ 12%"
        />
        <KPICard
          icon={Calendar}
          label="Upcoming Events"
          value={stats.upcomingEvents.toString()}
          trend="↗ 8%"
        />
        <KPICard
          icon={PoundSterling}
          label="Revenue This Month"
          value={formatPrice(stats.revenueThisMonth)}
          trend="↗ 23%"
        />
        <KPICard
          icon={Star}
          label="Avg Rating"
          value={stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '—'}
        />
      </div>

      {/* Chart + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <BookingsChart data={monthlyBookings} />
        </div>
        <div>
          <RecentActivity items={recentActivity} />
        </div>
      </div>
    </div>
  )
}
