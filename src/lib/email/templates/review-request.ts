import {
  COLORS,
  escapeHtml,
  getSiteUrl,
  htmlToText,
  renderButton,
  renderShell,
} from './_shared'
import type { RenderedTemplate } from './welcome'

export interface ReviewRequestInput {
  fullName: string
  eventTitle: string
  eventSlug: string
}

/**
 * Sent the day after an event to every confirmed attendee. Links to the
 * event page anchored at the review form. Reviews are
 * verified-attendee-only — the link assumes the user is logged in; the
 * page handles auth redirect if not.
 */
export function reviewRequestTemplate(
  input: ReviewRequestInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()
  const reviewUrl = `${siteUrl}/events/${input.eventSlug}#review`

  const subject = `How was ${input.eventTitle}?`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  How was it?
</h1>

<p style="margin:0 0 16px 0;">
  Hi ${escapeHtml(firstName)} &mdash; thanks for coming to
  <strong>${escapeHtml(input.eventTitle)}</strong>. We hope it was a good one.
</p>

<p style="margin:0 0 16px 0;">
  A quick review helps other members decide which events to book, and helps
  us shape what we put on next. Takes 30 seconds.
</p>

${renderButton({ label: 'Leave a Review', href: reviewUrl })}

<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  See you at the next one.
</p>
<p style="margin:8px 0 0 0;color:${COLORS.textSecondary};font-size:14px;">
  &mdash; The Social Seen team
</p>`

  const html = renderShell({
    previewText: `A quick review helps other members pick events.`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
