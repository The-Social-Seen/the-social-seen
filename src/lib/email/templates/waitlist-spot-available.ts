import {
  COLORS,
  escapeHtml,
  getSiteUrl,
  htmlToText,
  renderButton,
  renderDetailRow,
  renderShell,
} from './_shared'
import type { RenderedTemplate } from './welcome'

export interface WaitlistSpotAvailableInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string // formatted, e.g. "Wednesday 7 May"
  eventTime: string // formatted, e.g. "7:00 PM"
  /**
   * Paid events show the price in the CTA copy so recipients know
   * they'll be charged when they claim. Free events omit it.
   */
  priceInPence: number
}

/**
 * Sent to every waitlisted member when a confirmed attendee cancels.
 * First-to-click-and-pay wins — the email explicitly calls this out so
 * recipients understand position on the waitlist isn't a guarantee.
 *
 * CTA links to `/events/<slug>?claim=1` which renders a "Claim Spot"
 * button that runs the `claimWaitlistSpot` Server Action. The RPC is
 * atomic: if another recipient claims first, the button returns a
 * race-lost error and the original waitlist entry stays put.
 */
export function waitlistSpotAvailableTemplate(
  input: WaitlistSpotAvailableInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()
  const claimUrl = `${siteUrl}/events/${input.eventSlug}?claim=1`

  const isPaid = input.priceInPence > 0
  // Format pence → £pounds with pence. 3500 → "£35". 3550 → "£35.50".
  const priceLabel = isPaid
    ? `£${(input.priceInPence / 100).toFixed(
        input.priceInPence % 100 === 0 ? 0 : 2,
      )}`
    : 'Free'

  const subject = `A spot just opened: ${input.eventTitle}`

  const ctaLabel = isPaid ? `Claim spot (${priceLabel})` : 'Claim your spot'

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  A spot just opened.
</h1>

<p style="margin:0 0 16px 0;">
  Hi ${escapeHtml(firstName)} &mdash; someone just cancelled their booking
  for <strong>${escapeHtml(input.eventTitle)}</strong>, which means a spot
  is up for grabs.
</p>

<p style="margin:0 0 24px 0;font-size:14px;color:${COLORS.textSecondary};">
  <strong>First to claim it wins</strong> &mdash; we&rsquo;ve emailed
  everyone on the waitlist at the same time, so tap below to book before
  someone else does.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow({ label: 'Event', value: input.eventTitle })}
  ${renderDetailRow({ label: 'Date', value: input.eventDate })}
  ${renderDetailRow({ label: 'Time', value: input.eventTime })}
  ${renderDetailRow({ label: isPaid ? 'Price' : 'Cost', value: priceLabel })}
</table>

${renderButton({ label: ctaLabel, href: claimUrl })}

${isPaid
  ? `<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">You&rsquo;ll be taken to our secure checkout. Payment only completes when you confirm.</p>`
  : ''}

<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  If someone else claims it first, no problem &mdash; you&rsquo;re still on
  the waitlist and we&rsquo;ll email again if another spot opens.
</p>`

  const html = renderShell({
    previewText: `${input.eventTitle} \u2014 first to claim wins.`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
