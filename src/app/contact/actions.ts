'use server'

/**
 * Public-form Server Actions for /contact and /collaborate (P2-12, hardened
 * in Phase 2.5 Batch 1).
 *
 * These actions accept anonymous input from the public web. They MUST:
 *   - Validate strictly with zod (no DB write — just an email send).
 *   - Reject obvious bot submissions via three layers:
 *       1. Hidden honeypot field "fax_number" that real users
 *          never see. Any non-empty value = bot.
 *       2. Form-render timestamp ("ts" hidden field): submissions that
 *          arrive < 2 seconds after the page rendered are almost
 *          certainly automated.
 *       3. Cloudflare Turnstile challenge — invisible for ~99% of real
 *          users; forces a puzzle for suspicious sessions. Verifier
 *          fails open if the secret is unconfigured so local dev /
 *          early-stage preview deploys don't break. See
 *          src/lib/turnstile/verify.ts for the policy details.
 *   - Set Resend `replyTo` to the visitor's email so the team replies
 *     land in the visitor's inbox — info@the-social-seen.com is the
 *     default and would route replies back to ourselves.
 */

import { z } from 'zod'
import { headers } from 'next/headers'
import { sendEmail } from '@/lib/email/send'
import {
  contactMessageTemplate,
  type ContactSubject,
} from '@/lib/email/templates/contact-message'
import {
  collaborationPitchTemplate,
  type CollaborationType,
} from '@/lib/email/templates/collaboration-pitch'
import { REPLY_TO_ADDRESS } from '@/lib/email/config'
import {
  extractTurnstileToken,
  verifyTurnstileToken,
} from '@/lib/turnstile/verify'

// ── Bot defences ────────────────────────────────────────────────────────────

const HONEYPOT_FIELD = 'fax_number'
const MIN_SUBMIT_DELAY_MS = 2000

function isLikelyBot(formData: FormData): boolean {
  const honeypot = (formData.get(HONEYPOT_FIELD) as string | null) ?? ''
  if (honeypot.trim() !== '') return true

  const tsRaw = (formData.get('ts') as string | null) ?? ''
  const ts = Number.parseInt(tsRaw, 10)
  if (Number.isFinite(ts)) {
    const elapsed = Date.now() - ts
    if (elapsed < MIN_SUBMIT_DELAY_MS) return true
  }
  return false
}

/**
 * Read the caller's IP from common proxy headers (Vercel sets these).
 * Used only to hand to Cloudflare's siteverify for better scoring —
 * failure here just means we skip the hint.
 */
async function callerIp(): Promise<string | undefined> {
  try {
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim()
      if (first) return first
    }
    const real = h.get('x-real-ip')
    if (real) return real.trim()
  } catch {
    // headers() can throw outside a request context — ignore.
  }
  return undefined
}

// ── Bot defences (continued) — header-injection guard ──────────────────────

/**
 * Reject CRLF in any free-text field that ends up inside an SMTP header
 * (subject, To, Reply-To). Zod's `.email()` already excludes whitespace,
 * but sender-name / company-name / website land in `subject` via the
 * template — a value like `"Anna\r\nBcc: victim@example.com"` would
 * smuggle a header. Resend likely sanitises server-side, but we don't
 * rely on undocumented provider behaviour for an injection guard.
 *
 * Mirrors the same refine added on `announcementSchema.subject` in P2-9.
 */
const NO_CRLF = (label: string) =>
  z
    .string()
    .refine((v) => !/[\r\n]/.test(v), `${label} cannot contain line breaks`)

// ── Contact message ─────────────────────────────────────────────────────────

const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100)
    .pipe(NO_CRLF('Name')),
  email: z.string().trim().email('Enter a valid email address').max(200),
  subject: z.enum(['general', 'event_enquiry', 'collaboration', 'press']),
  message: z
    .string()
    .trim()
    .min(20, 'Message must be at least 20 characters')
    .max(5000, 'Message is too long (max 5000 chars)'),
})

export type ContactFormResult =
  | { success: true }
  | { error: string }

export async function sendContactMessage(
  formData: FormData,
): Promise<ContactFormResult> {
  // Bot check first — return success silently so attackers can't
  // probe the validator behaviour.
  if (isLikelyBot(formData)) {
    return { success: true }
  }

  // Turnstile — also returns silent success on failure so scrapers
  // can't distinguish "token rejected" from "message sent".
  const ip = await callerIp()
  const ts = await verifyTurnstileToken(extractTurnstileToken(formData), ip)
  if (!ts.ok) {
    return { success: true }
  }

  const parsed = contactSchema.safeParse({
    name: formData.get('name') ?? '',
    email: formData.get('email') ?? '',
    subject: formData.get('subject') ?? 'general',
    message: formData.get('message') ?? '',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { name, email, subject, message } = parsed.data

  const rendered = contactMessageTemplate({
    fromName: name,
    fromEmail: email,
    subject: subject as ContactSubject,
    bodyText: message,
  })

  const result = await sendEmail({
    to: REPLY_TO_ADDRESS,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    templateName: 'contact_message',
    replyTo: email,
    tags: [
      { name: 'template', value: 'contact_message' },
      { name: 'subject_category', value: subject },
    ],
  })

  if (!result.success) {
    // Log row was already written by sendEmail; surface a generic
    // message to the visitor without leaking the underlying provider
    // error.
    return { error: 'Could not send your message. Please try again shortly.' }
  }

  return { success: true }
}

// ── Collaboration pitch ─────────────────────────────────────────────────────

const collaborationSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, 'Company name must be at least 2 characters')
    .max(150)
    .pipe(NO_CRLF('Company name')),
  contactName: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100)
    .pipe(NO_CRLF('Name')),
  contactEmail: z.string().trim().email('Enter a valid email address').max(200),
  collaborationType: z.enum(['venue', 'brand', 'sponsor', 'press', 'other']),
  website: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine(
      (v) => v === null || /^https?:\/\//.test(v),
      'Website must start with http:// or https://',
    )
    .refine(
      (v) => v === null || !/[\r\n]/.test(v),
      'Website cannot contain line breaks',
    ),
  message: z
    .string()
    .trim()
    .min(20, 'Message must be at least 20 characters')
    .max(5000, 'Message is too long (max 5000 chars)'),
})

export type CollaborationFormResult =
  | { success: true }
  | { error: string }

export async function sendCollaborationPitch(
  formData: FormData,
): Promise<CollaborationFormResult> {
  if (isLikelyBot(formData)) {
    return { success: true }
  }

  const ip = await callerIp()
  const ts = await verifyTurnstileToken(extractTurnstileToken(formData), ip)
  if (!ts.ok) {
    return { success: true }
  }

  const parsed = collaborationSchema.safeParse({
    companyName: formData.get('company_name') ?? '',
    contactName: formData.get('contact_name') ?? '',
    contactEmail: formData.get('contact_email') ?? '',
    collaborationType: formData.get('collaboration_type') ?? 'other',
    website: formData.get('website') ?? undefined,
    message: formData.get('message') ?? '',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }
  const { companyName, contactName, contactEmail, collaborationType, website, message } =
    parsed.data

  const rendered = collaborationPitchTemplate({
    companyName,
    contactName,
    contactEmail,
    collaborationType: collaborationType as CollaborationType,
    website,
    bodyText: message,
  })

  const result = await sendEmail({
    to: REPLY_TO_ADDRESS,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    templateName: 'collaboration_pitch',
    replyTo: contactEmail,
    tags: [
      { name: 'template', value: 'collaboration_pitch' },
      { name: 'collaboration_type', value: collaborationType },
    ],
  })

  if (!result.success) {
    return { error: 'Could not send your pitch. Please try again shortly.' }
  }

  return { success: true }
}
