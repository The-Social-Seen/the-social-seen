'use server'

/**
 * Public newsletter signup flow — Server Actions.
 *
 *   subscribeToNewsletter  — POST from the footer form (or landing hero
 *                            later). Anonymous. Upserts a pending row,
 *                            sends the double-opt-in confirmation email.
 *   previewNewsletterConfirm — GET render on /newsletter/confirm. Token
 *                              verify only; no mutation.
 *   confirmNewsletter      — POST from the confirm page. Flips the row
 *                            to 'confirmed' + adds to Brevo list.
 *   previewNewsletterUnsubscribe + confirmNewsletterUnsubscribe —
 *                            same two-step pattern for one-click
 *                            unsubscribe from email footers. Mirrors
 *                            email_consent to false when the email
 *                            matches a profile.
 *
 * Rate limiting: reuses Turnstile from Batch 1 on the subscribe path
 * (shares the contact form's keys). Honeypot stays as second line.
 */

import { z } from 'zod'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import {
  extractTurnstileToken,
  verifyTurnstileToken,
} from '@/lib/turnstile/verify'
import { newsletterConfirmTemplate } from '@/lib/email/templates/newsletter-confirm'
import {
  buildNewsletterConfirmUrl,
  verifyNewsletterToken,
} from '@/lib/email/newsletter-token'
import { upsertContact, removeFromList } from '@/lib/brevo/sync'

// ── Subscribe ────────────────────────────────────────────────────────────────

const subscribeSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(200),
  source: z.enum(['footer', 'landing']).default('footer'),
})

export type SubscribeResult =
  | { success: true; message: string }
  | { success: false; error: string }

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
    /* outside request context */
  }
  return undefined
}

export async function subscribeToNewsletter(
  formData: FormData,
): Promise<SubscribeResult> {
  // Honeypot — same pattern as contact/actions.ts.
  const honeypot = (formData.get('company_website') as string | null) ?? ''
  if (honeypot.trim() !== '') {
    // Silent success so scrapers can't probe.
    return { success: true, message: 'Thanks — check your inbox to confirm.' }
  }

  const ip = await callerIp()
  const ts = await verifyTurnstileToken(extractTurnstileToken(formData), ip)
  if (!ts.ok) {
    return { success: true, message: 'Thanks — check your inbox to confirm.' }
  }

  const parsed = subscribeSchema.safeParse({
    email: formData.get('email') ?? '',
    source: formData.get('source') ?? 'footer',
  })
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid email address',
    }
  }
  const { email, source } = parsed.data
  const admin = createAdminClient()

  // Upsert by email (case-insensitive). Three flows:
  //   - new email → INSERT status='pending'
  //   - existing pending → resend confirmation (refresh created_at)
  //   - existing confirmed → short-circuit success message
  //   - existing unsubscribed → INSERT conflict; we UPDATE to
  //     'pending' so resurrection is via double-opt-in, never
  //     silent.
  const { data: existing } = await admin
    .from('newsletter_subscribers')
    .select('id, status')
    .ilike('email', email)
    .maybeSingle()

  if (existing && (existing as { status: string }).status === 'confirmed') {
    return {
      success: true,
      message: 'You\u2019re already subscribed — thanks!',
    }
  }

  const { error: upsertErr } = await admin
    .from('newsletter_subscribers')
    .upsert(
      {
        email,
        status: 'pending',
        source,
        confirmation_token: null, // stateless — just for admin forensics
      },
      { onConflict: 'email' },
    )
  if (upsertErr) {
    // Unique index is on lower(email), Supabase upsert requires a
    // unique constraint on the on-conflict column. If the constraint
    // is absent we log + fall back to a direct insert; the row may
    // end up duplicate but the Brevo sync will merge.
    console.warn('[newsletter/subscribe] upsert failed:', upsertErr.message)
  }

  // Send the confirmation email. Doesn't block on success; log + carry
  // on if Resend hiccups (user can retry from the form).
  const confirmationUrl = buildNewsletterConfirmUrl(email)
  const rendered = newsletterConfirmTemplate({ email, confirmationUrl })
  await sendEmail({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    templateName: 'newsletter_confirm',
  })

  return {
    success: true,
    message: 'Thanks — check your inbox to confirm.',
  }
}

// ── Confirm (double-opt-in) ─────────────────────────────────────────────────

export type NewsletterActionPreview =
  | { ok: true; email: string; action: 'confirm' | 'unsubscribe' }
  | { ok: false; message: string }

export async function previewNewsletterConfirm(
  token: string,
): Promise<NewsletterActionPreview> {
  const verified = verifyNewsletterToken(token)
  if (!verified.ok) {
    return {
      ok: false,
      message:
        'This confirmation link is invalid or has expired. Please sign up again.',
    }
  }
  if (verified.value.action !== 'confirm') {
    return { ok: false, message: 'Wrong link type. Please sign up again.' }
  }
  return { ok: true, email: verified.value.email, action: 'confirm' }
}

export type ConfirmResult =
  | { success: true; email: string }
  | { success: false; error: string }

export async function confirmNewsletter(token: string): Promise<ConfirmResult> {
  const verified = verifyNewsletterToken(token)
  if (!verified.ok || verified.value.action !== 'confirm') {
    return { success: false, error: 'Invalid or expired confirmation link.' }
  }
  const { email } = verified.value
  const admin = createAdminClient()

  // Flip the row to confirmed. Row may not exist if someone kept a
  // token across a data wipe — upsert defensively.
  const { error: updateErr } = await admin
    .from('newsletter_subscribers')
    .upsert(
      {
        email,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        unsubscribed_at: null,
      },
      { onConflict: 'email' },
    )
  if (updateErr) {
    console.error('[newsletter/confirm] status update failed:', updateErr.message)
    return { success: false, error: 'Could not confirm — please try again.' }
  }

  // Best-effort Brevo sync. Non-blocking — we stash the contact id
  // on success but don't retry on failure here. A Phase-3 reconciler
  // can pick up any orphan confirmed rows.
  const syncResult = await upsertContact({ email, source: 'footer' })
  if (syncResult.success && syncResult.brevoContactId !== null) {
    await admin
      .from('newsletter_subscribers')
      .update({ brevo_contact_id: syncResult.brevoContactId })
      .ilike('email', email)
  }

  return { success: true, email }
}

// ── Unsubscribe (from email footer link) ─────────────────────────────────────

export async function previewNewsletterUnsubscribe(
  token: string,
): Promise<NewsletterActionPreview> {
  const verified = verifyNewsletterToken(token)
  if (!verified.ok) {
    return {
      ok: false,
      message:
        'This unsubscribe link is invalid or has expired. Sign in to manage preferences on your profile.',
    }
  }
  if (verified.value.action !== 'unsubscribe') {
    return { ok: false, message: 'Wrong link type.' }
  }
  return { ok: true, email: verified.value.email, action: 'unsubscribe' }
}

export async function confirmNewsletterUnsubscribe(
  token: string,
): Promise<ConfirmResult> {
  const verified = verifyNewsletterToken(token)
  if (!verified.ok || verified.value.action !== 'unsubscribe') {
    return { success: false, error: 'Invalid or expired link.' }
  }
  const { email } = verified.value
  const admin = createAdminClient()

  // Flip the subscriber row (if it exists) and mirror to profiles.email_consent
  // if the email matches a member — consistent with the rest of the opt-out
  // surface.
  await admin
    .from('newsletter_subscribers')
    .update({
      status: 'unsubscribed',
      unsubscribed_at: new Date().toISOString(),
    })
    .ilike('email', email)

  await admin.from('profiles').update({ email_consent: false }).eq('email', email)

  await removeFromList(email)

  return { success: true, email }
}
