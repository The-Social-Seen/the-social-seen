import { type LucideIcon } from 'lucide-react'

interface KPICardProps {
  icon: LucideIcon
  label: string
  value: string
  trend?: string
}

export default function KPICard({ icon: Icon, label, value, trend }: KPICardProps) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-6">
      <div className="flex items-start justify-between">
        <Icon className="w-5 h-5 text-gold" />
        {trend && (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full">
            {trend}
          </span>
        )}
      </div>
      <p className="mt-4 font-serif text-3xl text-text-primary">{value}</p>
      <p className="mt-1 text-sm text-text-tertiary">{label}</p>
    </div>
  )
}
