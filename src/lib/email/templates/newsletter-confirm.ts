import {
  COLORS,
  escapeHtml,
  htmlToText,
  renderButton,
  renderShell,
} from './_shared'
import type { RenderedTemplate } from './welcome'

/**
 * Double-opt-in confirmation email. Sent immediately after someone
 * submits the newsletter signup form. The confirmation link leads to
 * /newsletter/confirm?t=<token>; only after they click are they
 * considered "confirmed" and added to the Brevo list.
 *
 * Required for UK PECR compliance — an unconfirmed email address is
 * not proof of consent.
 */

export interface NewsletterConfirmInput {
  email: string
  confirmationUrl: string
}

export function newsletterConfirmTemplate(
  input: NewsletterConfirmInput,
): RenderedTemplate {
  const subject = 'Confirm your newsletter signup — The Social Seen'

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  One more step.
</h1>

<p style="margin:0 0 16px 0;">
  Thanks for signing up to the <strong>Social Seen newsletter</strong>.
  Confirm your email below and you&rsquo;re in.
</p>

${renderButton({ label: 'Confirm my subscription', href: input.confirmationUrl })}

<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  If you didn&rsquo;t sign up, ignore this — you won&rsquo;t hear from
  us again. The request was for <span style="color:${COLORS.charcoal};">${escapeHtml(input.email)}</span>.
</p>

<p style="margin:8px 0 0 0;color:${COLORS.textSecondary};font-size:14px;">
  &mdash; The Social Seen team
</p>`

  // Deliberately NO unsubscribe link on this email — confirmation
  // emails are transactional (response to a specific user action)
  // and pre-consent. The recipient is not yet on our marketing list.
  const html = renderShell({
    previewText: 'Confirm your email to join the Social Seen newsletter.',
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
