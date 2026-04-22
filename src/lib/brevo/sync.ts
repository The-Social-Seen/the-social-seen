import 'server-only'

/**
 * Brevo list-sync helpers — upsert / remove / delete subscribers via
 * the Brevo REST API. Direct fetch, no SDK. Reference docs:
 *   - POST /v3/contacts                                 (upsert)
 *   - POST /v3/contacts/lists/{listId}/contacts/remove  (detach from list)
 *   - DELETE /v3/contacts/{email}                       (hard delete)
 *
 * Every helper is fail-soft: Brevo outage shouldn't break signup.
 * Failures log to console + Sentry (tagged surface='brevo-sync') and
 * return a structured error; callers decide whether to surface to
 * the user or retry.
 *
 * The source of truth is our `newsletter_subscribers` table plus the
 * member's `profiles.email_consent` flag. Brevo's list MIRRORS that
 * state — drift (user opted out in Brevo but we still say confirmed)
 * is resolved on the next write-through.
 */
import * as Sentry from '@sentry/nextjs'
import { BREVO_API_BASE, BREVO_LIST_ID, brevoHeaders, isBrevoConfigured } from './client'

export interface SyncContactInput {
  email: string
  /** Profile full_name if known. Maps to Brevo's FIRSTNAME attribute. */
  fullName?: string | null
  /** Attribution tag. Stored on the Brevo contact as SIGNUP_SOURCE. */
  source?: 'footer' | 'landing' | 'profile' | 'import'
}

export type SyncResult =
  | { success: true; brevoContactId: number | null }
  | { success: false; error: string }

/**
 * Upsert (create-or-update) a contact and attach them to the
 * newsletter list. Brevo returns 201 with body {id} on create,
 * 204 with no body on update — we surface the id when we get it
 * so callers can stash it on `newsletter_subscribers.brevo_contact_id`.
 */
export async function upsertContact(
  input: SyncContactInput,
): Promise<SyncResult> {
  if (!isBrevoConfigured()) {
    return { success: false, error: 'brevo_not_configured' }
  }

  const firstName = input.fullName?.trim().split(/\s+/)[0]
  const payload = {
    email: input.email,
    listIds: [BREVO_LIST_ID],
    updateEnabled: true,
    attributes: {
      ...(firstName ? { FIRSTNAME: firstName } : {}),
      ...(input.source ? { SIGNUP_SOURCE: input.source } : {}),
    },
  }

  try {
    const response = await fetch(`${BREVO_API_BASE}/contacts`, {
      method: 'POST',
      headers: brevoHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Brevo ${response.status}: ${body}`)
    }
    // 201 returns { id }; 204 returns no body (update path).
    const text = await response.text()
    let brevoContactId: number | null = null
    if (text.trim().length > 0) {
      try {
        const parsed = JSON.parse(text) as { id?: number }
        if (typeof parsed.id === 'number') brevoContactId = parsed.id
      } catch {
        /* not JSON, ignore */
      }
    }
    return { success: true, brevoContactId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[brevo/sync] upsertContact failed:', message)
    Sentry.captureException(err, {
      tags: { surface: 'brevo-sync', op: 'upsert' },
    })
    return { success: false, error: message }
  }
}

/**
 * Remove a contact from the newsletter list. Does NOT delete the
 * contact entirely — the contact record remains in Brevo with any
 * other lists intact; we just detach from THIS list. For full GDPR
 * wipe use `deleteContact` below.
 */
export async function removeFromList(email: string): Promise<SyncResult> {
  if (!isBrevoConfigured()) {
    return { success: false, error: 'brevo_not_configured' }
  }
  try {
    const response = await fetch(
      `${BREVO_API_BASE}/contacts/lists/${BREVO_LIST_ID}/contacts/remove`,
      {
        method: 'POST',
        headers: brevoHeaders(),
        body: JSON.stringify({ emails: [email] }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (response.ok) return { success: true, brevoContactId: null }

    const body = await response.text()
    // Brevo returns 400 "Contact already removed" on repeat calls —
    // treat as success. Match on message text because the error code
    // shape varies.
    if (body.toLowerCase().includes('already removed')) {
      return { success: true, brevoContactId: null }
    }
    throw new Error(`Brevo ${response.status}: ${body}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[brevo/sync] removeFromList failed:', message)
    Sentry.captureException(err, {
      tags: { surface: 'brevo-sync', op: 'remove' },
    })
    return { success: false, error: message }
  }
}

/**
 * Hard-delete a contact entirely. Called from the GDPR account-
 * deletion flow so Brevo doesn't retain the PII after Article 17
 * erasure. Use sparingly — for pause/opt-out use removeFromList.
 *
 * Returns success when the contact didn't exist (404), since that's
 * the desired end state for GDPR.
 */
export async function deleteContact(email: string): Promise<SyncResult> {
  if (!isBrevoConfigured()) {
    return { success: false, error: 'brevo_not_configured' }
  }
  try {
    const response = await fetch(
      `${BREVO_API_BASE}/contacts/${encodeURIComponent(email)}`,
      {
        method: 'DELETE',
        headers: brevoHeaders(),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (response.ok || response.status === 404) {
      return { success: true, brevoContactId: null }
    }
    const body = await response.text()
    throw new Error(`Brevo ${response.status}: ${body}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[brevo/sync] deleteContact failed:', message)
    Sentry.captureException(err, {
      tags: { surface: 'brevo-sync', op: 'delete' },
    })
    return { success: false, error: message }
  }
}
