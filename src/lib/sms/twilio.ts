import 'server-only'
import twilio from 'twilio'
import { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, isSmsConfigured } from './config'

type TwilioClient = ReturnType<typeof twilio>

let cached: TwilioClient | null = null

/**
 * Lazy singleton Twilio client.
 *
 * Throws if creds are missing so callers can differentiate "not
 * configured" (treat as disabled, no audit row) from "send failed"
 * (audit row, retry). The `isSmsConfigured()` helper lets callers
 * pre-check without triggering the throw.
 */
export function getTwilioClient(): TwilioClient {
  if (cached) return cached
  if (!isSmsConfigured()) {
    throw new Error(
      'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_SENDER_ID.',
    )
  }
  cached = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  return cached
}
