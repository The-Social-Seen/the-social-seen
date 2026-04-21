import {
  COLORS,
  escapeHtml,
  htmlToText,
  renderShell,
} from './_shared'
import type { RenderedTemplate } from './welcome'

export interface OtpVerificationInput {
  code: string
}

/**
 * Branded replacement for Supabase's default OTP email.
 *
 * NOT YET WIRED into the verification flow — Supabase still mails the
 * OTP via its own SMTP service. To activate this template, configure
 * Supabase to use Resend as its SMTP provider (Auth → Settings → SMTP
 * via the Management API), or build a custom OTP issuance path that
 * generates + emails the code ourselves. Logged in FOLLOW-UPS.md.
 *
 * The template is built and tested now so the wiring step is purely
 * configuration when we're ready.
 */
export function otpVerificationTemplate({
  code,
}: OtpVerificationInput): RenderedTemplate {
  const subject = `Your verification code: ${code}`

  // Render the code as a large, monospaced, letter-spaced box for easy
  // reading on mobile. Inline styles only — no <style> tag.
  const codeBlock = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;">
  <tr>
    <td align="center" style="padding:20px 32px;background-color:${COLORS.cream};border:1px solid ${COLORS.border};border-radius:12px;">
      <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:32px;font-weight:bold;letter-spacing:0.4em;color:${COLORS.charcoal};padding-left:0.4em;">${escapeHtml(code)}</div>
    </td>
  </tr>
</table>`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  Verify your email
</h1>

<p style="margin:0 0 8px 0;">
  Enter this code on the verification page to confirm your email and
  unlock event bookings.
</p>

${codeBlock}

<p style="margin:24px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  This code expires in 10 minutes. If you didn&rsquo;t request it, you can
  safely ignore this email.
</p>`

  const html = renderShell({
    previewText: `Your code: ${code}`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
