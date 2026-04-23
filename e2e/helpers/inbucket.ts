/**
 * Inbucket helper — read OTPs from the local Supabase mail catcher.
 *
 * `supabase start` boots Inbucket on port 54324. Supabase Auth's
 * built-in mailer (which `signInWithOtp` uses when no custom SMTP is
 * configured) routes every mail there. Tests poll for the most recent
 * message to a given address, regex-extract the 6-digit OTP, and return
 * it.
 *
 * If the `daily-notifications` edge function is also running it will
 * try to use Resend; we don't read those messages here. This helper is
 * scoped to Supabase Auth OTP emails.
 */

const DEFAULT_INBUCKET_URL = 'http://127.0.0.1:54324'

export function getInbucketUrl(): string {
  return process.env.INBUCKET_URL ?? DEFAULT_INBUCKET_URL
}

interface InbucketMessage {
  id: string
  from: { name: string; address: string }[]
  to: { name: string; address: string }[]
  subject: string
  date: string
  size: number
}

interface InbucketBody {
  text: string
  html: string
}

/**
 * Fetch the list of messages for an inbox (Inbucket calls inboxes
 * "mailboxes"). The mailbox name is the local-part of the email
 * address — `alice@example.com` → `alice`.
 */
async function listMessages(mailbox: string): Promise<InbucketMessage[]> {
  const res = await fetch(`${getInbucketUrl()}/api/v1/mailbox/${encodeURIComponent(mailbox)}`)
  if (!res.ok) {
    throw new Error(
      `Inbucket: list ${mailbox} failed (${res.status}): ${await res.text().catch(() => '<no body>')}`,
    )
  }
  return (await res.json()) as InbucketMessage[]
}

async function fetchMessage(
  mailbox: string,
  id: string,
): Promise<InbucketBody> {
  const res = await fetch(
    `${getInbucketUrl()}/api/v1/mailbox/${encodeURIComponent(mailbox)}/${encodeURIComponent(id)}`,
  )
  if (!res.ok) {
    throw new Error(
      `Inbucket: fetch ${mailbox}/${id} failed (${res.status}): ${await res.text().catch(() => '<no body>')}`,
    )
  }
  const body = (await res.json()) as { body: InbucketBody }
  return body.body
}

/**
 * Convert an email address to its Inbucket mailbox name. Inbucket
 * normalises by:
 *   - stripping the domain
 *   - lowercasing
 *   - **stripping `+subaddress` tags** (standard email plus-aliasing;
 *     `foo+bar@example.com` is delivered to mailbox `foo`). The E2E
 *     fixtures use `+tag` to keep addresses unique per scenario, so
 *     forgetting this would cause every OTP to land in a mailbox our
 *     poll ignores.
 */
export function emailToMailbox(email: string): string {
  const localPart = email.split('@')[0]!.toLowerCase()
  const plusIdx = localPart.indexOf('+')
  return plusIdx >= 0 ? localPart.slice(0, plusIdx) : localPart
}

/**
 * Wait for an OTP email to land for the given recipient and return the
 * 6-digit code. Polls Inbucket every 500ms up to `timeoutMs`. Throws on
 * timeout or if the message arrives but no 6-digit code can be extracted.
 *
 * Supabase's default magic-link template includes the OTP via
 * `{{ .Token }}` substitution; we match a standalone 6-digit run in the
 * plain-text body. If the project customises the template with extra
 * 6-digit numbers (date stamps, phone numbers) we'd need a tighter regex.
 */
export async function waitForOtp(
  email: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const pollMs = opts.pollMs ?? 500
  const mailbox = emailToMailbox(email)
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    let messages: InbucketMessage[] = []
    try {
      messages = await listMessages(mailbox)
    } catch {
      // Inbox may not exist yet — that's normal before the first send.
    }
    if (messages.length > 0) {
      // Most recent first.
      const newest = messages[messages.length - 1]
      const body = await fetchMessage(mailbox, newest.id)
      const text = body.text || body.html
      const match = text.match(/\b(\d{6})\b/)
      if (match) return match[1]
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  throw new Error(
    `waitForOtp(${email}): no 6-digit OTP arrived within ${timeoutMs}ms. ` +
      `Is Inbucket running? (supabase start without --exclude inbucket)`,
  )
}

/**
 * Best-effort delete of every message in an inbox. Used by tests to
 * isolate an OTP poll from prior runs.
 */
export async function purgeInbox(email: string): Promise<void> {
  const mailbox = emailToMailbox(email)
  try {
    await fetch(
      `${getInbucketUrl()}/api/v1/mailbox/${encodeURIComponent(mailbox)}`,
      { method: 'DELETE' },
    )
  } catch {
    // Ignore — best effort.
  }
}

/**
 * Cheap reachability probe — used by specs that should auto-skip when
 * Inbucket isn't running locally.
 */
export async function isInbucketReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${getInbucketUrl()}/api/v1/mailbox/`, {
      method: 'HEAD',
    })
    return res.status > 0 && res.status < 500
  } catch {
    return false
  }
}
