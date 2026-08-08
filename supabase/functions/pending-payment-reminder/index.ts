// Supabase Edge Function: pending-payment-reminder
//
// Runs every 15 minutes (triggered by pg_cron — see migration
// 20260808000002_schedule_pending_payment_reminder.sql) and sends a
// single abandoned-checkout reminder email to members whose self-service
// `pending_payment` booking is still unpaid ~15 minutes after creation.
//
// See SYSTEM-DESIGN-pending-payment-visibility.md §3/§4 for the full
// design (timing rationale, eligibility predicate, send mechanism) and
// UX-REVIEW-pending-payment-visibility.md §7 for the email copy this
// function's templates.ts renders verbatim.
//
// A brand-NEW function, not folded into daily-notifications — that job
// runs once a day; this needs ~15-minute granularity, and bolting a fast
// trigger onto a once-daily job would either re-run its whole workload
// every 15 minutes or grow a conditional branch coupling two
// independently-important jobs' failure modes together for no benefit
// (spec §4.1).
//
// Deliberately does NOT extract shared Deno helpers (isAuthorizedRequest
// / resendSend / sendWithLog-equivalent) into supabase/functions/_shared/
// — this is a small, single-purpose function and the codebase already
// tolerates deliberate duplication for exactly this reason (see
// resolveSiteOrigin's three Node-side copies). The auth predicate below
// is a byte-for-byte copy of daily-notifications/auth.ts's
// isAuthorizedRequest so the two functions' auth behaviour can never
// silently drift without a change showing up in both files' diffs.
//
// Does NOT call Stripe. Per spec §1's corollary ("mint on click, not on
// send"), the reminder's CTA is an app URL
// (`{SITE_URL}/bookings/resume/{bookingId}`) that mints a fresh Stripe
// Checkout Session only when the member actually clicks — see
// src/lib/bookings/resume-checkout.ts and
// src/app/(member)/bookings/resume/[bookingId]/route.ts. This function
// only needs data already on the bookings/events/profiles rows.
//
// Idempotency: gated by BOTH `bookings.pending_payment_reminder_sent_at
// IS NULL` (the primary gate — stamped after every attempt, success or
// failure, so a failed send is never retried by THIS cron; the generic
// daily-notifications retry loop picks it up instead — spec §4.4) AND a
// `dedupe_key` unique-index collision on the `notifications` audit
// table (belt-and-braces, same dual-gate shape as
// `profile_nudge:<profile_id>` / `profile_nudge_email_sent_at`).
//
// Authentication: identical bearer-auth contract to daily-notifications
// — accepts the auto-injected SUPABASE_SERVICE_ROLE_KEY OR the
// CRON_AUTH_TOKEN fallback (see that function's own comment block for
// why the fallback exists — Supabase gateway rejects `sb_secret_*`
// format tokens; project_supabase_gateway_key_format_inconsistency
// memory note).
//
// Deploy:
//   supabase functions deploy pending-payment-reminder --no-verify-jwt
//
// Invoke manually (for testing):
//   curl -X POST "$SUPABASE_URL/functions/v1/pending-payment-reminder" \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
//
// Required env — ALL already set project-wide from the daily-notifications
// setup (supabase secrets set ...), nothing new to configure here:
//   RESEND_API_KEY, FROM_ADDRESS, REPLY_TO_ADDRESS,
//   SANDBOX_FALLBACK_RECIPIENT (optional), CRON_AUTH_TOKEN,
//   NEXT_PUBLIC_SITE_URL
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are populated automatically
// by the Supabase runtime for edge functions.
//
// The ONLY new operator step is a vault secret for this function's own
// URL — see the migration's header comment.

// @ts-expect-error — Deno remote import; ignored by the Next.js TS build.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { pendingPaymentReminderTemplate, type Rendered } from './templates.ts'

// Deno globals — declared for the Next.js TS build which doesn't know about Deno.
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_AUTH_TOKEN = Deno.env.get('CRON_AUTH_TOKEN') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_ADDRESS =
  Deno.env.get('FROM_ADDRESS') ?? 'The Social Seen <hello@the-social-seen.com>'
const REPLY_TO_ADDRESS =
  Deno.env.get('REPLY_TO_ADDRESS') ?? 'info@the-social-seen.com'
const SANDBOX_FALLBACK_RECIPIENT =
  Deno.env.get('SANDBOX_FALLBACK_RECIPIENT') ?? ''
const SITE_URL =
  Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? 'https://the-social-seen.vercel.app'

const REMINDER_DELAY_MS = 15 * 60 * 1000
// Matches reap_stale_pending_bookings()'s own floor (35 minutes) — the
// deadline shown in the email is this function's best estimate of when
// the reaper becomes ELIGIBLE to cancel the row, not a promise of the
// exact instant (the reaper only ticks every 15 min, so real-world
// cancellation lands up to ~15 min after this). See spec §3 / UX-REVIEW
// §7's note on why no ticking countdown / exact-instant promise is used.
const REAPER_FLOOR_MS = 35 * 60 * 1000

// ── Auth (byte-for-byte copy of daily-notifications/auth.ts) ───────────────

function isAuthorizedRequest(
  authHeader: string | null | undefined,
  serviceRoleKey: string,
  cronAuthToken: string,
): boolean {
  const token = (authHeader ?? '').replace(/^Bearer\s+/i, '')
  const matchesServiceRole = !!serviceRoleKey && token === serviceRoleKey
  const matchesCronToken = !!cronAuthToken && token === cronAuthToken
  return matchesServiceRole || matchesCronToken
}

// ── Date formatting (subset of daily-notifications/dates.ts) ───────────────

const LONDON_TZ = 'Europe/London'

function formatLondonDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso))
}

function formatLondonTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

// ── Types ───────────────────────────────────────────────────────────────────

interface EligibleBookingRow {
  id: string
  user_id: string
  event_id: string
  price_at_booking: number
  booking_fee_pence: number
  created_at: string
  profiles: { full_name: string | null; email: string | null } | null
  events: {
    title: string
    slug: string
    date_time: string
    venue_name: string
    is_cancelled: boolean
    deleted_at: string | null
  } | null
}

// ── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  if (
    !isAuthorizedRequest(
      req.headers.get('authorization'),
      SERVICE_ROLE_KEY,
      CRON_AUTH_TOKEN,
    )
  ) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY not configured' }, 500)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const result = await processReminders(supabase)
    return json({ ok: true, ...result }, 200)
  } catch (err) {
    console.error('pending-payment-reminder: fatal error', err)
    return json({ ok: false, error: String(err) }, 500)
  }
})

// ── Core ─────────────────────────────────────────────────────────────────────

async function processReminders(
  supabase: ReturnType<typeof createClient>,
): Promise<{ sent: number; skippedCancelledEvent: number; failed: number }> {
  const cutoffIso = new Date(Date.now() - REMINDER_DELAY_MS).toISOString()

  // Eligibility predicate — mirrors reap_stale_pending_bookings()'s
  // five-predicate shape (spec §3/§4.3), plus the reminder-specific
  // sent-at gate. No upper bound on created_at: once a row is reaped or
  // paid, `status` flips away from 'pending_payment' and the predicate
  // excludes it automatically — robust to a delayed/skipped cron tick,
  // same "widen the window, gate on the sent-at column" fix already
  // applied to processProfileNudges in daily-notifications/index.ts.
  const { data: rows, error } = await supabase
    .from('bookings')
    .select(
      `
      id, user_id, event_id, price_at_booking, booking_fee_pence, created_at,
      profiles!inner(full_name, email),
      events!inner(title, slug, date_time, venue_name, is_cancelled, deleted_at)
    `,
    )
    .eq('status', 'pending_payment')
    .is('stripe_payment_id', null)
    .is('deleted_at', null)
    .eq('is_admin_hold', false)
    .is('pending_payment_reminder_sent_at', null)
    .lte('created_at', cutoffIso)

  if (error) {
    console.error('processReminders: query failed', error)
    return { sent: 0, skippedCancelledEvent: 0, failed: 0 }
  }

  let sent = 0
  let skippedCancelledEvent = 0
  let failed = 0

  for (const rawRow of (rows ?? []) as unknown[]) {
    const row = normaliseRow(rawRow)
    const profile = row.profiles
    const event = row.events

    if (!event) {
      console.warn('processReminders: booking missing joined event', row.id)
      continue
    }

    // Defensive skip (spec §4.3): a since-cancelled/deleted event
    // doesn't need a "come back and pay" nudge. Stamp anyway so it's
    // never retried, but don't send.
    if (event.is_cancelled || event.deleted_at !== null) {
      await stampReminderSent(supabase, row.id)
      skippedCancelledEvent++
      continue
    }

    const email = profile?.email
    if (!email) {
      // No email to send to — stamp so we don't keep re-selecting this
      // row forever, but don't count it as sent or failed (nothing to
      // audit-log against).
      await stampReminderSent(supabase, row.id)
      continue
    }

    const deadlineIso = new Date(
      new Date(row.created_at).getTime() + REAPER_FLOOR_MS,
    ).toISOString()

    const rendered = pendingPaymentReminderTemplate({
      fullName: profile?.full_name ?? 'there',
      eventTitle: event.title,
      eventDate: formatLondonDate(event.date_time),
      eventTime: formatLondonTime(event.date_time),
      priceInPence: row.price_at_booking,
      bookingFeePence: row.booking_fee_pence,
      resumeUrl: `${SITE_URL.replace(/\/$/, '')}/bookings/resume/${row.id}`,
      deadline: `${formatLondonDate(deadlineIso)}, ${formatLondonTime(deadlineIso)}`,
      siteUrl: SITE_URL,
    })

    const ok = await sendWithLog(supabase, {
      to: email,
      rendered,
      relatedProfileId: row.user_id,
      recipientEventId: row.event_id,
      dedupeKey: `pending_payment_reminder:${row.id}`,
    })

    // Stamp regardless of send outcome (spec §4.4) — a failed send is
    // caught and retried by daily-notifications' generic processRetries
    // loop (same notifications-row shape); we don't want THIS cron to
    // re-attempt the same booking on its own next tick and race the
    // retry path.
    await stampReminderSent(supabase, row.id)

    if (ok) sent++
    else failed++
  }

  return { sent, skippedCancelledEvent, failed }
}

function normaliseRow(raw: unknown): EligibleBookingRow {
  const r = raw as Record<string, unknown>
  const profilesRaw = r.profiles
  const eventsRaw = r.events
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    event_id: r.event_id as string,
    price_at_booking: r.price_at_booking as number,
    booking_fee_pence: r.booking_fee_pence as number,
    created_at: r.created_at as string,
    profiles: (Array.isArray(profilesRaw) ? profilesRaw[0] : profilesRaw) as
      | EligibleBookingRow['profiles']
      | undefined ?? null,
    events: (Array.isArray(eventsRaw) ? eventsRaw[0] : eventsRaw) as
      | EligibleBookingRow['events']
      | undefined ?? null,
  }
}

async function stampReminderSent(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ pending_payment_reminder_sent_at: new Date().toISOString() })
    .eq('id', bookingId)
  if (error) {
    console.error(
      'pending_payment_reminder_sent_at update failed for',
      bookingId,
      error,
    )
  }
}

// ── Send + audit (same shape as daily-notifications' sendWithLog) ──────────

interface SendWithLogArgs {
  to: string
  rendered: Rendered
  relatedProfileId: string
  recipientEventId: string
  dedupeKey: string
}

async function sendWithLog(
  supabase: ReturnType<typeof createClient>,
  args: SendWithLogArgs,
): Promise<boolean> {
  const actualRecipient =
    SANDBOX_FALLBACK_RECIPIENT && SANDBOX_FALLBACK_RECIPIENT.length > 0
      ? SANDBOX_FALLBACK_RECIPIENT
      : args.to
  const subjectWithPrefix =
    actualRecipient !== args.to
      ? `[→ ${args.to}] ${args.rendered.subject}`
      : args.rendered.subject

  // Reserve the row. If the dedupe_key collides (23505) we treat it as
  // "already sent, skip" — same convention as daily-notifications.
  const { data: inserted, error: insertErr } = await supabase
    .from('notifications')
    .insert({
      sent_by: args.relatedProfileId,
      recipient_user_id: args.relatedProfileId,
      recipient_event_id: args.recipientEventId,
      recipient_type: 'custom',
      type: 'reminder',
      subject: subjectWithPrefix,
      body: args.rendered.html,
      channel: 'email',
      recipient_email: actualRecipient,
      status: 'pending',
      template_name: 'pending_payment_reminder',
      dedupe_key: args.dedupeKey,
    })
    .select('id')
    .single()

  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') {
      return false
    }
    console.error(
      JSON.stringify({
        level: 'error',
        surface: 'edge-function-audit-insert',
        template: 'pending_payment_reminder',
        dedupeKey: args.dedupeKey,
        code: (insertErr as { code?: string }).code ?? null,
        message: (insertErr as { message?: string }).message ?? String(insertErr),
      }),
    )
    return false
  }

  const result = await resendSend({
    to: actualRecipient,
    subject: subjectWithPrefix,
    html: args.rendered.html,
    text: args.rendered.text,
  })

  await supabase
    .from('notifications')
    .update({
      status: result.success ? 'sent' : 'failed',
      provider_message_id: result.success ? result.messageId : null,
      error_message: result.success ? null : result.error,
    })
    .eq('id', (inserted as { id: string }).id)

  return result.success
}

type SendResult =
  | { success: true; messageId: string }
  | { success: false; error: string }

async function resendSend(args: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<SendResult> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [args.to],
        reply_to: REPLY_TO_ADDRESS,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    })
    const responseJson = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg =
        typeof (responseJson as { message?: string }).message === 'string'
          ? (responseJson as { message: string }).message
          : `HTTP ${res.status}`
      return { success: false, error: msg }
    }
    const id = (responseJson as { id?: string }).id
    if (!id) return { success: false, error: 'Resend returned no message id' }
    return { success: true, messageId: id }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
