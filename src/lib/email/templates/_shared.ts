/**
 * Shared building blocks for transactional email templates.
 *
 * Inline styles only — most email clients (Gmail, Outlook, Apple Mail
 * web) strip <style> tags and don't support CSS custom properties.
 * Brand hex values are intentionally hardcoded here; this is the ONE
 * place in the codebase where literal hex is acceptable per CLAUDE.md.
 */

export const COLORS = {
  charcoal: '#1C1C1E', // primary text + dark surfaces
  cream: '#FAF7F2', // page background
  gold: '#C9A96E', // CTAs and accents
  goldDark: '#B8944F', // CTA hover (display only — emails are static)
  white: '#FFFFFF',
  textSecondary: '#6B6B6B',
  border: '#E8E4DE',
} as const

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
const SERIF_STACK =
  'Georgia, "Times New Roman", Times, serif'

/**
 * Wraps body content in the standard branded chrome: header wordmark,
 * single-column 600px max-width, footer with contact + unsubscribe.
 *
 * `previewText` is the snippet most email clients show next to the
 * subject in the inbox list — keep it short and useful.
 *
 * `unsubscribeUrl` — if provided, renders a working one-click unsubscribe
 * link. Transactional emails (booking confirmation, OTP, venue reveal,
 * event reminder, cancellation, refund, welcome) pass no URL and the
 * footer shows no unsubscribe — those emails are either direct responses
 * to user actions or required to deliver the service the user booked.
 *
 * Per UK PECR, marketing-adjacent templates (review_requests,
 * profile_nudges, admin_announcements) MUST pass an unsubscribe URL;
 * the Node `sendEmail` wrapper + Deno edge function refuse to send if
 * preferences say opt-out.
 */
export function renderShell({
  previewText,
  bodyHtml,
  unsubscribeUrl,
}: {
  previewText: string
  bodyHtml: string
  unsubscribeUrl?: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Social Seen</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.cream};font-family:${FONT_STACK};color:${COLORS.charcoal};">
<!-- Preview text — hidden in body but shown in inbox preview -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(previewText)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLORS.cream};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${COLORS.white};border:1px solid ${COLORS.border};border-radius:12px;overflow:hidden;">
        <!-- Header wordmark -->
        <tr>
          <td align="center" style="padding:32px 24px 16px 24px;border-bottom:1px solid ${COLORS.border};">
            <div style="font-family:${SERIF_STACK};font-size:24px;font-weight:bold;color:${COLORS.charcoal};letter-spacing:0.01em;">
              The Social <span style="color:${COLORS.gold};font-style:italic;">Seen</span>
            </div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 24px;font-size:16px;line-height:1.6;color:${COLORS.charcoal};">
${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px;background-color:${COLORS.cream};border-top:1px solid ${COLORS.border};font-size:12px;color:${COLORS.textSecondary};text-align:center;">
            <p style="margin:0 0 8px 0;">
              The Social Seen &middot; London
            </p>
            <p style="margin:0 0 8px 0;">
              Questions? <a href="mailto:info@the-social-seen.com" style="color:${COLORS.gold};text-decoration:none;">info@the-social-seen.com</a>
            </p>
            ${
              unsubscribeUrl
                ? `<p style="margin:0;">
              <a href="${escapeAttr(unsubscribeUrl)}" style="color:${COLORS.textSecondary};text-decoration:underline;">Unsubscribe from these emails</a>
            </p>`
                : ''
            }
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

/**
 * Inline-styled CTA button. Use sparingly — one per email is the norm.
 */
export function renderButton({
  label,
  href,
}: {
  label: string
  href: string
}): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;">
  <tr>
    <td align="center" style="border-radius:9999px;background-color:${COLORS.gold};">
      <a href="${escapeAttr(href)}" style="display:inline-block;padding:14px 32px;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${COLORS.white};text-decoration:none;border-radius:9999px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`
}

/**
 * Render a key/value detail row inside a card body. Used for booking
 * confirmation event details (date, time, venue, etc.).
 */
export function renderDetailRow({
  label,
  value,
}: {
  label: string
  value: string
}): string {
  return `<tr>
  <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};width:120px;vertical-align:top;">${escapeHtml(label)}</td>
  <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};font-weight:500;">${escapeHtml(value)}</td>
</tr>`
}

/**
 * Strip all HTML tags from a string to produce a plain-text fallback.
 * Email clients with HTML disabled (and most spam scanners) read this.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    // Decode named/numeric entities BEFORE &amp; — otherwise input like
    // `&amp;lt;` (which displays as literal `&lt;` in HTML) would become
    // `&lt;` then `<`, losing the original meaning.
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Curly quotes / em-dash / ellipsis used by the templates — emit real
    // Unicode in the text fallback, not literal entity refs.
    .replace(/&rsquo;/g, '\u2019') // \u2019 right single quote
    .replace(/&lsquo;/g, '\u2018') // \u2018 left single quote
    .replace(/&rdquo;/g, '\u201D') // \u201D right double quote
    .replace(/&ldquo;/g, '\u201C') // \u201C left double quote
    .replace(/&mdash;/g, '\u2014') // \u2014 em dash
    .replace(/&ndash;/g, '\u2013') // \u2013 en dash
    .replace(/&hellip;/g, '\u2026') // \u2026 horizontal ellipsis
    .replace(/&middot;/g, '\u00B7') // \u00B7 middle dot
    // &amp; LAST so the rules above process the inner entities first.
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Escape user-supplied content for HTML body. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape user-supplied content for HTML attribute values. */
export function escapeAttr(s: string): string {
  return escapeHtml(s)
}

/**
 * Best-effort base URL for absolute links inside emails.
 * Resend recipients may open the email anywhere — relative URLs don't work.
 */
export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : 'https://the-social-seen.vercel.app')
  )
}
