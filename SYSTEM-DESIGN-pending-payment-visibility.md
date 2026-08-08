# SYSTEM-DESIGN-pending-payment-visibility.md — The Social Seen

> Produced by: Architect agent
> Date: 2026-08-08
> Status: **SPEC — ready for backend-developer / frontend-developer**
> Branch: `claude/pending-payment-visibility-8a198f`

---

## 0. Incident this fixes

Amaya Kaur booked the Summer Rooftop Party, was routed to Stripe Checkout, did not complete
payment, and her booking sat at `status = 'pending_payment'` with no way for her to discover
this, resume payment, or get reminded before the reaper silently cancelled her seat.

Two confirmed root causes (read from code, not guessed):

1. **Visibility gap.** `getMyBookings()` (`src/lib/supabase/queries/profile.ts`) already
   fetches `pending_payment` rows — there is no `.eq('status', ...)` filter on that query.
   The rows are silently **dropped downstream**: `splitBookings()`
   (`src/lib/utils/bookings.ts`) only buckets `confirmed`(+`no_show` for past) and
   `waitlisted`; `pending_payment` matches neither bucket and vanishes from all three
   `/bookings` tabs. `BookingCard`'s `StatusBadge` (`src/components/profile/BookingCard.tsx`
   lines 159–188) also has no `pending_payment` case and falls through to `null`. The only
   place `pending_payment` is ever surfaced today is the transient, `session_id`-gated
   `/events/[slug]/booking-success` redirect page.
2. **No reminder.** `reap_stale_pending_bookings()` (migration `20260515095343`, refined by
   `20260713000002` to add `is_admin_hold = false`) cancels any non-admin-hold
   `pending_payment` row with `stripe_payment_id IS NULL` after `created_at < now() -
   interval '35 minutes'`, on a `*/15 * * * *` pg_cron tick — worst case ~50 minutes of
   silence before the seat is gone. Nothing nudges the member in that window.

This spec closes both gaps without touching the reaper's own predicate (financial-safety
critical, deliberately zero-dependency — see its migration header) and without granting
any new self-service power over `is_admin_hold = true` rows (those keep their existing
admin-managed flow — `SYSTEM-DESIGN-admin-waitlist-promotion-payment.md`).

**DEMO-VISIBLE.** ux-designer / frontend-developer: this ships a new booking-card state
visible at `/bookings` and in a real email. Needs mobile (375/390px) + dark-mode + design
token treatment — see §7's open flag on badge colour/tab placement.

---

## 1. Decision — how a user resumes payment

**Decision: every resume click (button on `/bookings` OR email link) mints a brand-new
Stripe Checkout Session server-side. We never hand back a stored/stale session URL.**

### 1.1 Tradeoff considered

| Option | Pros | Cons |
|---|---|---|
| Reuse `bookings.stripe_checkout_session_id` URL as-is | Zero Stripe API call on resume | The session's own `expires_at` (default 30 min from *original* creation, `src/lib/stripe/checkout.ts`) is completely decoupled from when the user actually clicks. A reminder email sent at T+15 clicked at T+45 (open-and-forget is normal email behaviour) hands the user a dead Stripe page with no recovery path in this app today. |
| Always mint fresh session on resume | Every click is guaranteed valid for a fresh ~30 min regardless of email dwell time; consistent with the existing pattern (`createPaidCheckout`, `createAdminBookingHold` both mint fresh sessions each time they run) | One extra Stripe API round-trip per resume click (cheap); old session stays technically payable until it naturally expires unless we also expire it (see §1.2) |

Fresh-mint wins outright — the stale-URL failure mode is exactly the bug class this task
exists to prevent, and it would be reintroduced immediately by embedding a raw Stripe URL
in an email with unbounded open-latency.

**Corollary — do not put a raw Stripe URL in the reminder email.** The email CTA must link
to an **app URL** (`/bookings/resume/{bookingId}`, §5.2) that mints the session at *click*
time, not at *send* time. This is the piece that actually makes "always fresh" work
end-to-end; a naive implementation that mints the session when the reminder is *sent* would
just move the staleness problem from "the original checkout link" to "the reminder email
link."

### 1.2 Double-session risk (the honest caveat)

Minting a second live session doesn't invalidate the first — a user with two tabs open
(the original checkout tab, still on their screen, plus the freshly resumed one) could in
theory pay via both, since both sessions carry identical `metadata.booking_id` and the
webhook is who-pays-first-wins-into-`confirmed` for that booking, not per-session. To shrink
(not eliminate) this window, resume **best-effort expires** the prior
`stripe_checkout_session_id` before minting the new one — same pattern already established
by `releaseAdminBookingHold`'s step 2 (`src/lib/bookings/admin-hold.ts`): non-blocking,
logged, never rolled back, escalated to Sentry only if the failure looks like "already
paid." This is an accepted residual risk, not a new one — it's the same class already
documented for that function.

### 1.3 Admin holds are explicitly out of scope

Any booking with `is_admin_hold = true` is rejected by the resume path with a clear error
("this spot is managed by our team — check your email"). Those rows already have their own
Stripe link (sent at hold-creation time by `createAdminBookingHold` /
`createAdminPaymentRemediationHold`) and their own revert timeline
(`admin_hold_expires_at`, not the 35-min reaper). Giving them a second, independent
self-service resume path would let a member race the admin flow and create two live
sessions with different origin semantics (`cancelUrlFrom` — see `admin-hold.ts`'s
`ADMIN_HOLD_ORIGINS` table) — structurally the same mistake that table exists to prevent.

### 1.4 Origin-agnostic within self-service

Two RPCs put a row into non-admin-hold `pending_payment`: `book_event_paid` and
`claim_waitlist_spot`. Both produce functionally identical rows for this purpose
(`is_admin_hold = false`, subject to the same reaper predicate). The resume flow does not
need to know or care which one created the row — it only inspects current state.

---

## 2. New column(s)

`booking_fee_pence` and `stripe_fee_pence` already exist
(`20260517000001_add_bookings_fee_columns.sql`) — nothing to add there. `stripe_checkout_
session_id` already exists and is reused as-is (overwritten on every fresh mint, same as
today).

**One new column is needed**: a "reminder already sent" gate.

Precedent check: this codebase has two shapes for "have we already notified this row/
person once" —
- `bookings.is_admin_hold` + `admin_hold_expires_at` (a **boolean flag** + an **unrelated
  deadline** — two different facts, hence two columns; `20260713000001`).
- `profiles.profile_nudge_email_sent_at` (a single **nullable timestamptz** used as both the
  "have we sent it" gate — `IS NULL` — and the audit "when" — non-null value).

This is the second shape: one fact ("have we sent the abandoned-checkout reminder for this
booking"), so it gets **one nullable timestamptz column**, matching `profile_nudge_email_
sent_at`, not the two-column admin-hold shape.

```sql
-- Migration: supabase/migrations/20260808000001_add_bookings_pending_payment_reminder_column.sql
--
-- Adds the "have we reminded this pending_payment booking to complete
-- checkout" gate. See SYSTEM-DESIGN-pending-payment-visibility.md §2.
--
-- Shape follows profiles.profile_nudge_email_sent_at (single nullable
-- timestamptz used as both the send-once gate and the audit timestamp) —
-- NOT the bookings.is_admin_hold / admin_hold_expires_at shape, because
-- unlike that pair this is one fact, not two independent ones.
--
-- Deliberately NOT reset when the booking later transitions away from
-- pending_payment (confirmed via payment, cancelled via reaper or user
-- abandon, etc.) — it stays as a permanent historical marker ("we sent
-- one reminder about this booking, once"), same non-resetting behaviour
-- as profile_nudge_email_sent_at. No CHECK constraint ties it to status
-- for the same reason.
--
-- ── Anon-visibility ──────────────────────────────────────────────────────
-- N/A — bookings has no anon SELECT policy at all (RLS restricts SELECT
-- to row owner + admin; see 20260713000001's identical note). Column
-- inherits the table-wide posture.
--
-- ── Idempotency ────────────────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS. COMMENT ON COLUMN is idempotent by spec.
--
-- ── Safety / blast radius ────────────────────────────────────────────────
-- Purely additive, nullable, no default write. Zero behavioural change
-- until the new pending-payment-reminder cron (20260808000002 +
-- supabase/functions/pending-payment-reminder) starts setting it.
--
-- ── Post-merge ────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pending_payment_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.pending_payment_reminder_sent_at IS
  'Set once when the abandoned-checkout reminder email has been sent (or attempted) for this pending_payment booking. NULL = not yet sent. Gates the pending-payment-reminder pg_cron job (20260808000002) against double-sending; never reset once set, even after the booking later transitions to confirmed/cancelled — matches profiles.profile_nudge_email_sent_at''s non-resetting, once-only semantics. NOT scoped to is_admin_hold rows — those are excluded from this reminder entirely (own admin-managed email flow) and this column is never set for them.';

-- ── No new indexes ─────────────────────────────────────────────────────────
-- Demo scale (mirrors 20260713000001's own "no new indexes" note). If
-- this table ever grows large, a partial index
-- `WHERE status = 'pending_payment' AND pending_payment_reminder_sent_at
-- IS NULL` would directly serve the cron job's own predicate — noted for
-- future, not required now.

-- ── RLS unchanged ──────────────────────────────────────────────────────────
-- Existing bookings policies cover the new column (SELECT: owner or
-- admin; UPDATE: owner or admin — the cron job writes via service_role,
-- which bypasses RLS entirely). No new policy needed.
```

### 2.1 TypeScript type implication

`src/types/index.ts`'s `Booking` interface (line 123) currently has **neither**
`is_admin_hold` nor `pending_payment_reminder_sent_at` (unlike the admin-only
`AdminEventBooking` type, which already carries `is_admin_hold`). Add both as optional-safe
additive fields:

```ts
is_admin_hold: boolean
pending_payment_reminder_sent_at: string | null   // only needed if a future admin view reads it; NOT required by getMyBookings (see §6)
```

`getMyBookings`/`BookingWithEvent` only actually needs `is_admin_hold` selected (§6) — the
reminder timestamp is backend-only bookkeeping, not rendered anywhere member-facing.

---

## 3. Reminder timing

**Decision: a single reminder, sent once, 15 minutes after `created_at`.**

Reasoning against the two real deadlines:
- Stripe's *original* session dies at ~30 min from creation — irrelevant to whether the
  reminder is *useful*, because the reminder's CTA never depends on that session still being
  alive (§1.1's corollary — it mints fresh on click). It's still worth noting 15 min sits
  comfortably before that 30-min mark, so even a "just click here" mental model from the
  member isn't immediately punished.
- The reaper's earliest possible cancellation is `created_at + 35 min`, and because it only
  ticks every 15 minutes, realistic worst case is ~50 min. A 15-minute reminder leaves
  20–35 minutes of real, unhurried time to act — not a "2 minutes left" panic email, and not
  so early it reads as impatient nagging for someone who's still mid-checkout in another tab.
- 15 minutes is also **one pg_cron tick's width** below the reaper's 35-minute floor, so a
  reminder job running on the same `*/15 * * * *` cadence as the reaper can never fire *after*
  a row has already been reaped for the same tick it becomes eligible — comfortable
  separation, not a razor's edge.

**Single reminder, not a schedule** — no strong reason to escalate (an "e.g. one at 15 min,
one at 25 min" schedule) surfaced in review; keep it simple per the task's own steer.

**Eligibility predicate** (mirrors the reaper's five-predicate shape,
`20260713000002`'s version — see §4.2 for the exact SQL the Edge Function issues):

```sql
status = 'pending_payment'
AND stripe_payment_id IS NULL
AND deleted_at IS NULL
AND is_admin_hold = false
AND pending_payment_reminder_sent_at IS NULL
AND created_at <= now() - interval '15 minutes'
```

No upper bound on `created_at` is needed (unlike a naive "only rows 15–30 min old" window):
once a row is reaped, `status` flips away from `pending_payment` and the predicate excludes
it automatically; once paid, `status` flips to `confirmed` and it's excluded too. This makes
the predicate robust to a delayed or skipped cron tick — the same "widen the window, gate on
the sent-at column" robustness fix already applied to `processProfileNudges` in
`daily-notifications/index.ts` after an earlier narrow-window miss.

**Flag for a human product decision:** 15 minutes is my judgment call, not a hard
requirement anywhere in the codebase. 10 or 20 minutes would both be defensible. Fine to
ship at 15 — flagging per the task's own instruction to surface genuinely-ambiguous timing
choices rather than silently picking one.

---

## 4. Send mechanism

### 4.1 New Edge Function, not an extension of `daily-notifications`

`daily-notifications` runs once a day; this needs ~15-minute granularity. Bolting a 15-min
trigger onto that function would mean it either re-runs its entire daily workload every 15
minutes (wasteful, and risks the venue-reveal/reminder/nudge sections tripping their own
dedupe logic under 96x the invocation rate) or grows a conditional "only do section G if
triggered by the fast cron" branch — coupling two independently-important jobs' failure
modes together for no benefit. Same single-responsibility argument the reaper's own
pg_cron-vs-Vercel-cron migration already made for *scheduling*; applying it here to
*function boundaries*.

**New function: `supabase/functions/pending-payment-reminder/`.** Per the task's explicit
constraint, pg_cron cannot call Resend directly (pure SQL) — this needs the same
`pg_net → Edge Function → Resend` path as `daily-notifications`
(`20260514070757_supersede_daily_notifications_schedule_with_vault_pattern.sql`), including
vault-stored secrets and the `CRON_AUTH_TOKEN` legacy-JWT fallback
(`project_supabase_gateway_key_format_inconsistency` memory note).

**Operator burden is smaller than it looks**: `RESEND_API_KEY`, `FROM_ADDRESS`,
`REPLY_TO_ADDRESS`, `CRON_AUTH_TOKEN`, `NEXT_PUBLIC_SITE_URL` are set via `supabase secrets
set` **project-wide** — every Edge Function in the project already has them, including a
brand-new one, with zero extra steps. Only a **new vault secret** for this function's own
URL is required (a second function needs a second URL — `cron_service_role_key` is reused
verbatim, it's the same JWT for any function requiring service-role bearer auth).

### 4.2 What the function does NOT do: call Stripe

Per §1.1's corollary, the reminder email's CTA is an app URL
(`{SITE_URL}/bookings/resume/{bookingId}`), not a Stripe URL. This function therefore never
talks to Stripe — it only needs data already on the `bookings`/`events`/`profiles` rows
(`price_at_booking`, `booking_fee_pence`, event title/date/slug, member name/email) to render
the reminder copy and price breakdown. This keeps the function's failure surface small (no
Stripe API dependency at all) and keeps "mint on click, not on send" honest end-to-end.

### 4.3 Eligibility query (exact predicate, matching §3)

```ts
// Inside the new Edge Function, mirrors getConfirmedAttendees' query shape
// in daily-notifications/index.ts.
const { data: rows } = await supabase
  .from('bookings')
  .select(`
    id, user_id, event_id, price_at_booking, booking_fee_pence, created_at,
    profiles!inner(full_name, email),
    events!inner(title, slug, date_time, venue_name, is_cancelled, deleted_at)
  `)
  .eq('status', 'pending_payment')
  .is('stripe_payment_id', null)
  .is('deleted_at', null)
  .eq('is_admin_hold', false)
  .is('pending_payment_reminder_sent_at', null)
  .lte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
```

Defensive skip inside the loop (belt-and-braces, mirrors `processRetries`' cancelled-event
skip): if the joined `events.is_cancelled` or `events.deleted_at` is set, stamp
`pending_payment_reminder_sent_at` anyway (so it's never retried) but do not send — an
abandoned checkout for a since-cancelled event doesn't need a "come back and pay" nudge.

### 4.4 Send + audit (reuse the existing generic retry path — deliberate synergy)

Insert into `public.notifications` using the **same shape** `sendWithLog()` already uses in
`daily-notifications/index.ts` (`channel: 'email'`, `status: 'pending'` → `'sent'`/`'failed'`,
`dedupe_key`, `recipient_event_id`, `recipient_user_id`). This is a deliberate design
linkage, not incidental: `daily-notifications`' own `processRetries()` section is **generic**
— it retries *any* `channel = 'email' AND status = 'failed'` row within 3 days, regardless of
which function originally created it. Following the identical insert shape means a failed
`pending-payment-reminder` send gets picked up and retried by the existing daily job for
free, with zero new retry logic in the new function.

- `dedupe_key`: `pending_payment_reminder:<booking_id>` (belt-and-braces alongside the
  `pending_payment_reminder_sent_at` column gate — same dual-gate pattern as
  `profile_nudge:<profile_id>` / `profile_nudge_email_sent_at`).
- `template_name`: `'pending_payment_reminder'`.
- `recipient_event_id`: the booking's `event_id` (lets the generic retry loop's
  cancelled-event skip apply here too).
- After each attempt (success or failure), `UPDATE bookings SET
  pending_payment_reminder_sent_at = now() WHERE id = ...` — **stamp regardless of send
  outcome**, same policy as `processProfileNudges`: a failed send is caught and retried by
  the generic retry path; we do not want *this* cron to re-attempt the same booking on its
  own next tick and produce a race with the retry path.

### 4.5 Migration — pg_cron schedule

```sql
-- Migration: supabase/migrations/20260808000002_schedule_pending_payment_reminder.sql
--
-- Schedules the pending_payment abandoned-checkout reminder inside
-- Postgres via pg_cron + pg_net + vault, mirroring
-- 20260514070757_supersede_daily_notifications_schedule_with_vault_pattern.sql
-- exactly (same three extensions, same vault-secret-read-then-http_post
-- DO block shape) but pointed at a NEW Edge Function
-- (supabase/functions/pending-payment-reminder) and a NEW vault secret
-- for that function's URL. Reuses the EXISTING cron_service_role_key
-- vault secret verbatim — same JWT, any Edge Function requiring
-- service-role bearer auth accepts it.
--
-- ── Why NOT folded into reap_stale_pending_bookings()'s own schedule ───────
-- Rejected alternative: append a pg_net call to the reaper's SQL function
-- so one cron tick does both jobs. Rejected because the reaper's own
-- migration explicitly advertises "zero operator setup... no vault, no
-- env vars, no pg_net, no JWT" as a load-bearing safety property — it is
-- deliberately dependency-free so a vault/pg_net/Edge-Function outage can
-- NEVER stop seats from being correctly freed. Coupling a nice-to-have
-- reminder email into that function would trade away that property for
-- no real benefit. Two independent jobs, two independent failure modes,
-- same cadence.
--
-- ── Operator setup required before this cron will fire successfully ────────
-- RESEND_API_KEY / FROM_ADDRESS / REPLY_TO_ADDRESS / CRON_AUTH_TOKEN /
-- NEXT_PUBLIC_SITE_URL are ALREADY set project-wide (daily-notifications
-- setup) — nothing to do there. The ONLY new step:
--   SELECT vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/pending-payment-reminder',
--     'cron_pending_payment_reminder_url',
--     'URL of the pending-payment-reminder Edge Function.'
--   );
-- Until that secret exists, the cron fires every 15 min and no-ops with
-- a RAISE NOTICE (same "succeeds without them" posture as the daily job).
--
-- ── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron       WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net        WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ── Unschedule any existing job ────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('pending-payment-reminder');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ── Schedule ───────────────────────────────────────────────────────────────
-- Every 15 minutes — see §3 for why this cadence is safely below the
-- reaper's 35-minute floor. The eligibility predicate (IS NULL sent-at +
-- age >= 15 min, no upper bound) is robust to a missed/delayed tick, so
-- exact phase relative to the reaper's own schedule doesn't matter.
SELECT cron.schedule(
  'pending-payment-reminder',
  '*/15 * * * *',
  $cron$
  DO $body$
  DECLARE
    v_url  text;
    v_key  text;
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
      WHERE name = 'cron_pending_payment_reminder_url';
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets
      WHERE name = 'cron_service_role_key';

    IF v_url IS NULL OR v_url = '' THEN
      RAISE NOTICE 'pending-payment-reminder skipped: cron_pending_payment_reminder_url not found in vault';
      RETURN;
    END IF;
    IF v_key IS NULL OR v_key = '' THEN
      RAISE NOTICE 'pending-payment-reminder skipped: cron_service_role_key not found in vault';
      RETURN;
    END IF;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 30000
    );
  END;
  $body$;
  $cron$
);

DO $$
BEGIN
  RAISE NOTICE '---';
  RAISE NOTICE 'pending-payment-reminder cron installed (every 15 min).';
  RAISE NOTICE 'Required NEW vault secret (create via Supabase SQL editor if missing):';
  RAISE NOTICE '  SELECT vault.create_secret(''https://<ref>.supabase.co/functions/v1/pending-payment-reminder'', ''cron_pending_payment_reminder_url'');';
  RAISE NOTICE 'Reuses existing cron_service_role_key secret and existing RESEND_API_KEY/FROM_ADDRESS/CRON_AUTH_TOKEN Edge Function env — no other new setup.';
  RAISE NOTICE 'Until the URL secret exists, the cron fires every 15 min and no-ops with a NOTICE.';
  RAISE NOTICE '---';
END $$;
```

---

## 5. Server Action / route contracts (resume-payment)

Shared logic lives in **one new server-only helper**, called by both entry points — mirrors
`runAdminHoldFlow`'s "one implementation, thin wrappers" shape in `admin-hold.ts`.

### 5.1 Shared helper — `src/lib/bookings/resume-checkout.ts` (new file)

```ts
export interface ResumeCheckoutResult {
  success: boolean
  error?: string
  checkoutUrl?: string
}

export async function resumePendingBookingCheckout(
  supabaseUserScoped: SupabaseClient,
  userId: string,
  bookingId: string,
): Promise<ResumeCheckoutResult>
```

Algorithm:
1. Fetch the booking via `supabaseUserScoped` (`id, user_id, event_id, status, is_admin_hold,
   price_at_booking, booking_fee_pence, stripe_checkout_session_id`),
   `.is('deleted_at', null).single()`.
2. **Explicit ownership check** (`booking.user_id !== userId → 'Unauthorised'`) even though
   RLS's `bookings_select` already restricts non-admins to their own row — defence in depth,
   matches `cancelBooking`'s existing pattern, and closes the case where an admin's own
   user-scoped client could otherwise read (but must not be allowed to *resume*) someone
   else's booking through this specific action.
3. `booking.is_admin_hold === true` → reject: `'This booking is managed by our team — check
   your email for a payment link, or contact us.'` (§1.3).
4. `booking.status !== 'pending_payment'` → reject: `'This booking is no longer awaiting
   payment.'`
5. Fetch the event (`title, slug, date_time, is_cancelled, deleted_at`). If cancelled or
   soft-deleted → reject: `'This event has been cancelled.'` If `date_time < now()` → reject:
   `'This event has already taken place.'`
6. **Best-effort** expire `booking.stripe_checkout_session_id` if present — same try/catch,
   non-blocking, "already paid" heuristic as `releaseAdminBookingHold` step 2 (§1.2).
7. `ensureStripeCustomer(adminClient, ...)` — same as `createPaidCheckout`.
8. Build `successUrl`/`cancelUrl` exactly as `createPaidCheckout` does (no `from=` query
   param — default `'book'` rollback semantics in `abandonPendingCheckout` are correct here;
   this is a plain self-service resume, not a claim or admin-hold origin).
9. `createBookingCheckoutSession({ ..., priceInPence: booking.price_at_booking,
   bookingFeePence: booking.booking_fee_pence, stripeCustomerId })` — **reuses the row's own
   snapshot**, not a freshly recomputed fee/price from the current event, so a member who
   booked before a price change still pays what they originally agreed to. Default
   `expiresInSeconds` (30 min) — this is a plain self-service checkout, not an admin hold, so
   it does not need `computeStripeExpirySeconds`.
10. `UPDATE bookings SET stripe_checkout_session_id = <new id> WHERE id = bookingId AND
    status = 'pending_payment'` (optimistic guard, mirrors every existing session-persist
    site). If zero rows match — the booking changed state concurrently (e.g. the reaper's
    tick landed in the gap) — best-effort expire the just-minted session and return: `'This
    booking was just cancelled — check your bookings, or re-book if you'd still like to
    attend.'`
11. Return `{ success: true, checkoutUrl: url }`.

### 5.2 Server Action — `src/app/bookings/actions.ts` (new file)

```ts
'use server'
export async function resumePendingCheckout(bookingId: string): Promise<ActionResult>
```
- Auth via `createServerClient()` + `auth.getUser()` (reject if unauthenticated).
- Delegates to `resumePendingBookingCheckout(supabase, user.id, bookingId)`.
- `revalidatePath('/bookings')` on success.
- Same `ActionResult` shape (`success`, `error`, `checkoutUrl`) already used by
  `createPaidCheckout`/`claimWaitlistSpot` — frontend-developer should reuse/import that
  type rather than redefine it, and reuse the existing client-side "navigate to
  `checkoutUrl`" pattern already wired for those two actions.

### 5.3 Route Handler for the email link — `src/app/bookings/resume/[bookingId]/route.ts` (new file)

```ts
export async function GET(req: NextRequest, { params }: { params: { bookingId: string } }): Promise<Response>
```
- `createServerClient()` + `auth.getUser()`. If unauthenticated → `302` to
  `/login?next=/bookings/resume/${bookingId}` (backend-developer: confirm the existing login
  flow already honours a `next` redirect param before relying on this — not verified as part
  of this spec, flagged in §8).
- Calls the same `resumePendingBookingCheckout(supabase, user.id, bookingId)`.
- Success → `302` redirect straight to `result.checkoutUrl` (one click from the email lands
  the member on a live, freshly-minted Stripe page).
- Failure → `302` redirect to `/bookings?resumeError=<encoded reason>` so the `/bookings`
  page can toast the error client-side (frontend concern, not decided here).

---

## 6. `getMyBookings` — additional SELECT fields

The query already fetches every `pending_payment` row (no status filter exists today) — this
is a select-list change plus the downstream splitting/rendering fix, **not** a new `WHERE`.

Add to the existing `.select()` in `src/lib/supabase/queries/profile.ts`:

```
is_admin_hold, booking_fee_pence
```

- `booking_fee_pence` — `price_at_booking` is already selected; both are needed together to
  render a price breakdown on the pending-payment card (same "ticket + fee = total" shape
  already used in `confirmedUnpaidPaymentLinkTemplate`'s table).
- `is_admin_hold` — the frontend needs this to decide which of two card states to render:
  a **resumable** self-service card (shows the resume button, wired to `resumePendingCheckout`)
  vs. an **admin-managed** card (no resume button — different copy pointing at the email the
  admin flow already sent). Getting this branch wrong would surface a resume button that
  the Server Action would just reject anyway (§5.1 step 3), so it's worth gating in the UI
  too rather than relying solely on the server-side rejection.

`stripe_checkout_session_id` and `pending_payment_reminder_sent_at` are **not** needed by
the frontend — resume always mints fresh (§1.1) and the reminder timestamp is backend
bookkeeping only.

---

## 7. Handoff — what's UI/UX (not decided here)

The following are explicitly **not** architecture decisions and are flagged for
`ux-designer` / `frontend-developer`:

1. **Tab placement.** Does a `pending_payment` booking join the existing `upcoming` bucket
   (it does have a real date, chronologically), get its own new tab, or get folded into
   `waitlisted`'s visual language? `splitBookings()` (`src/lib/utils/bookings.ts`) needs a
   new bucket either way — I'd suggest a dedicated `pendingPayment: BookingWithEvent[]` key
   (filter: `status === 'pending_payment' && !isPastEvent(...)`) rather than overloading
   `upcoming`, so the "action needed" card can visually stand apart from a fully-confirmed
   one — but that's a UX call, not mine to make.
2. **Badge colour.** CLAUDE.md's token table has a real ambiguity here worth flagging
   explicitly: the Colours section lists `--color-danger` as covering "Waitlist badge, sold
   out, errors," but the Component Patterns table says the **Waitlist badge is gold, NOT
   red** ("waitlist is positive"). `BookingCard`'s current `StatusBadge` code matches the
   Component Patterns table (both `confirmed` and `waitlisted` render gold). A
   `pending_payment` badge sits in between those two framings — it's not a failure, but it
   is genuinely time-bound/urgent in a way waitlist isn't. ux-designer should pick gold
   ("still in progress, still positive") vs. danger ("time-sensitive, act now") deliberately
   rather than defaulting either way.
3. **Reminder email copy.** New template `src/lib/email/templates/pending-payment-
   reminder.ts` may structurally mirror `confirmed-unpaid-payment-link.ts`'s CTA-button +
   price-table pattern (explicitly allowed per the task brief), but must NOT reuse its copy
   framing (that template is for a fundamentally different scenario — a confirmed-but-
   unpaid admin remediation, not an abandoned self-service checkout) and must NOT show a
   precise countdown/deadline timestamp the way that template can (`holdExpiresAt` is a
   fixed admin-set deadline there; the reaper's actual cancellation time has ±15 min cron
   jitter and no exact instant to promise). Softer urgency language only (e.g. "to avoid
   losing your place" rather than a specific time).
4. **BookingCard component change.** New `variant: 'pending_payment'` (or equivalent) on
   `src/components/profile/BookingCard.tsx`, new `StatusBadge` case, resume button wired to
   `resumePendingCheckout`. Copy/spacing/mobile layout are ux-designer/frontend-developer
   territory.

---

## 8. Open questions / risks for the developer

1. **Reminder offset (15 min) is a judgment call**, not derived from a hard constraint —
   flagged in §3, fine to ship as-is but worth a sanity nod from product.
2. **Login redirect param.** §5.3 assumes `/login?next=...` is already honoured by the
   existing login flow. Not verified in this pass — backend-developer should confirm before
   relying on it, or fall back to a session-storage-based "return here after login" pattern
   if it isn't.
3. **Double-session residual risk (§1.2)** is accepted, not eliminated. Same class of risk
   already live and documented for `releaseAdminBookingHold`. No new mitigation proposed
   beyond the existing best-effort-expire pattern; flagging in case a stricter mitigation
   (e.g. actually blocking a second Checkout mint while a first is still within its expiry
   window) is wanted later.
4. **`_shared` Edge Function helpers.** `pending-payment-reminder` needs the same
   `resendSend()` / audit-insert / `isAuthorizedRequest` plumbing `daily-notifications`
   already has. Recommend extracting to `supabase/functions/_shared/` during
   implementation rather than duplicating verbatim a second time — not mandatory (this
   codebase already tolerates some deliberate duplication, e.g. `resolveSiteOrigin()` in
   `admin-hold.ts`), but worth a call from backend-developer given this is now the *second*
   copy.
5. **Migration ordering**: `20260808000001` (column) must land before
   `20260808000002` (schedule) is meaningfully useful (the Edge Function reads/writes the
   new column) — no hard DB dependency between them (the cron migration doesn't reference
   the column in SQL), but ship and `supabase db push --include-all --linked` them together,
   in that order, per `project_migration_apply_step` memory note.

---

## 9. File manifest

**New migrations (architect-specified SQL above, to be applied as real migration files by
backend-developer):**
- `supabase/migrations/20260808000001_add_bookings_pending_payment_reminder_column.sql`
- `supabase/migrations/20260808000002_schedule_pending_payment_reminder.sql`

**New application files (backend-developer):**
- `src/lib/bookings/resume-checkout.ts`
- `src/app/bookings/actions.ts`
- `src/app/bookings/resume/[bookingId]/route.ts`
- `supabase/functions/pending-payment-reminder/index.ts` (+ shared Deno helpers per §8.4)
- `src/lib/email/templates/pending-payment-reminder.ts` (copy pending ux-designer input per §7.3)

**Modified files:**
- `src/lib/supabase/queries/profile.ts` — `getMyBookings` select list (§6)
- `src/types/index.ts` — `Booking` interface gains `is_admin_hold`,
  `pending_payment_reminder_sent_at` (§2.1)
- `src/lib/utils/bookings.ts` — `splitBookings()` new bucket (§7.1, shape TBD by ux-designer)
- `src/components/profile/BookingCard.tsx` — new variant + `StatusBadge` case + resume button
  (§7.4)

No RLS policy changes. No changes to `reap_stale_pending_bookings()`,
`abandonPendingCheckout`, `admin-hold.ts`, or any admin-hold RPC — all confirmed
unaffected by this design (§1.3, §1.4).
