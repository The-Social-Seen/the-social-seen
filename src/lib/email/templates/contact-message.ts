import {
  COLORS,
  escapeHtml,
  htmlToText,
  renderDetailRow,
  renderShell,
} from './_shared'
import type { RenderedTemplate } from './welcome'

export type ContactSubject =
  | 'general'
  | 'event_enquiry'
  | 'collaboration'
  | 'press'

const SUBJECT_LABELS: Record<ContactSubject, string> = {
  general: 'General enquiry',
  event_enquiry: 'Event enquiry',
  collaboration: 'Collaboration',
  press: 'Press',
}

export interface ContactMessageInput {
  /** Sender's name as typed in the form. */
  fromName: string
  /** Sender's email — used as `replyTo` when delivered. */
  fromEmail: string
  /** Subject category from the dropdown. */
  subject: ContactSubject
  /** Plain-text body. Rendered as preserved-newline paragraphs. */
  bodyText: string
}

/**
 * Sent to the team support inbox when a public visitor submits the
 * `/contact` form. The originating user's email is attached as `replyTo`
 * by the dispatching Server Action so the team can reply directly from
 * their inbox without leaking sender details.
 */
export function contactMessageTemplate(
  input: ContactMessageInput,
): RenderedTemplate {
  const subjectLabel = SUBJECT_LABELS[input.subject]
  const subject = `[Contact \u2014 ${subjectLabel}] ${input.fromName}`

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
  New contact message
</h1>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0 0 24px 0;">
  ${renderDetailRow({ label: 'From', value: input.fromName })}
  ${renderDetailRow({ label: 'Email', value: input.fromEmail })}
  ${renderDetailRow({ label: 'Topic', value: subjectLabel })}
</table>

${paragraphs}

<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Reply directly to this email &mdash; the sender&rsquo;s address is set as the
  reply-to.
</p>`

  const html = renderShell({
    previewText: `${subjectLabel} from ${input.fromName}`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}

export const CONTACT_SUBJECT_OPTIONS: Array<{
  value: ContactSubject
  label: string
}> = [
  { value: 'general', label: SUBJECT_LABELS.general },
  { value: 'event_enquiry', label: SUBJECT_LABELS.event_enquiry },
  { value: 'collaboration', label: SUBJECT_LABELS.collaboration },
  { value: 'press', label: SUBJECT_LABELS.press },
]
