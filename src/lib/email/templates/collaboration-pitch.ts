import {
  COLORS,
  escapeHtml,
  htmlToText,
  renderDetailRow,
  renderShell,
} from './_shared'
import type { RenderedTemplate } from './welcome'

export type CollaborationType =
  | 'venue'
  | 'brand'
  | 'sponsor'
  | 'press'
  | 'other'

const COLLAB_LABELS: Record<CollaborationType, string> = {
  venue: 'Venue partnership',
  brand: 'Brand partnership',
  sponsor: 'Event sponsor',
  press: 'Press / media',
  other: 'Other',
}

export interface CollaborationPitchInput {
  /** Pitching company / organisation name. */
  companyName: string
  /** Contact person at the pitching company. */
  contactName: string
  /** Contact email — used as `replyTo`. */
  contactEmail: string
  /** Collaboration category from the dropdown. */
  collaborationType: CollaborationType
  /** Optional company website. */
  website: string | null
  /** Plain-text pitch body. */
  bodyText: string
}

/**
 * Sent to the partnerships inbox when a brand / venue / sponsor pitches
 * via the public `/collaborate` form. Routes to the same support inbox
 * as `/contact` for now; can be split to a partnerships@ alias later.
 */
export function collaborationPitchTemplate(
  input: CollaborationPitchInput,
): RenderedTemplate {
  const typeLabel = COLLAB_LABELS[input.collaborationType]
  const subject = `[Collab \u2014 ${typeLabel}] ${input.companyName}`

  const paragraphs = input.bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n')

  const websiteRow = input.website
    ? renderDetailRow({ label: 'Website', value: input.website })
    : ''

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;font-weight:bold;color:${COLORS.charcoal};">
  New collaboration pitch
</h1>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0 0 24px 0;">
  ${renderDetailRow({ label: 'Company', value: input.companyName })}
  ${renderDetailRow({ label: 'Contact', value: input.contactName })}
  ${renderDetailRow({ label: 'Email', value: input.contactEmail })}
  ${renderDetailRow({ label: 'Type', value: typeLabel })}
  ${websiteRow}
</table>

${paragraphs}

<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Reply directly to this email &mdash; the contact&rsquo;s address is set as
  the reply-to.
</p>`

  const html = renderShell({
    previewText: `${typeLabel} pitch from ${input.companyName}`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}

export const COLLABORATION_TYPE_OPTIONS: Array<{
  value: CollaborationType
  label: string
}> = [
  { value: 'venue', label: COLLAB_LABELS.venue },
  { value: 'brand', label: COLLAB_LABELS.brand },
  { value: 'sponsor', label: COLLAB_LABELS.sponsor },
  { value: 'press', label: COLLAB_LABELS.press },
  { value: 'other', label: COLLAB_LABELS.other },
]
