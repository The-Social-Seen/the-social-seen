// Deno-side template rendering for the daily-notifications edge function.
//
// These mirror the shape of src/lib/email/templates/* on the Node side.
// Kept in sync by convention — if you change one, change the other. The
// Node versions are exercised by the Vitest suite (src/lib/email/**).
//
// Inline styles only. Brand hex is hardcoded (same documented exception
// as the Node templates).

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
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&middot;/g, '\u00B7')
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
        <p style="margin:0;"><a href="#" style="color:${COLORS.textSecondary};text-decoration:underline;">Unsubscribe</a></p>
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

export interface Rendered {
  subject: string
  html: string
  text: string
}

// ── Venue reveal ─────────────────────────────────────────────────────────────

export interface VenueRevealInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string
  eventTime: string
  venueName: string
  venueAddress: string
  postcode: string | null
  siteUrl: string
}

export function venueRevealTemplate(input: VenueRevealInput): Rendered {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const eventUrl = `${input.siteUrl}/events/${input.eventSlug}`
  const mapsQuery = [input.venueName, input.venueAddress, input.postcode]
    .filter(Boolean)
    .join(', ')
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
  const addressLine = input.postcode
    ? `${input.venueAddress}, ${input.postcode}`
    : input.venueAddress

  const subject = `Venue revealed: ${input.eventTitle}`
  const body = `<h1 style="margin:0 0 16px 0;font-family:${SERIF_STACK};font-size:28px;font-weight:bold;color:${COLORS.charcoal};">The venue is revealed.</h1>
<p style="margin:0 0 24px 0;">Hi ${escapeHtml(firstName)} &mdash; one week to go until <strong>${escapeHtml(input.eventTitle)}</strong>. Here&rsquo;s where we&rsquo;re meeting.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow('Event', input.eventTitle)}
  ${renderDetailRow('Date', input.eventDate)}
  ${renderDetailRow('Time', input.eventTime)}
  ${renderDetailRow('Venue', input.venueName)}
  ${renderDetailRow('Address', addressLine)}
</table>
${renderButton('Get Directions', mapsUrl)}
<p style="margin:16px 0 0 0;font-size:14px;color:${COLORS.textSecondary};text-align:center;">Or <a href="${escapeAttr(eventUrl)}" style="color:${COLORS.gold};text-decoration:none;">view the event page</a>.</p>
<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">Can&rsquo;t make it? Cancel from <a href="${input.siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a> so someone on the waitlist can take your spot.</p>`
  const html = renderShell(`${input.venueName} \u2014 ${input.eventDate} at ${input.eventTime}`, body)
  return { subject, html, text: htmlToText(html) }
}

// ── Event reminder (2-day or day-of) ────────────────────────────────────────

export type ReminderVariant = '2day' | 'today'

export interface EventReminderInput {
  variant: ReminderVariant
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string
  eventTime: string
  venueName: string
  venueAddress: string
  postcode: string | null
  venueRevealed: boolean
  dressCode: string | null
  siteUrl: string
}

export function eventReminderTemplate(input: EventReminderInput): Rendered {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const eventUrl = `${input.siteUrl}/events/${input.eventSlug}`

  const copy = input.variant === 'today'
    ? {
        subject: `Tonight: ${input.eventTitle}`,
        preview: `See you at ${input.eventTitle} \u2014 ${input.eventTime}`,
        heading: 'Tonight\u2019s the night.',
        lead: `Looking forward to seeing you at <strong>${escapeHtml(input.eventTitle)}</strong> later.`,
        ctaLabel: 'View Event Details',
      }
    : {
        subject: `In 2 days: ${input.eventTitle}`,
        preview: `${input.eventTitle} is coming up in 2 days`,
        heading: 'Just a heads-up.',
        lead: `<strong>${escapeHtml(input.eventTitle)}</strong> is in 2 days. Here&rsquo;s a quick reminder.`,
        ctaLabel: 'View Event',
      }

  const venueValue = input.venueRevealed
    ? [input.venueName, input.venueAddress, input.postcode].filter(Boolean).join(', ')
    : 'Revealed 1 week before the event'

  const dressCodeRow = input.dressCode ? renderDetailRow('Dress code', input.dressCode) : ''

  const body = `<h1 style="margin:0 0 16px 0;font-family:${SERIF_STACK};font-size:28px;font-weight:bold;color:${COLORS.charcoal};">${copy.heading}</h1>
<p style="margin:0 0 24px 0;">Hi ${escapeHtml(firstName)} &mdash; ${copy.lead}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow('Date', input.eventDate)}
  ${renderDetailRow('Time', input.eventTime)}
  ${renderDetailRow('Venue', venueValue)}
  ${dressCodeRow}
</table>
${renderButton(copy.ctaLabel, eventUrl)}
<p style="margin:24px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">Plans changed? Cancel at <a href="${input.siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a> so someone else can take your spot.</p>`
  const html = renderShell(copy.preview, body)
  return { subject: copy.subject, html, text: htmlToText(html) }
}

// ── Review request ──────────────────────────────────────────────────────────

export interface ReviewRequestInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  siteUrl: string
}

export function reviewRequestTemplate(input: ReviewRequestInput): Rendered {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const reviewUrl = `${input.siteUrl}/events/${input.eventSlug}#review`

  const subject = `How was ${input.eventTitle}?`
  const body = `<h1 style="margin:0 0 16px 0;font-family:${SERIF_STACK};font-size:28px;font-weight:bold;color:${COLORS.charcoal};">How was it?</h1>
<p style="margin:0 0 16px 0;">Hi ${escapeHtml(firstName)} &mdash; thanks for coming to <strong>${escapeHtml(input.eventTitle)}</strong>. We hope it was a good one.</p>
<p style="margin:0 0 16px 0;">A quick review helps other members decide which events to book, and helps us shape what we put on next. Takes 30 seconds.</p>
${renderButton('Leave a Review', reviewUrl)}
<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">See you at the next one.</p>
<p style="margin:8px 0 0 0;color:${COLORS.textSecondary};font-size:14px;">&mdash; The Social Seen team</p>`
  const html = renderShell('A quick review helps other members pick events.', body)
  return { subject, html, text: htmlToText(html) }
}

// ── Profile completion nudge ────────────────────────────────────────────────

export interface ProfileNudgeInput {
  fullName: string
  /** 0–100 integer percentage. Always < 50 when this template fires. */
  completionScore: number
  /** Up to 3 human-readable labels of high-impact missing fields. */
  topMissingLabels: string[]
  siteUrl: string
}

export function profileNudgeTemplate(input: ProfileNudgeInput): Rendered {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const profileUrl = `${input.siteUrl}/profile`
  const subject = 'Finish setting up your profile'

  const missingHtml = input.topMissingLabels.length
    ? `<ul style="margin:0 0 24px 0;padding-left:20px;color:${COLORS.charcoal};">${input.topMissingLabels
        .map(
          (l) =>
            `<li style="margin:0 0 4px 0;">${escapeHtml(l)}</li>`,
        )
        .join('')}</ul>`
    : ''

  const body = `<h1 style="margin:0 0 16px 0;font-family:${SERIF_STACK};font-size:28px;font-weight:bold;color:${COLORS.charcoal};">A few more details and you&rsquo;re set.</h1>
<p style="margin:0 0 16px 0;">Hi ${escapeHtml(firstName)} &mdash; welcome to The Social Seen. Your profile is currently <strong>${input.completionScore}%</strong> complete.</p>
<p style="margin:0 0 16px 0;">Members with a fuller profile get more out of events &mdash; hosts know who they&rsquo;re welcoming, and other members can find common ground before turning up. The biggest wins:</p>
${missingHtml}
${renderButton('Complete My Profile', profileUrl)}
<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">See you at an event soon.</p>
<p style="margin:8px 0 0 0;color:${COLORS.textSecondary};font-size:14px;">&mdash; The Social Seen team</p>`
  const html = renderShell(
    `Your profile is ${input.completionScore}% complete \u2014 a few quick wins below.`,
    body,
  )
  return { subject, html, text: htmlToText(html) }
}
