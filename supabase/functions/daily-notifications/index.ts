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
  profiles: { full_name: string | null; email: string | null } | null
}

interface Counts {
  venue_reveals: number
  reminders_2day: number
  reminders_today: number
  review_requests: number
  profile_nudges: number
  retries: number
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
  }

  try {
    counts.venue_reveals = await processVenueReveals(supabase)
    counts.reminders_2day = await processReminders(supabase, twoDaysOut, '2day')
    counts.reminders_today = await processReminders(supabase, today, 'today')
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

async function processVenueReveals(supabase: ReturnType<typeof createClient>): Promise<number> {
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
    return 0
  }

  let sent = 0
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
        dedupeKey: `venue_reveal:${event.id}:${a.user_id}`,
      })
      if (ok) sent++
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

  return sent
}

// ── Sections B & C — Reminders ──────────────────────────────────────────────

async function processReminders(
  supabase: ReturnType<typeof createClient>,
  londonDateYmd: string,
  variant: '2day' | 'today',
): Promise<number> {
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
    return 0
  }

  // Filter to events whose London-local date matches exactly.
  const matching = (events ?? []).filter(
    (e: EventRow) =>
      formatLondonYmd(e.date_time) === londonDateYmd,
  ) as EventRow[]

  let sent = 0
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
        dedupeKey: `${variant === 'today' ? 'reminder_today' : 'reminder_2day'}:${event.id}:${a.user_id}:${londonDateYmd.replace(/-/g, '')}`,
      })
      if (ok) sent++
    }
  }

  return sent
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
  // Window: registered between 4 days ago and 3 days ago (so we hit
  // approximately the 3-day mark even with cron jitter — running daily,
  // the same user only matches once because we set the sent_at column
  // on first send).
  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, email, avatar_url, bio, linkedin_url, job_title, company, industry, phone_number',
    )
    .gte('created_at', fourDaysAgo)
    .lte('created_at', threeDaysAgo)
    .is('deleted_at', null)
    .is('profile_nudge_email_sent_at', null)
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
    .select('id, subject, body, recipient_email, template_name, retried_at')
    .eq('channel', 'email')
    .eq('status', 'failed')
    .gte('created_at', threeDaysAgo)
    .or(`retried_at.is.null,retried_at.lt.${twelveHoursAgo}`)
    .limit(100)
  if (error) {
    console.error('processRetries: query failed', error)
    return 0
  }

  let retriedCount = 0
  for (const row of failed ?? []) {
    const r = row as {
      id: string
      subject: string
      body: string
      recipient_email: string | null
      template_name: string | null
    }
    if (!r.recipient_email) continue
    const result = await resendSend({
      to: r.recipient_email,
      subject: r.subject,
      html: r.body,
    })
    await supabase
      .from('notifications')
      .update({
        retried_at: new Date().toISOString(),
        status: result.success ? 'sent' : 'failed',
        provider_message_id: result.success ? result.messageId : null,
        error_message: result.success ? null : result.error,
      })
      .eq('id', r.id)
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
    .select('user_id, profiles:profiles!inner(full_name, email)')
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
  const actualRecipient =
    SANDBOX_FALLBACK_RECIPIENT && SANDBOX_FALLBACK_RECIPIENT.length > 0
      ? SANDBOX_FALLBACK_RECIPIENT
      : args.to
  const subjectWithPrefix =
    actualRecipient !== args.to
      ? `[\u2192 ${args.to}] ${args.rendered.subject}`
      : args.rendered.subject

  // Reserve the row. If the dedupe_key collides we skip.
  const { data: inserted, error: insertErr } = await supabase
    .from('notifications')
    .insert({
      sent_by: args.relatedProfileId,
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
    console.error('sendWithLog: insert failed', insertErr)
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
