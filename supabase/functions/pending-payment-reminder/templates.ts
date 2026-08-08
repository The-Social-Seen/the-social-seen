// Deno-side template rendering for the pending-payment-reminder edge
// function.
//
// Mirrors the shape of src/lib/email/templates/pending-payment-reminder.ts
// on the Node side (same copy — UX-REVIEW-pending-payment-visibility.md
// §7 — same _shared.ts-style primitives, just Deno-local instead of
// imported). Kept in sync by convention, same as
// daily-notifications/templates.ts mirrors its Node counterparts. The
// Node version is exercised by the Vitest suite
// (src/lib/email/templates/__tests__/); this Deno copy is exercised (if
// at all) only by manual Edge Function invocation — if you change one,
// change the other.
//
// Inline styles only. Brand hex is hardcoded (same documented exception
// as the Node templates — see _shared.ts's own comment).

const COLORS = {
  charcoal: '#1C1C1E',
  cream: '#FAF7F2',
  gold: '#C9A96E',
  white: '#FFFFFF',
  textSecondary: '#6B6B6B',
  border: '#E8E4DE',
} as const

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
const SERIF_STACK = 'Georgia, "Times New Roman", Times, serif'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const escapeAttr = escapeHtml

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderShell(previewText: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The Social Seen</title></head>
<body style="margin:0;padding:0;background-color:${COLORS.cream};font-family:${FONT_STACK};color:${COLORS.charcoal};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(previewText)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLORS.cream};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${COLORS.white};border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">
      <tr><td align="center" style="padding:32px 24px 16px 24px;border-bottom:1px solid ${COLORS.border};">
        <div style="font-family:${SERIF_STACK};font-size:24px;font-weight:bold;color:${COLORS.charcoal};letter-spacing:0.01em;">
          The Social <span style="color:${COLORS.gold};font-style:italic;">Seen</span>
        </div>
      </td></tr>
      <tr><td style="padding:32px 24px;font-size:16px;line-height:1.6;color:${COLORS.charcoal};">${bodyHtml}</td></tr>
      <tr><td style="padding:24px;background-color:${COLORS.cream};border-top:1px solid ${COLORS.border};font-size:12px;color:${COLORS.textSecondary};text-align:center;">
        <p style="margin:0 0 8px 0;">The Social Seen &middot; London</p>
        <p style="margin:0 0 8px 0;">Questions? <a href="mailto:info@the-social-seen.com" style="color:${COLORS.gold};text-decoration:none;">info@the-social-seen.com</a></p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`
}

function renderButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;">
  <tr><td align="center" style="border-radius:9999px;background-color:${COLORS.gold};">
    <a href="${escapeAttr(href)}" style="display:inline-block;padding:14px 32px;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${COLORS.white};text-decoration:none;border-radius:9999px;">${escapeHtml(label)}</a>
  </td></tr></table>`
}

function renderDetailRow(label: string, value: string): string {
  return `<tr>
  <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};width:120px;vertical-align:top;">${escapeHtml(label)}</td>
  <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};font-weight:500;">${escapeHtml(value)}</td>
</tr>`
}

function formatPriceExact(pence: number): string {
  const pounds = pence / 100
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pounds)
}

export interface Rendered {
  subject: string
  html: string
  text: string
}

// ── Pending-payment reminder ────────────────────────────────────────────────

export interface PendingPaymentReminderInput {
  fullName: string
  eventTitle: string
  eventDate: string
  eventTime: string
  priceInPence: number
  bookingFeePence: number
  /** App URL (`{SITE_URL}/bookings/resume/{bookingId}`) — NOT a Stripe
   *  URL. See SYSTEM-DESIGN-pending-payment-visibility.md §1's
   *  corollary — the fresh Checkout Session is minted at click time by
   *  that route, not at send time here. */
  resumeUrl: string
  /** Pre-formatted deadline string, e.g. "Saturday 14 March, 3:00 PM". */
  deadline: string
  siteUrl: string
}

export function pendingPaymentReminderTemplate(
  input: PendingPaymentReminderInput,
): Rendered {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const totalPence = input.priceInPence + input.bookingFeePence
  const totalLabel = formatPriceExact(totalPence)

  const subject = `Reminder: complete payment for ${input.eventTitle}`

  const body = `<h1 style="margin:0 0 16px 0;font-family:${SERIF_STACK};font-size:28px;font-weight:bold;color:${COLORS.charcoal};">Your spot&rsquo;s on hold.</h1>
<p style="margin:0 0 16px 0;">Hi ${escapeHtml(firstName)} &mdash; looks like you started booking <strong>${escapeHtml(input.eventTitle)}</strong> but didn&rsquo;t get to finish. Your spot isn&rsquo;t confirmed yet, but we&rsquo;re holding it for you a little longer.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow('Event', input.eventTitle)}
  ${renderDetailRow('Date', input.eventDate)}
  ${renderDetailRow('Time', input.eventTime)}
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0 0;">
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};">Ticket</td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;">${escapeHtml(formatPriceExact(input.priceInPence))}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};">Booking fee</td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;">${escapeHtml(formatPriceExact(input.bookingFeePence))}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};border-top:1px solid ${COLORS.border};"><strong>Total</strong></td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;border-top:1px solid ${COLORS.border};"><strong>${escapeHtml(totalLabel)}</strong></td>
  </tr>
</table>
<p style="margin:8px 0 0 0;font-size:12px;color:${COLORS.textSecondary};">The booking fee covers card processing and isn&rsquo;t refundable.</p>
${renderButton(`Complete Payment (${totalLabel})`, input.resumeUrl)}
<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">Complete payment by <strong>${escapeHtml(input.deadline)}</strong> &mdash; after that, we&rsquo;ll release the spot so someone else can have it.</p>
<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">Changed your mind? No need to do anything &mdash; the hold will simply expire and we&rsquo;ll let it go. You can review this (or any of your bookings) any time at <a href="${input.siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a>.</p>`

  const html = renderShell('Your spot is on hold — finish up when you’re ready.', body)
  return { subject, html, text: htmlToText(html) }
}
