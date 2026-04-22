import 'server-only'

/**
 * Brevo (Sendinblue) configuration.
 *
 * We use Brevo's REST API directly via fetch rather than the
 * @getbrevo/brevo SDK — the three endpoints we need (upsert
 * contact, remove from list, delete contact) are simple enough
 * that the SDK's ~30 ContactsClient methods would be bundle weight
 * for no gain. Same pattern as the Twilio call from the
 * daily-notifications edge function (Batch 5).
 *
 *   BREVO_API_KEY — from Brevo Console → SMTP & API → API Keys.
 *                   Starts with `xkeysib-`.
 *   BREVO_LIST_ID — numeric id of the newsletter list. Create it
 *                   manually in Brevo (Contacts → Lists → New); the
 *                   id is in the URL.
 *
 * `isBrevoConfigured()` lets callers short-circuit without a throw
 * when creds are absent (dev / preview before operator setup).
 */

export const BREVO_API_BASE = 'https://api.brevo.com/v3'

export const BREVO_API_KEY = process.env.BREVO_API_KEY ?? ''
export const BREVO_LIST_ID = Number.parseInt(
  process.env.BREVO_LIST_ID ?? '',
  10,
)

export function isBrevoConfigured(): boolean {
  return (
    BREVO_API_KEY.startsWith('xkeysib-') && Number.isFinite(BREVO_LIST_ID)
  )
}

/**
 * Common headers for every Brevo call. Kept in one place so header
 * drift (e.g. content-type) can't vary between call sites.
 */
export function brevoHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'api-key': BREVO_API_KEY,
  }
}
