// Supabase Edge Function: daily-notifications
//
// Runs once per day (triggered by pg_cron — see migration
// 20260421000004_schedule_daily_notifications.sql) and performs:
//
//   A. Venue reveals — events whose date_time is <= 7 days away and
//      still have venue_revealed = false. Email each confirmed attendee,
//      then set venue_revealed = true.
//   B. 2-day reminders — events whose London-local date is today + 2.
//   C. Day-of reminders — events whose London-local date is today.
//   D. Review requests — events whose London-local date is today - 1.
//   E. Retry — email notifications with status = 'failed', created in
//      the last 3 days, not retried in the last 12 hours. Retry once.
//
// Idempotency: every send writes a `notifications` row with a unique
// `dedupe_key` (e.g. "venue_reveal:<event_id>:<user_id>"). The partial
// UNIQUE index ux_notifications_dedupe_key makes duplicates fail with a
// 23505 that we treat as "already sent, skip". This lets the function
// run multiple times in a day without spamming.
//
// Authentication: the function requires the service-role JWT in the
// Authorization header. pg_cron passes it; manual invocations must too.
// We do NOT rely on Supabase's built-in JWT verification because the
// caller is a Postgres cron job, not an authenticated user.
//
// Deploy:
//   supabase functions deploy daily-notifications --no-verify-jwt
//
// Invoke manually (for testing or backfill):
//   curl -X POST "$SUPABASE_URL/functions/v1/daily-notifications" \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
//
// Required env (set via `supabase secrets set ...`):
//   RESEND_API_KEY               — Resend API key
//   FROM_ADDRESS                 — "The Social Seen <onboarding@resend.dev>"
//   REPLY_TO_ADDRESS             — info@the-social-seen.com
//   SANDBOX_FALLBACK_RECIPIENT   — optional; if set, all mail is redirected
//                                  to this address (dev/staging sandbox)
//   NEXT_PUBLIC_SITE_URL         — base URL for links in email bodies
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are populated automatically
// by the Supabase runtime for edge functions.

// @ts-expect-error — Deno remote import; ignored by the Next.js TS build.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import {
  eventReminderTemplate,
  profileNudgeTemplate,
  reviewRequestTemplate,
  venueRevealTemplate,
  type Rendered,
} from './templates.ts'
import {
  addDaysYmd,
  formatLondonDate,
  formatLondonTime,
  londonToday,
} from './dates.ts'

// Deno globals — declared for the Next.js TS build which doesn't know about Deno.
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_ADDRESS =
  Deno.env.get('FROM_ADDRESS') ?? 'The Social Seen <onboarding@resend.dev>'
const REPLY_TO_ADDRESS =
  Deno.env.get('REPLY_TO_ADDRESS') ?? 'info@the-social-seen.com'
const SANDBOX_FALLBACK_RECIPIENT =
  Deno.env.get('SANDBOX_FALLBACK_RECIPIENT') ?? ''
const SITE_URL =
  Deno.env.get('NEXT_PUBLIC_SITE_URL') ?? 'https://the-social-seen.vercel.app'

// SMS (Phase 2.5 Batch 5) — transactional venue-reveal + day-of reminder
// only. All three must be set for SMS to fire; otherwise SMS dispatch
// is skipped silently (email still sends). Mirrors the Node-side
// config in src/lib/sms/config.ts.
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''
const TWILIO_SENDER_ID = Deno.env.get('TWILIO_SENDER_ID') ?? 'SocialSeen'
const SMS_SANDBOX_FALLBACK_RECIPIENT =
  Deno.env.get('SMS_SANDBOX_FALLBACK_RECIPIENT') ?? ''

function isSmsConfigured(): boolean {
  return (
    TWILIO_ACCOUNT_SID.startsWith('AC') &&
    TWILIO_AUTH_TOKEN.length >= 16 &&
    TWILIO_SENDER_ID.length > 0
  )
}

// ── Types ───────────────────────────────────────────────────────────────────

interface EventRow {
  id: string
  slug: string
  title: string
  date_time: string
  venue_name: string
  venue_address: string
  postcode: string | null
  venue_revealed: boolean
  dress_code: string | null
}

interface AttendeeRow {
  user_id: string
  profiles: {
    full_name: string | null
    email: string | null
    phone_number: string | null
    sms_consent: boolean | null
  } | null
}

interface Counts {
  venue_reveals: number
  reminders_2day: number
  reminders_today: number
  review_requests: number
  profile_nudges: number
  retries: number
  sms_venue_reveals: number
  sms_reminders_today: number
}

// ── Entry point ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }

  // Service-role gate. The anon or any user JWT must be rejected.
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY not configured' }, 500)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const today = londonToday()
  const twoDaysOut = addDaysYmd(today, 2)
  const yesterday = addDaysYmd(today, -1)

  const counts: Counts = {
    venue_reveals: 0,
    reminders_2day: 0,
    reminders_today: 0,
    review_requests: 0,
    profile_nudges: 0,
    retries: 0,
    sms_venue_reveals: 0,
    sms_reminders_today: 0,
  }

  try {
    const venueResult = await processVenueReveals(supabase)
    counts.venue_reveals = venueResult.emails
    counts.sms_venue_reveals = venueResult.sms

    const remind2 = await processReminders(supabase, twoDaysOut, '2day')
    counts.reminders_2day = remind2.emails
    // (SMS not fired for 2-day variant; remind2.sms is always 0.)

    const remindToday = await processReminders(supabase, today, 'today')
    counts.reminders_today = remindToday.emails
    counts.sms_reminders_today = remindToday.sms

    counts.review_requests = await processReviewRequests(supabase, yesterday)
    counts.profile_nudges = await processProfileNudges(supabase)
    counts.retries = await processRetries(supabase)
  } catch (err) {
    console.error('daily-notifications: fatal error', err)
    return json({ ok: false, error: String(err), counts }, 500)
  }

  return json({ ok: true, counts }, 200)
})

// ── Section A — Venue reveals ───────────────────────────────────────────────

async function processVenueReveals(
  supabase: ReturnType<typeof createClient>,
): Promise<{ emails: number; sms: number }> {
  // Events with a hidden venue whose date_time falls within the next 7 days.
  const nowIso = new Date().toISOString()
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: events, error } = await supabase
    .from('events')
    .select('id, slug, title, date_time, venue_name, venue_address, postcode, venue_revealed, dress_code')
    .eq('venue_revealed', false)
    .eq('is_published', true)
    .eq('is_cancelled', false)
    .is('deleted_at', null)
    .gte('date_time', nowIso)
    .lte('date_time', sevenDaysFromNow)
  if (error) {
    console.error('processVenueReveals: query failed', error)
    return { emails: 0, sms: 0 }
  }

  let sent = 0
  let smsSent = 0
  for (const event of (events ?? []) as EventRow[]) {
    const attendees = await getConfirmedAttendees(supabase, event.id)
    for (const a of attendees) {
      const recipient = a.profiles?.email
      if (!recipient) continue
      const rendered = venueRevealTemplate({
        fullName: a.profiles?.full_name ?? 'there',
        eventTitle: event.title,
        eventSlug: event.slug,
        eventDate: formatLondonDate(event.date_time),
        eventTime: formatLondonTime(event.date_time),
        venueName: event.venue_name,
        venueAddress: event.venue_address,
        postcode: event.postcode,
        siteUrl: SITE_URL,
      })
      const ok = await sendWithLog(supabase, {
        to: recipient,
        rendered,
        templateName: 'venue_reveal',
        relatedProfileId: a.user_id,
        recipientEventId: event.id,
        dedupeKey: `venue_reveal:${event.id}:${a.user_id}`,
      })
      if (ok) sent++

      // SMS companion — same content, terser. Only fires if recipient
      // has sms_consent=true + a phone_number + Twilio is configured.
      if (isSmsConfigured() && a.profiles?.sms_consent && a.profiles?.phone_number) {
        const smsOk = await sendSmsWithLog(supabase, {
          to: a.profiles.phone_number,
          body:
            `The Social Seen: ${event.title} venue — ${event.venue_name} on ${formatLondonDate(event.date_time)} ${formatLondonTime(event.date_time)}. ` +
            `Manage SMS: ${SITE_URL.replace(/\/$/, '')}/profile`,
          templateName: 'venue_reveal_sms',
          relatedProfileId: a.user_id,
          recipientEventId: event.id,
          dedupeKey: `venue_reveal_sms:${event.id}:${a.user_id}`,
        })
        if (smsOk) smsSent++
      }
    }

    // Flip the flag whether or not individual emails succeeded. Failed sends
    // are already logged and eligible for retry; we don't want to attempt
    // the reveal again on tomorrow's run (which would re-send to every
    // attendee — dedupe would save us but it'd be noisy).
    const { error: updErr } = await supabase
      .from('events')
      .update({ venue_revealed: true })
      .eq('id', event.id)
    if (updErr) console.error('venue_revealed update failed for', event.id, updErr)
  }

  return { emails: sent, sms: smsSent }
}

// ── Sections B & C — Reminders ──────────────────────────────────────────────

async function processReminders(
  supabase: ReturnType<typeof createClient>,
  londonDateYmd: string,
  variant: '2day' | 'today',
): Promise<{ emails: number; sms: number }> {
  // Filter on the raw timestamptz range corresponding to London-local date.
  // We accept some timezone edge-cases by widening to ±1 day in UTC and
  // filtering in JS using formatLondonDate — simpler and correct.
  const from = new Date(`${londonDateYmd}T00:00:00Z`).toISOString()
  const to = new Date(
    new Date(`${londonDateYmd}T00:00:00Z`).getTime() + 48 * 60 * 60 * 1000,
  ).toISOString()

  const { data: events, error } = await supabase
    .from('events')
    .select('id, slug, title, date_time, venue_name, venue_address, postcode, venue_revealed, dress_code')
    .eq('is_published', true)
    .eq('is_cancelled', false)
    .is('deleted_at', null)
    .gte('date_time', from)
    .lt('date_time', to)
  if (error) {
    console.error('processReminders: query failed', error)
    return { emails: 0, sms: 0 }
  }

  // Filter to events whose London-local date matches exactly.
  const matching = (events ?? []).filter(
    (e: EventRow) =>
      formatLondonYmd(e.date_time) === londonDateYmd,
  ) as EventRow[]

  let sent = 0
  let smsSent = 0
  for (const event of matching) {
    const attendees = await getConfirmedAttendees(supabase, event.id)
    for (const a of attendees) {
      const recipient = a.profiles?.email
      if (!recipient) continue
      const rendered = eventReminderTemplate({
        variant,
        fullName: a.profiles?.full_name ?? 'there',
        eventTitle: event.title,
        eventSlug: event.slug,
        eventDate: formatLondonDate(event.date_time),
        eventTime: formatLondonTime(event.date_time),
        venueName: event.venue_name,
        venueAddress: event.venue_address,
        postcode: event.postcode,
        venueRevealed: event.venue_revealed,
        dressCode: event.dress_code,
        siteUrl: SITE_URL,
      })
      const ok = await sendWithLog(supabase, {
        to: recipient,
        rendered,
        templateName: variant === 'today' ? 'reminder_today' : 'reminder_2day',
        relatedProfileId: a.user_id,
        recipientEventId: event.id,
        dedupeKey: `${variant === 'today' ? 'reminder_today' : 'reminder_2day'}:${event.id}:${a.user_id}:${londonDateYmd.replace(/-/g, '')}`,
      })
      if (ok) sent++

      // SMS companion — only for the day-of variant. We deliberately
      // don't text the 2-day reminder to keep per-user SMS volume low.
      if (
        variant === 'today' &&
        isSmsConfigured() &&
        a.profiles?.sms_consent &&
        a.profiles?.phone_number
      ) {
        const venueForSms = event.venue_revealed ? event.venue_name : 'Venue TBA'
        const smsOk = await sendSmsWithLog(supabase, {
          to: a.profiles.phone_number,
          body:
            `Tonight: ${event.title} at ${formatLondonTime(event.date_time)}, ${venueForSms}. See you there! ` +
            `Manage SMS: ${SITE_URL.replace(/\/$/, '')}/profile`,
          templateName: 'reminder_today_sms',
          relatedProfileId: a.user_id,
          recipientEventId: event.id,
          dedupeKey: `reminder_today_sms:${event.id}:${a.user_id}:${londonDateYmd.replace(/-/g, '')}`,
        })
        if (smsOk) smsSent++
      }
    }
  }

  return { emails: sent, sms: smsSent }
}

// ── Section D — Review requests ─────────────────────────────────────────────

async function processReviewRequests(
  supabase: ReturnType<typeof createClient>,
  londonDateYmd: string,
): Promise<number> {
  const from = new Date(`${londonDateYmd}T00:00:00Z`).toISOString()
  const to = new Date(
    new Date(`${londonDateYmd}T00:00:00Z`).getTime() + 48 * 60 * 60 * 1000,
  ).toISOString()

  const { data: events, error } = await supabase
    .from('events')
    .select('id, slug, title, date_time, venue_name, venue_address, postcode, venue_revealed, dress_code')
    .eq('is_published', true)
    .eq('is_cancelled', false)
    .is('deleted_at', null)
    .gte('date_time', from)
    .lt('date_time', to)
  if (error) {
    console.error('processReviewRequests: query failed', error)
    return 0
  }

  const matching = (events ?? []).filter(
    (e: EventRow) => formatLondonYmd(e.date_time) === londonDateYmd,
  ) as EventRow[]

  let sent = 0
  for (const event of matching) {
    const attendees = await getConfirmedAttendees(supabase, event.id)
    for (const a of attendees) {
      const recipient = a.profiles?.email
      if (!recipient) continue
      const rendered = reviewRequestTemplate({
        userId: a.user_id,
        fullName: a.profiles?.full_name ?? 'there',
        eventTitle: event.title,
        eventSlug: event.slug,
        siteUrl: SITE_URL,
      })
      const ok = await sendWithLog(supabase, {
        to: recipient,
        rendered,
        templateName: 'review_request',
        relatedProfileId: a.user_id,
        recipientEventId: event.id,
        preferenceCategory: 'review_requests',
        // Review request: only ever one per (event, user), regardless of day.
        dedupeKey: `review_request:${event.id}:${a.user_id}`,
      })
      if (ok) sent++
    }
  }

  return sent
}

// ── Section F — Profile completion nudge ────────────────────────────────────
//
// Sent ~3 days after registration if completion < 50%, exactly once per
// member (gated by profiles.profile_nudge_email_sent_at). Mirrors the
// weighting in src/lib/utils/profile-completion.ts — change both
// together if the weights ever shift.
//
// Mirroring rather than importing because edge functions run under Deno
// and can't reach into src/. The Vitest suite covers the source-of-truth
// version; a drift would surface as a divergence between the banner score
// and the email's stated score.

const PROFILE_FIELD_WEIGHTS = {
  avatar_url: 20,
  bio: 15,
  linkedin_url: 15,
  full_name: 10,
  job_title: 10,
  company: 10,
  industry: 10,
  phone_number: 10,
} as const

const PROFILE_FIELD_LABELS: Record<keyof typeof PROFILE_FIELD_WEIGHTS, string> = {
  avatar_url: 'Profile photo',
  bio: 'Bio',
  linkedin_url: 'LinkedIn',
  full_name: 'Full name',
  job_title: 'Job title',
  company: 'Company',
  industry: 'Industry',
  phone_number: 'Phone number',
}

interface NudgeProfileRow {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
  bio: string | null
  linkedin_url: string | null
  job_title: string | null
  company: string | null
  industry: string | null
  phone_number: string | null
}

function isFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function computeCompletion(p: NudgeProfileRow): {
  score: number
  missingLabels: string[]
} {
  let score = 0
  const ordered = (Object.entries(PROFILE_FIELD_WEIGHTS) as Array<
    [keyof typeof PROFILE_FIELD_WEIGHTS, number]
  >).sort(([, a], [, b]) => b - a)

  const missingLabels: string[] = []
  for (const [key, weight] of ordered) {
    if (isFilled(p[key])) {
      score += weight
    } else {
      missingLabels.push(PROFILE_FIELD_LABELS[key])
    }
  }
  return { score, missingLabels }
}

async function processProfileNudges(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  // Target the "3-day" mark but with a wide enough window that a
  // cron skip (infra hiccup, service window) can't silently drop an
  // entire cohort. Previous narrow [Y-4d, Y-3d] window would miss any
  // signup whose match-day got skipped — they'd never get nudged.
  //
  // New window: created between 3 and 30 days ago, AND no nudge yet.
  // `profile_nudge_email_sent_at IS NULL` remains the dedupe guard —
  // every user matches at most once across all future cron runs.
  //
  // 30-day ceiling keeps stale signups out of the pool (someone who
  // bounced 45 days ago isn't getting a nudge now).
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString()
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, email, avatar_url, bio, linkedin_url, job_title, company, industry, phone_number',
    )
    .gte('created_at', thirtyDaysAgo)
    .lte('created_at', threeDaysAgo)
    .is('deleted_at', null)
    .is('profile_nudge_email_sent_at', null)
    // Verified-only — unverified members are still being prompted by
    // the welcome flow's verification reminder. Stacking a profile
    // nudge on top creates two pieces of mail competing for attention
    // in week one. Trade-off: a member who never verifies during the
    // [Y-4d, Y-3d] window misses the nudge entirely (acceptable —
    // they're not engaging anyway; no point pestering further).
    .eq('email_verified', true)
    .eq('email_consent', true)
    .neq('status', 'banned')
  if (error) {
    console.error('processProfileNudges: query failed', error)
    return 0
  }

  let sent = 0
  for (const row of (profiles ?? []) as NudgeProfileRow[]) {
    if (!row.email) continue
    const { score, missingLabels } = computeCompletion(row)
    if (score >= 50) continue

    const rendered = profileNudgeTemplate({
      userId: row.id,
      fullName: row.full_name ?? 'there',
      completionScore: score,
      topMissingLabels: missingLabels.slice(0, 3),
      siteUrl: SITE_URL,
    })

    const ok = await sendWithLog(supabase, {
      to: row.email,
      rendered,
      templateName: 'profile_nudge',
      relatedProfileId: row.id,
      preferenceCategory: 'profile_nudges',
      // One-shot per profile — but the column is the real gate; the
      // dedupe_key is belt-and-braces in case the column update fails.
      dedupeKey: `profile_nudge:${row.id}`,
    })

    // Stamp the column whether the send succeeded or failed. A failed
    // send sits in the failed-notifications view for admin retry; we
    // don't want the cron job to re-attempt the same nudge tomorrow.
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ profile_nudge_email_sent_at: new Date().toISOString() })
      .eq('id', row.id)
    if (updErr) {
      console.error('profile_nudge_email_sent_at update failed for', row.id, updErr)
    }

    if (ok) sent++
  }
  return sent
}

// ── Section E — Retry failed sends ──────────────────────────────────────────

async function processRetries(supabase: ReturnType<typeof createClient>): Promise<number> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

  const { data: failed, error } = await supabase
    .from('notifications')
    .select('id, subject, body, recipient_email, template_name, retried_at, recipient_event_id')
    .eq('channel', 'email')
    .eq('status', 'failed')
    .gte('created_at', threeDaysAgo)
    .or(`retried_at.is.null,retried_at.lt.${twelveHoursAgo}`)
    .limit(100)
  if (error) {
    console.error('processRetries: query failed', error)
    return 0
  }

  // Pre-fetch the event state for every event referenced by a failed
  // row so we can skip retries whose event has since been cancelled or
  // soft-deleted. A single IN-list lookup beats N sequential SELECTs.
  const rows = (failed ?? []) as Array<{
    id: string
    subject: string
    body: string
    recipient_email: string | null
    template_name: string | null
    retried_at: string | null
    recipient_event_id: string | null
  }>
  const eventIds = Array.from(
    new Set(
      rows
        .map((r) => r.recipient_event_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  const skipEventIds = new Set<string>()
  if (eventIds.length > 0) {
    const { data: eventsData, error: eventsErr } = await supabase
      .from('events')
      .select('id, is_cancelled, deleted_at')
      .in('id', eventIds)
    if (eventsErr) {
      console.error('processRetries: event state lookup failed', eventsErr)
    } else {
      for (const e of (eventsData ?? []) as Array<{
        id: string
        is_cancelled: boolean
        deleted_at: string | null
      }>) {
        if (e.is_cancelled || e.deleted_at !== null) skipEventIds.add(e.id)
      }
    }
  }

  let retriedCount = 0
  for (const r of rows) {
    if (!r.recipient_email) continue
    if (r.recipient_event_id && skipEventIds.has(r.recipient_event_id)) {
      // Event was cancelled or deleted since the original send — don't
      // retry; stamp the row so it doesn't keep coming back.
      await supabase
        .from('notifications')
        .update({
          retried_at: new Date().toISOString(),
          error_message: 'skipped: event cancelled or deleted',
        })
        .eq('id', r.id)
        .eq('retried_at', r.retried_at ?? null)
      continue
    }

    // Claim-then-send: optimistically stamp `retried_at` FIRST, gated on
    // the original value we read. If a concurrent invocation already
    // claimed the row, our UPDATE matches zero rows and we skip the
    // send entirely — genuinely preventing a double-send, not just
    // double-accounting. Provider_message_id / final status get
    // patched in after the send resolves.
    const claimedAt = new Date().toISOString()
    const { data: claimed, error: claimErr } = await supabase
      .from('notifications')
      .update({ retried_at: claimedAt })
      .eq('id', r.id)
      .eq('retried_at', r.retried_at ?? null)
      .select('id')
    if (claimErr) {
      console.error('processRetries: claim failed', claimErr)
      continue
    }
    if ((claimed ?? []).length === 0) {
      // Lost the race — another invocation claimed this row.
      continue
    }

    const result = await resendSend({
      to: r.recipient_email,
      subject: r.subject,
      html: r.body,
    })
    const { error: patchErr } = await supabase
      .from('notifications')
      .update({
        status: result.success ? 'sent' : 'failed',
        provider_message_id: result.success ? result.messageId : null,
        error_message: result.success ? null : result.error,
      })
      .eq('id', r.id)
    if (patchErr) {
      console.error('processRetries: outcome patch failed', patchErr)
    }
    retriedCount++
  }
  return retriedCount
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getConfirmedAttendees(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
): Promise<AttendeeRow[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'user_id, profiles:profiles!inner(full_name, email, phone_number, sms_consent)',
    )
    .eq('event_id', eventId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
  if (error) {
    console.error('getConfirmedAttendees failed for', eventId, error)
    return []
  }
  // Supabase types `profiles` as an array for the join; normalise to object.
  return (data ?? []).map((r: unknown) => {
    const row = r as { user_id: string; profiles: unknown }
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    return {
      user_id: row.user_id,
      profiles: profile as AttendeeRow['profiles'],
    }
  })
}

interface SendWithLogArgs {
  to: string
  rendered: Rendered
  templateName: string
  relatedProfileId: string
  dedupeKey: string
  /**
   * Event id this notification is scoped to. Stored on the audit row
   * so the retry loop (processRetries) can skip sends whose event was
   * cancelled or deleted between the original attempt and the retry.
   */
  recipientEventId?: string
  /**
   * Marketing-category gate. When set, we look up
   * `notification_preferences.<category>` for `relatedProfileId` and
   * skip the send if false. Transactional templates (venue reveal,
   * event reminder) leave this undefined.
   */
  preferenceCategory?:
    | 'review_requests'
    | 'profile_nudges'
    | 'admin_announcements'
}

/**
 * Reserve a notifications row (dedupe via UNIQUE index), send, update the
 * row with the outcome. Returns true on success.
 *
 * If the dedupe_key is already present, the INSERT fails with 23505 and
 * we return false (not an error — "already sent"). We still return false
 * so the caller's count reflects actual new sends.
 */
async function sendWithLog(
  supabase: ReturnType<typeof createClient>,
  args: SendWithLogArgs,
): Promise<boolean> {
  // Preference check — skip sends to users who opted out of this
  // marketing category. No audit row written for suppressed sends.
  if (args.preferenceCategory) {
    const { data: pref } = await supabase
      .from('notification_preferences')
      .select('review_requests, profile_nudges, admin_announcements')
      .eq('user_id', args.relatedProfileId)
      .maybeSingle()
    if (pref && (pref as Record<string, boolean>)[args.preferenceCategory] === false) {
      return false
    }
  }

  const actualRecipient =
    SANDBOX_FALLBACK_RECIPIENT && SANDBOX_FALLBACK_RECIPIENT.length > 0
      ? SANDBOX_FALLBACK_RECIPIENT
      : args.to
  const subjectWithPrefix =
    actualRecipient !== args.to
      ? `[\u2192 ${args.to}] ${args.rendered.subject}`
      : args.rendered.subject

  // Reserve the row. If the dedupe_key collides we skip.
  //
  // For cron-driven sends, `relatedProfileId` IS the recipient (every
  // caller in this file passes `attendee.user_id` or `row.id`). We
  // populate both `sent_by` and `recipient_user_id` from it so the
  // GDPR scrub RPC (`sanitise_user_notifications`, P2-9) catches the
  // row by the FK path, not just the legacy sent_by-as-recipient
  // convention.
  //
  // ⚠️ DO NOT "fix" `sent_by` to a system uuid without reading
  // docs/CONTRIBUTING.md → "sent_by = recipient_user_id" first.
  // The older scrub path relies on sent_by holding the recipient's
  // id, and dropping either column breaks GDPR deletion coverage.
  const { data: inserted, error: insertErr } = await supabase
    .from('notifications')
    .insert({
      sent_by: args.relatedProfileId,
      recipient_user_id: args.relatedProfileId,
      recipient_event_id: args.recipientEventId ?? null,
      recipient_type: 'custom',
      type: 'reminder',
      subject: subjectWithPrefix,
      body: args.rendered.html,
      channel: 'email',
      recipient_email: actualRecipient,
      status: 'pending',
      template_name: args.templateName,
      dedupe_key: args.dedupeKey,
    })
    .select('id')
    .single()

  if (insertErr) {
    // 23505 = unique_violation — dedupe key already used, skip.
    if ((insertErr as { code?: string }).code === '23505') {
      return false
    }
    // Structured tagged log for any *other* insert failure (transient
    // connection, CHECK violation, …). These silently drop a send
    // because no audit row gets written — the retry loop can't see
    // what never existed. Keep a stable tag so a future Sentry /
    // log-drain integration can alert on it without code changes.
    console.error(
      JSON.stringify({
        level: 'error',
        surface: 'edge-function-audit-insert',
        template: args.templateName,
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
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg =
        typeof (json as { message?: string }).message === 'string'
          ? (json as { message: string }).message
          : `HTTP ${res.status}`
      return { success: false, error: msg }
    }
    const id = (json as { id?: string }).id
    if (!id) return { success: false, error: 'Resend returned no message id' }
    return { success: true, messageId: id }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function formatLondonYmd(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${day}`
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── SMS helper (Phase 2.5 Batch 5) ──────────────────────────────────────────
//
// Twilio's REST API is simple enough that we avoid pulling in the Twilio
// Deno SDK (extra remote import + cold-start cost). Direct fetch with
// Basic auth → Messages endpoint. Mirrors the error handling of the
// Node wrapper (src/lib/sms/send.ts).

interface SendSmsArgs {
  to: string // E.164
  body: string
  templateName: string
  relatedProfileId: string
  recipientEventId?: string
  dedupeKey: string
}

async function sendSmsWithLog(
  supabase: ReturnType<typeof createClient>,
  args: SendSmsArgs,
): Promise<boolean> {
  // Normalise to E.164 — UK members often enter 07... format; Twilio
  // rejects non-E.164 with a permanent 400. Mirrors the Node wrapper.
  const normalisedPhone = args.to.startsWith('0')
    ? '+44' + args.to.slice(1)
    : args.to
  const actualRecipient =
    SMS_SANDBOX_FALLBACK_RECIPIENT && SMS_SANDBOX_FALLBACK_RECIPIENT.length > 0
      ? SMS_SANDBOX_FALLBACK_RECIPIENT
      : normalisedPhone
  const bodyWithPrefix =
    actualRecipient !== normalisedPhone
      ? `[\u2192 ${normalisedPhone}]\n${args.body}`
      : args.body

  // Reserve the audit row. Duplicate dedupe_key = already sent; skip.
  const { data: inserted, error: insertErr } = await supabase
    .from('notifications')
    .insert({
      sent_by: args.relatedProfileId,
      recipient_user_id: args.relatedProfileId,
      recipient_event_id: args.recipientEventId ?? null,
      recipient_type: 'custom',
      type: 'reminder',
      subject: null,
      body: args.body,
      channel: 'sms',
      recipient_email: actualRecipient, // phone number stored here; schema shared
      status: 'pending',
      template_name: args.templateName,
      dedupe_key: args.dedupeKey,
    })
    .select('id')
    .single()

  if (insertErr) {
    // 23505 = dedupe collision → already sent, skip silently.
    if ((insertErr as { code?: string }).code === '23505') return false
    console.error('sms audit insert failed', insertErr)
    return false
  }

  // Dispatch to Twilio.
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
  const form = new URLSearchParams()
  form.set('To', actualRecipient)
  form.set('From', TWILIO_SENDER_ID)
  form.set('Body', bodyWithPrefix)

  const authHeader =
    'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)

  let messageSid: string | null = null
  let errMsg: string | null = null

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: form,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader,
      },
    })
    if (res.ok) {
      const payload = (await res.json()) as { sid?: string }
      messageSid = payload.sid ?? null
    } else {
      errMsg = `HTTP ${res.status}: ${await res.text()}`
    }
  } catch (err) {
    errMsg = err instanceof Error ? err.message : String(err)
  }

  const { error: updErr } = await supabase
    .from('notifications')
    .update({
      status: messageSid ? 'sent' : 'failed',
      provider_message_id: messageSid,
      error_message: errMsg,
      sent_at: new Date().toISOString(),
    })
    .eq('id', inserted.id)
  if (updErr) console.error('sms audit update failed', updErr)

  return !!messageSid
}
