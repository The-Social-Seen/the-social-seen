import { type LucideIcon } from 'lucide-react'

interface KPICardProps {
  icon: LucideIcon
  label: string
  value: string
  trend?: string
}

export default function KPICard({ icon: Icon, label, value, trend }: KPICardProps) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4 md:p-6">
      <div className="flex items-start justify-between gap-2">
        <Icon className="w-5 h-5 text-gold shrink-0" />
        {trend && (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full whitespace-nowrap">
            {trend}
          </span>
        )}
      </div>
      <p className="mt-3 md:mt-4 font-serif text-2xl md:text-3xl text-text-primary truncate">
        {value}
      </p>
      <p className="mt-1 text-xs md:text-sm text-text-tertiary">{label}</p>
    </div>
  )
}
