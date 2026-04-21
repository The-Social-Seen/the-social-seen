# Follow-ups

Items flagged during batches that were deliberately out of scope at the time. Maintained at the end of each batch so nothing gets lost in merged PR descriptions.

**Format:** short title, source batch, brief rationale, rough priority. Priorities are guidance, not commitment — re-weigh when you have bandwidth to pick something up.

**Flow:**
1. Flagged during a batch → added here at end of batch.
2. Revisited at end of each sprint — anything still relevant either gets picked up, converted to a GitHub issue, or explicitly dropped.
3. When actioned → remove from this file and reference the PR that closed it in the commit message.

---

## 🔴 Security / compliance

### Tighten `profiles` anon GRANT list further
**Source:** P2-2 code review (re-review)
**Rationale:** Current anon-safe list includes `email`, `onboarding_complete`, `referral_source`, `updated_at`, `deleted_at`. None of these are actively leaking PII, but they're over-permissive under the "secure by default" principle. Email in particular is arguably PII (spammer fodder).
**Action:** New migration that removes `email`, `onboarding_complete`, `referral_source`, `updated_at`, `deleted_at` from the anon GRANT list, leaving only columns genuinely needed by public event rendering. Verify via curl against the REST endpoint that each removed column returns 401 for anon.
**Priority:** Medium. Not a current leak, but worth doing before any real signups hit production.

### Migration checklist — document "new profile column = explicit anon decision"
**Source:** P2-2 code review (re-review)
**Rationale:** Security model shifted to "secure by default" on `profiles` — every future migration adding a column needs a conscious decision about anon visibility. Not written down anywhere, so future work could regress.
**Action:** Add a line to `CLAUDE.md` and/or `social-seen-safety-SKILL.md` under the migration checklist: *"If adding a column to `public.profiles`, decide anon visibility. Omit from the anon GRANT list unless the column is safe to expose publicly."*
**Priority:** Medium. Prevents regression. 5-minute fix.

### `email_verified` reconciliation path
**Source:** P2-3 backend handover
**Rationale:** `verifyEmailOtp()` soft-succeeds if the DB update to `profiles.email_verified = true` fails after Supabase already accepted the OTP. User sees success but their flag is still false; they can't book until they verify again.
**Action:** On every authenticated page load (or middleware), check whether Supabase's `auth.users.email_confirmed_at` diverges from `profiles.email_verified` and sync. Or: make the DB update non-soft-failing but with a better error message.
**Priority:** Low. Rare edge case, and user's recovery (verify again) is acceptable.

---

## 🟡 UX / polish

### Phone input `maxLength` attribute
**Source:** P2-2 code review
**Rationale:** Defensive nicety — paste attack mitigation. Not a real risk (zod + DB CHECK reject), but cheap.
**Action:** Add `maxLength={24}` to the phone input in `src/app/(auth)/join/join-form.tsx`. Fits `+44 7123 456 789` formatted.
**Priority:** Low. 1-line fix.

### Phone helper text position consistency
**Source:** P2-2 code review
**Rationale:** The phone field's "For event reminders and venue details" helper appears below the input, while every other field's helper text (e.g. `(optional)` on "How did you hear about us?") is inline with the label. Visual inconsistency.
**Action:** Either move the helper next to the label, or convert all other inline helpers to below-input style. UX designer call.
**Priority:** Low.

<!-- Resolved in P2-3 polish pass: extracted `<OtpDigits>` to
     src/components/auth/OtpDigits.tsx; verify-form now 312 lines (-79). -->


### Email consent checkbox class duplication
**Source:** P2-2 code review
**Rationale:** The `Checkbox.Root` has both `emailConsent ? 'border-gold bg-gold'` and the `Checkbox.Indicator` already only renders when checked — slight class churn.
**Action:** Minor cleanup in `join-form.tsx:295-307`.
**Priority:** Very low. Cosmetic.

### `.env.example` grouping
**Source:** P2-2 code review
**Rationale:** `SUPABASE_ACCESS_TOKEN` is currently under its own "Supabase CLI" section. Would be more scannable grouped under the existing `# ─── Supabase ───` block.
**Priority:** Very low. Cosmetic.

---

## 📈 Analytics & measurement

### Track `email_consent` opt-in rate on signup
**Source:** P2-2 code review
**Rationale:** Currently the `sign_up` event payload is `{ method: "email" }`. No visibility into how many users opt into marketing consent. Useful for growth analytics and GDPR records.
**Action:** Extend the event schema in `src/lib/analytics/track.ts` to include `email_consent: boolean`. Update `join-form.tsx` to pass it.
**Priority:** Medium. Low effort.

### Distinguish source on `email_verification_requested`
**Source:** P2-3 frontend handover
**Rationale:** The event schema supports `source: 'banner' | 'modal' | 'direct'`, but in practice every fire is `'direct'` because both the banner and the modal navigate to `/verify`, which auto-sends on mount. We can't see whether banner-clicks or modal-clicks convert better.
**Action:** Either pass `?source=banner` / `?source=modal` query params from the link href and read in the verify form, or fire `email_verification_requested` from the banner/modal click handlers themselves (before navigation) and skip the auto-send fire on the verify page. The query-param approach is simpler.
**Priority:** Low. Funnel works without it; the distinction is nice-to-have for source attribution.

---

<!-- Resolved by fix/image-host-fallback (pre-Sprint-2-P2-7):
     `src/lib/utils/images.ts` now exports `isAllowedImageHost()` and all
     three resolve helpers return null for disallowed hosts. +8 new tests.
     Event detail pages no longer crash on seed data. -->

---

## 🧹 P2-6 code-review follow-ups (low priority cleanup)

### Refactor ShareActions feature-detect to `useSyncExternalStore`
**Source:** P2-6 code review (I1)
**Rationale:** `src/components/shared/ShareActions.tsx:40-55` uses `useState(false) + useEffect(() => setState(...))` with an `eslint-disable-next-line react-hooks/set-state-in-effect` to suppress the rule. `useSyncExternalStore` is React's canonical pattern for reading post-hydration browser capabilities — one-shot paint, no effect cascade, no eslint-disable.
**Action:** Replace the `useState` + `useEffect` pair with `useSyncExternalStore(() => () => {}, () => navigator.share != null, () => false)`.
**Priority:** Very low. Works correctly today.

### Timer-overlap flicker in "Copied" state
**Source:** P2-6 code review (I2)
**Rationale:** `handleCopy` and `handleNativeShare` both write to the same `copied` state with independent `setTimeout` handles. Rapid successive clicks can make the "Copied" label flicker for one tick before settling. `src/components/shared/ShareActions.tsx:69-95`.
**Action:** Track the timer with a `useRef`; clear the previous timer before starting a new one.
**Priority:** Very low.

### Share copy string duplicated
**Source:** P2-6 code review (I4)
**Rationale:** `Join me at ${eventTitle}` appears inline in both `ShareActions.tsx:88` (native share text) and `share.ts:29` (WhatsApp message). They can drift.
**Action:** Export a `buildShareText(title: string)` helper from `src/lib/utils/share.ts` and use it in both places.
**Priority:** Very low.

### `BookingModal` "Link copied" toast now also fires on native-share success
**Source:** P2-6 code review (I5)
**Rationale:** Previous behaviour was clipboard-only. After the refactor, the `linkCopied` state is set for both `'copied'` AND `'shared'` outcomes — meaning the "Link copied" toast appears when the user actually used a native share sheet (WhatsApp, AirDrop, etc.). Cosmetic copy drift.
**Action:** Either rename the state and copy to be outcome-agnostic ("Shared!") or branch on outcome in the handler. `src/components/events/BookingModal.tsx:504-513`.
**Priority:** Very low.

### `buildEventShareUrl` SSR fallback returns relative URL
**Source:** P2-6 code review (S1)
**Rationale:** `src/lib/utils/share.ts:16-20` returns `/events/${slug}` when `window` is undefined. Callers today fire from click handlers only, but a future Server Component prebuilding a share href would quietly break (relative URLs don't work in pasted messages).
**Action:** Either throw in dev (`process.env.NODE_ENV !== 'production'`) as a tripwire, or take the origin as an explicit parameter for Server usage.
**Priority:** Very low. Defensive.

---

## 🧪 Testing gaps

### Server-side integration tests for `book_event()` RPC
**Source:** P2-3 backend handover
**Rationale:** The new email_verified guard in `book_event()` is only covered by a live staging smoke test (anon-style call via service role). Vitest can't run Supabase functions directly.
**Action:** When Playwright E2E tests are introduced (mentioned in CLAUDE.md as a stretch goal after Batch 5), add coverage for:
- Unverified user → book → "Verify your email before booking" error
- Verified user → book → success
- Cancelled event → even if verified, correct error
- Capacity exceeded → correct waitlist behaviour
**Priority:** Medium. Important before we're shipping payments (P2-7).

### Countdown-tick test in verify-form
**Source:** P2-3 polish pass (after extracting `<OtpDigits>`)
**Rationale:** Paste-to-fill and backspace navigation are now well-covered on the new `OtpDigits` component (12 tests in `src/components/auth/__tests__/OtpDigits.test.tsx`). The remaining gap is the resend-button countdown in the parent verify-form: an initial "Resend in 60s" assertion is in place, but ticking the timer down to 0 and asserting the button enables proved fiddly with vitest fake timers + the async auto-send effect.
**Action:** Wrap the test in `act()` with explicit microtask draining (`await Promise.resolve(); await Promise.resolve()`) before advancing fake timers, OR refactor the verify-form's countdown to use a recursive `setTimeout` (easier to mock than `setInterval` inside a `[secondsLeft]`-deps effect). The functional behaviour is simple enough that the regression risk is low; an E2E test would catch any real failure.
**Priority:** Low. Existing tests cover the entry/initial states; this is the per-tick verification.

<!-- Resolved in P2-3 polish pass: created src/lib/utils/redirect.ts
     with `sanitizeRedirectPath()` + 12 unit tests. login-form and
     verify-form now use it. (reset-password-form had no redirect param
     to sanitise — always pushes to /login.) -->


### Migrate Server Action error wording to discriminated codes
**Source:** P2-3 code review
**Rationale:** The verify-form keys off literal substrings in error messages (`"signed in"`, `"wait"`, `"rate"`, `"invalid"`). If backend wording drifts, frontend silently misclassifies the error and routes to the wrong UI state or analytics reason.
**Action:** Move from `{ error: string }` to `{ error: string, code: 'unauthenticated' | 'rate_limited' | 'invalid_code' | ... }` for verification Server Actions. Frontend keys off `code`; the `error` string is purely for display.
**Priority:** Low. Acceptable today (errors are co-located with the consuming UI), but worth doing when the verification Server Action surface grows.

### Singleton browser client test-isolation concerns
**Source:** P2-1 code review
**Rationale:** `createClient()` is now a module-level singleton in `src/lib/supabase/client.ts`. Every test mocks `@/lib/supabase/client` via `vi.mock`, which is fine. But if an integration-style test ever doesn't mock, state could leak between tests.
**Action:** Add a dev/test-only reset helper to the singleton (exported from the client module behind a `__TEST_ONLY__` guard, or via a separate `/__test/reset` export).
**Priority:** Low. Speculative — no failing test today.

---

## 📝 Documentation

### Resend domain verification (BLOCKS P2-4 demo)
**Source:** P2-4 prep test
**Rationale:** Resend's free-tier sandbox mode (without a verified domain) will ONLY send emails to the account owner's address — `mitesh@skillmeup.co`. Sending to any other recipient returns HTTP 403 `validation_error`. This means P2-4 transactional emails (welcome, booking confirmation, venue reveal, etc.) work for the account owner only until DNS is verified.
**Action:** Cofounder adds the 3 DNS records (SPF, DKIM, DMARC) Resend gives you to `the-social-seen.com`. Verification usually takes 5 min – 48 h depending on the DNS provider. Then update the FROM address from `onboarding@resend.dev` to `hello@the-social-seen.com` (or whichever is chosen) — single-line change in `src/lib/email/send.ts`.
**Priority:** HIGH — blocks demo. Start the cofounder hand-off now.

### Document Supabase Auth Management API config
**Source:** P2-3 backend handover
**Rationale:** Several Supabase auth settings are now configured live via the Management API (`mailer_otp_length: 6`, `mailer_otp_exp: 600`, plus future changes). These aren't represented anywhere in git, so production deployment will need the same PATCH calls and nobody will remember.
**Action:** Create `docs/SUPABASE-CONFIG.md` documenting the current non-default settings and a curl snippet to re-apply them. Update whenever a config change is made. Alternatively, a small `scripts/apply-supabase-config.sh` that wraps the API calls.
**Priority:** Medium. Will bite hard when we create the production project and forget what was customised.

### Wire Supabase OTP email through Resend
**Source:** P2-4 backend handover
**Rationale:** Supabase's default OTP email still flows via Supabase's built-in mailer, not Resend. Means OTP emails aren't branded and aren't logged in our notifications audit. We've built the `otpVerificationTemplate` already; just need to swap the delivery path.
**Action:** Two options:
1. **Configure Supabase to use Resend as its SMTP provider** via the Management API (`POST /v1/projects/{ref}/config/auth` with `smtp_host`, `smtp_user='resend'`, `smtp_pass=$RESEND_API_KEY`, `smtp_admin_email='hello@the-social-seen.com'`). Lowest code change but Supabase will still use its own template — we'd need to also customise the template via the Management API to render our HTML.
2. **Custom OTP issuance**: generate the 6-digit code ourselves, store with TTL in a `verification_codes` table, send via our Resend wrapper using `otpVerificationTemplate`, verify by lookup. More code but full control + audit logging.
**Priority:** Medium. Useful for branding consistency and admin retry visibility, but Supabase's default works.

### Admin retry view for failed notifications
**Source:** P2-4 backend handover
**Rationale:** The `notifications` table now logs every email send (success and failure) but there's no UI to surface failures. If a welcome email or booking confirmation fails (e.g. Resend rate limit, transient outage), nobody knows.
**Action:** Add an admin page at `/admin/notifications/failures` that lists rows where `channel = 'email' AND status = 'failed'` ordered by `sent_at DESC`. Each row gets a "Retry" button that re-fires the send via the original template (template_name + recipient_email + body are stored). Use the existing admin-only RLS — no new policies needed.
**Priority:** Medium. Currently failures are only visible via DB query.

### React Email migration
**Source:** P2-4 backend handover
**Rationale:** P2-4 templates use hand-written inline-style HTML in `src/lib/email/templates/`. Works, but the dev experience for designing rich emails with tables, columns, and cross-client compatibility is painful. React Email (`@react-email/components` + `@react-email/render`) gives JSX-style template authoring and renders to email-safe HTML. Cost: ~25kb of dev/build deps.
**Action:** Add `@react-email/components` + `@react-email/render`, migrate the three existing templates (welcome, booking-confirmation, otp-verification) to JSX. Tests stay roughly the same since they assert on the rendered HTML output.
**Priority:** Low. Current templates work fine. Revisit once we have 5+ templates.

### PII purge cascade for email audit log
**Source:** P2-4 code review
**Rationale:** `notifications.body` stores the full rendered HTML of every email sent. For booking confirmations that includes the recipient's full name and the venue address. The `sent_by` FK has `ON DELETE CASCADE` from profiles, so when account-deletion lands in P2-8 the audit row IS removed for the deleted user. But emails sent on behalf of OTHER users (e.g. admin announcements that mention this user) wouldn't cascade. Worth a deliberate purge step in the GDPR-deletion flow that also nulls/scrubs `body` for any row referencing the deleted user.
**Action:** When P2-8 builds the GDPR deletion path, audit `notifications` for rows whose `body` (HTML) or `recipient_email` references the deleted user, and either delete or null those fields.
**Priority:** Medium — required for full GDPR compliance before launch.

### Sentry tagging on email audit-log soft-fail
**Source:** P2-4 code review
**Rationale:** When the `notifications` insert fails inside `sendEmail`, we `console.error` and swallow. Sentry's auto-instrumentation does pick up console.error, but explicit `Sentry.captureException(err, { tags: { surface: 'email-audit-log' } })` adds a filterable tag and richer context.
**Action:** Replace the `console.error` in `src/lib/email/send.ts:logSendAttempt` with `Sentry.captureException(err, { tags: { surface: 'email-audit-log', template: input.templateName } })`.
**Priority:** Low — observability nice-to-have.

### Production warning on `getSiteUrl()` fallback
**Source:** P2-4 code review
**Rationale:** `getSiteUrl()` in `src/lib/email/templates/_shared.ts` falls back to a hardcoded Vercel preview URL when both `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_VERCEL_URL` are unset. In production this means a misconfiguration would silently route email links to the preview deploy instead of failing loudly.
**Action:** Add `if (process.env.NODE_ENV === 'production') console.warn('NEXT_PUBLIC_SITE_URL not set; emails will link to the preview URL')` in the fallback branch. Or throw — but warn is safer for the demo.
**Priority:** Low — soft fallback works, just easier to miss a misconfig.

### Unsubscribe page + per-template suppression list
**Source:** P2-4 backend handover
**Rationale:** Every email currently has a placeholder unsubscribe link (`href="#"`). UK GDPR + PECR require a working one-click unsubscribe for marketing emails. Transactional emails (booking confirmations, OTP) are exempt, but marketing-adjacent ones (event reminders, post-event review requests in P2-5/P2-10) need it.
**Action:** Build `/unsubscribe?token=<signed-token>` page that toggles `profiles.email_consent = false`, AND introduce a `notification_preferences` table for per-template granularity (e.g. "I want booking confirmations but not event reminders"). Email send wrapper checks preferences before sending.
**Priority:** Medium. Required before launching email marketing in Phase 3, also a soft requirement for the Sprint 2 venue-reveal/reminder emails.

---

## 🧩 P2-5 operator setup (once per environment)

### Deploy `daily-notifications` edge function and configure cron
**Source:** P2-5 backend
**Rationale:** The daily edge function + cron scheduling land as code in this batch, but each Supabase project needs per-environment wiring before they do anything.
**Action (per environment — staging now, production later):**
1. Apply the three new migrations (`20260421000002` → `20260421000004`) via `supabase db push`.
2. `supabase functions deploy daily-notifications --no-verify-jwt`
3. `supabase secrets set RESEND_API_KEY=... FROM_ADDRESS='The Social Seen <onboarding@resend.dev>' REPLY_TO_ADDRESS=info@the-social-seen.com SANDBOX_FALLBACK_RECIPIENT=mitesh@skillmeup.co NEXT_PUBLIC_SITE_URL=https://the-social-seen.vercel.app` (omit `SANDBOX_FALLBACK_RECIPIENT` in prod).
4. Via SQL editor: `ALTER DATABASE postgres SET app.settings.edge_function_url = 'https://<ref>.supabase.co/functions/v1/daily-notifications';` and `ALTER DATABASE postgres SET app.settings.service_role_key = '<jwt>';`
5. Verify: `curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/functions/v1/daily-notifications" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"` — should return `{ ok: true, counts: {...} }`.
**Priority:** P2-5 blocker. Must be done before scheduled emails fire (otherwise the cron logs a NOTICE and exits — no harm, just no email).

### Integration test for edge function date-window selection
**Source:** P2-5 backend
**Rationale:** Unit-testing the Deno edge function's selection queries from Vitest is awkward (Deno runtime + remote imports). Current coverage is template rendering on the Node side plus a manual smoke test. An integration test (seed DB → invoke function → assert `notifications` rows) would catch regressions in the scheduled-job logic.
**Priority:** Medium.

### Admin "failed notifications" view with retry button
**Source:** P2-5 plan (deferred to P2-9)
**Rationale:** P2-5 plan mentions this but it fits more naturally with the other admin QoL work in P2-9. The retry mechanism in the edge function is the automatic half; this is the manual half.
**Action:** New page under `src/app/(admin)/admin/notifications/failed/page.tsx` listing `notifications` where `channel='email' AND status='failed'`, with a "Retry" button that invokes `sendEmail()` with the stored `body`/`subject`/`recipient_email`.
**Priority:** Medium — lands in P2-9.

### `sendWithLog` silently drops sends on non-dedupe insert failure
**Source:** P2-5 code review
**Rationale:** In the daily edge function, if the `notifications` INSERT fails with anything other than 23505 (e.g. transient connection hiccup, CHECK violation), we log via `console.error` and return `false` — the email is never attempted and the retry loop can't see it (retry queries for `status='failed'` rows, but this row was never written). So drops are invisible.
**Action:** Either attempt the send before writing the audit row (and log both outcomes), or emit a distinct `Sentry.captureException` with `tags: { surface: 'edge-function-audit-insert' }` so these drops don't hide among legitimate 23505s in log volume. `supabase/functions/daily-notifications/index.ts:461-468`.
**Priority:** Low — path is monitored via console.error → Sentry, but misclassified.

### Retry loop doesn't filter by event state
**Source:** P2-5 code review
**Rationale:** `processRetries` re-sends any failed `notifications.email` row < 3 days old without checking whether the underlying event was subsequently cancelled or soft-deleted. A cancelled event producing a retry-delivered reminder the next day would be confusing.
**Action:** When retrying, re-parse the `template_name` / `dedupe_key` to recover the event id, then skip if the event is now `is_cancelled = true` or `deleted_at IS NOT NULL`. Or (simpler) store `recipient_event_id` on the reminder rows (it's currently only populated for admin announcements) and filter on that in the retry query. `supabase/functions/daily-notifications/index.ts:358-384`.
**Priority:** Low — rare edge case at current event volume.

### Retry path has a theoretical double-send race under concurrent invocation
**Source:** P2-5 code review
**Rationale:** If the function is invoked twice concurrently (manual backfill while cron fires), two runs could both pick up the same failed row, both re-send, both update `retried_at`. The 12-hour cooldown window makes this unlikely in practice but not impossible.
**Action:** 2-line mitigation: change the retry `UPDATE` to an optimistic guard — `.eq('retried_at', row.retried_at ?? null)` — so the second concurrent update no-ops. Or use a `SELECT ... FOR UPDATE SKIP LOCKED` via an RPC. The first option is cheaper.
**Priority:** Very low.

### No attendee-batch cap in the daily function
**Source:** P2-5 code review
**Rationale:** The function sends to every confirmed attendee sequentially in a single run. At Resend free-tier rate limits (~2 req/sec) a 600-attendee event would need ~5 min which is close to the edge function timeout. Not an issue at demo scale (20-40 attendees) but a trap for Phase 3.
**Action:** Introduce a batch loop with a sleep between batches (e.g. 20 per second). Or use Resend's batch-send API (`resend.batch.send`) which bundles up to 100 recipients in one call. `supabase/functions/daily-notifications/index.ts:176-200`.
**Priority:** Low — revisit before growth.

### `type: 'reminder'` hardcoded for all new system-email rows
**Source:** P2-5 code review
**Rationale:** `sendWithLog` inserts every new row with `type = 'reminder'` regardless of whether it's `venue_reveal`, `review_request`, `reminder_2day`, or `reminder_today`. Column is informational only (no code branches on it) so not a bug, but it makes the admin notifications view misleading.
**Action:** Either extend the `notification_type` enum with `venue_reveal` + `review_request`, or map to the closest existing value (`event_update` for venue_reveal; `reminder` stays for the two reminder variants). Enum change is cleaner but requires a migration.
**Priority:** Very low.

### Hide venue on public event listing cards
**Source:** P2-5 frontend
**Rationale:** `EventCard.tsx` still shows `venue_name` on listing cards. The P2-5 plan scopes the reveal gate to the event detail page, so cards are unchanged for now. Arguably the venue name on the card is part of the teaser; arguably it should be hidden for consistency with the detail page.
**Action:** Replace the `venue_name` label on cards with "Venue revealed 1 week before" when `venue_revealed = false`. UX call whether we want this.
**Priority:** Low.

---

## 🚀 Out-of-scope product ideas (Phase 3+)

These were mentioned in reviews or handovers but are explicitly Phase 3 — logged here for completeness, not action.

- **Ban-bypass mitigation** (P2-2 code review) — when P2-8 implements banning, the ban check should key on phone number + email domain, not just `profiles.id`. Otherwise a banned user can sign up again with a different email.
- **Per-owner column grants on `phone_number`** — if we ever let authenticated non-admin members browse other members' profiles, `phone_number` should be visible only to row owner + admins. Requires a security-definer function or view.
- **Email as hidden column** — related to the first item in the security section. Worth its own migration eventually.
