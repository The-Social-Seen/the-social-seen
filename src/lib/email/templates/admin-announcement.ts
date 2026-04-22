import {
  COLORS,
  escapeHtml,
  getSiteUrl,
  htmlToText,
  renderButton,
  renderShell,
} from './_shared'
import { buildUnsubscribeUrl } from '../unsubscribe-token'
import type { RenderedTemplate } from './welcome'

export interface AdminAnnouncementInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  /** Admin-supplied subject line — sent as-is (no template prefix). */
  subject: string
  /**
   * Admin-supplied plain-text body. Rendered as paragraph blocks split on
   * blank lines. HTML is escaped — admins type plain text in the form.
   */
  bodyText: string
  /** Recipient's profile id — used to build the unsubscribe token. */
  userId: string
}

/**
 * Sent when an admin uses the "Email All Attendees" action on an event.
 * Plain-text body wrapped in the standard branded shell + a CTA back to
 * the event page. One row per recipient is logged in `notifications` so
 * the GDPR scrub (`sanitise_user_notifications`) can find it later.
 */
export function adminAnnouncementTemplate(
  input: AdminAnnouncementInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()
  const eventUrl = `${siteUrl}/events/${input.eventSlug}`

  // Split body on blank lines into paragraphs. Each line within a
  // paragraph stays on its own line via <br>.
  const paragraphs = input.bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n')

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;font-weight:bold;color:${COLORS.charcoal};">
  ${escapeHtml(input.subject)}
</h1>

<p style="margin:0 0 24px 0;color:${COLORS.textSecondary};font-size:14px;">
  Hi ${escapeHtml(firstName)} &mdash; an update about <strong style="color:${COLORS.charcoal};">${escapeHtml(input.eventTitle)}</strong>.
</p>

${paragraphs}

${renderButton({ label: 'View Event', href: eventUrl })}`

  const html = renderShell({
    previewText: input.subject,
    bodyHtml,
    unsubscribeUrl: buildUnsubscribeUrl(input.userId, 'admin_announcements'),
  })

  return {
    subject: input.subject,
    html,
    text: htmlToText(html),
  }
}
