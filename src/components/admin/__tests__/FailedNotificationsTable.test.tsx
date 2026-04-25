// @vitest-environment jsdom
//
// Viewport + touch-target tests for the admin FailedNotificationsTable.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/(admin)/admin/actions', () => ({
  retryNotification: vi.fn(),
}))

import FailedNotificationsTable from '../FailedNotificationsTable'
import type { FailedNotification } from '@/app/(admin)/admin/actions'

const failed = (overrides: Partial<FailedNotification> = {}): FailedNotification => ({
  id: 'n-1',
  template_name: 'event_reminder',
  subject: 'Reminder: Wine & Wisdom tonight',
  body: 'See you at 7pm.',
  recipient_email: 'charlotte@example.com',
  error_message: 'SMTP timeout',
  sent_at: '2026-04-10T12:00:00.000Z',
  retried_at: null,
  ...overrides,
})

describe('FailedNotificationsTable — mobile pass', () => {
  it('renders the empty state when there are no failures', () => {
    render(<FailedNotificationsTable notifications={[]} />)
    expect(screen.getByText(/no failed notifications/i)).toBeTruthy()
  })

  it('renders BOTH the desktop table and the mobile card list', () => {
    const { container } = render(
      <FailedNotificationsTable notifications={[failed()]} />
    )
    expect(container.querySelector('div.hidden.md\\:block table')).toBeTruthy()
    const mobileList = container.querySelector('ul.md\\:hidden')
    expect(mobileList).toBeTruthy()
    expect(mobileList?.querySelectorAll('li').length).toBe(1)
  })

  it('mobile card surfaces template name, recipient, subject, and error message', () => {
    const { container } = render(
      <FailedNotificationsTable notifications={[failed()]} />
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.textContent).toContain('event_reminder')
    expect(card.textContent).toContain('charlotte@example.com')
    expect(card.textContent).toContain('Reminder: Wine & Wisdom tonight')
    expect(card.textContent).toContain('SMTP timeout')
  })

  it('mobile Retry button is full-width with min-h-[44px] (touch-target compliance)', () => {
    const { container } = render(
      <FailedNotificationsTable notifications={[failed()]} />
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    const actionRow = card.querySelector('div.border-t') as HTMLElement
    const retryBtn = actionRow.querySelector('button') as HTMLButtonElement
    expect(retryBtn).toBeTruthy()
    expect(retryBtn.textContent).toContain('Retry')
    expect(retryBtn.className).toContain('w-full')
    expect(retryBtn.className).toContain('min-h-[44px]')
  })

  it('mobile card shows last-retry timestamp when retried_at is set', () => {
    const { container } = render(
      <FailedNotificationsTable
        notifications={[failed({ retried_at: '2026-04-11T08:00:00.000Z' })]}
      />
    )
    const card = container.querySelector('ul.md\\:hidden article') as HTMLElement
    expect(card.textContent?.toLowerCase()).toContain('last retry')
  })
})
