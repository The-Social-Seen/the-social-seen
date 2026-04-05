'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface BookingsChartProps {
  data: { month: string; count: number }[]
}

export default function BookingsChart({ data }: BookingsChartProps) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-6">
      <h3 className="font-serif text-lg text-text-primary mb-4">Monthly Bookings</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--color-border)"
          />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12, fill: 'var(--color-text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--color-text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              fontSize: '13px',
            }}
            labelStyle={{ color: 'var(--color-text-primary)' }}
            itemStyle={{ color: 'var(--color-gold)' }}
            cursor={{ fill: 'var(--color-bg-secondary)', opacity: 0.5 }}
          />
          <Bar
            dataKey="count"
            name="Bookings"
            fill="var(--color-gold)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
