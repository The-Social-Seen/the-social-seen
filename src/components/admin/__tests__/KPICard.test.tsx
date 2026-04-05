// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Users } from 'lucide-react'
import KPICard from '../KPICard'

describe('KPICard', () => {
  it('renders the value and label', () => {
    render(<KPICard icon={Users} label="Total Members" value="1,024" />)
    expect(screen.getByText('1,024')).toBeTruthy()
    expect(screen.getByText('Total Members')).toBeTruthy()
  })

  it('renders the trend badge when provided', () => {
    render(<KPICard icon={Users} label="Total Members" value="1,024" trend="↗ 12%" />)
    expect(screen.getByText('↗ 12%')).toBeTruthy()
  })

  it('does not render trend badge when not provided', () => {
    const { container } = render(<KPICard icon={Users} label="Total Members" value="1,024" />)
    // No element with emerald/trend styling
    expect(container.querySelector('.bg-emerald-50')).toBeNull()
  })

  it('renders the icon', () => {
    const { container } = render(<KPICard icon={Users} label="Members" value="10" />)
    // Lucide renders an svg element
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
