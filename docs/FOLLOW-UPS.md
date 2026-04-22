# Follow-ups

Open technical debt and polish items — things deliberately scoped out of a batch that should still land eventually. Phase 3 new-feature items live in `docs/PHASE-3-BACKLOG.md`; this file is the maintenance backlog.

**Format:** short title, source, brief rationale, rough priority.

**Flow:**
1. Flagged during a batch → added here at end of batch.
2. Revisited at end of each sprint.
3. When actioned → remove from this file and reference the PR in the commit message.

**Last tidy:** after Phase 2.5 wrap (PR #39 — 25 shipped items removed, 5 feature items moved to PHASE-3-BACKLOG).

---

## 🔴 Security / compliance

### Dedicated `UNSUBSCRIBE_TOKEN_SECRET` — rotate off the service-role fallback
**Source:** Phase 2.5 Batch 2 code review.
**Rationale:** Unsubscribe + newsletter HMAC tokens fall back to `SUPABASE_SERVICE_ROLE_KEY` as the signing secret when `UNSUBSCRIBE_TOKEN_SECRET` is unset. Works for v1; rotating the service role key (ever) silently invalidates every outstanding token in flight.
**Action:** Mint a dedicated 32+ byte random secret, set `UNSUBSCRIBE_TOKEN_SECRET` in Vercel (Preview + Production) + `supabase secrets set` on the edge function. One-line code change; already supported.
**Priority:** Medium — do before any pipeline that rotates the service role key.

### `email_verified` reconciliation path
**Source:** P2-3 backend handover.
**Rationale:** `verifyEmailOtp()` soft-succeeds if the DB update to `profiles.email_verified = true` fails after Supabase already accepted the OTP. User sees success but their flag is still false; they can't book until they verify again.
**Action:** On every authenticated page load (or middleware), check whether `auth.users.email_confirmed_at` diverges from `profiles.email_verified` and sync. Or make the DB update non-soft-failing with a better error message.
**Priority:** Low — rare edge case, recovery (verify again) is acceptable.

### Middleware `profiles.status` round-trip on every authenticated request
**Source:** P2-8a code review.
**Rationale:** Middleware reads `profiles.status` + `deleted_at` for every authenticated request to support immediate ban/delete enforcement. At demo scale (~1000 members) it's unnoticeable; at real scale or on cold-start serverless it adds measurable p95 latency.
**Action:** Move `status` + `deleted_at` into a Supabase Auth JWT custom claim via an auth hook. Ban-taking-effect time becomes "until next token refresh" (≤1 hour) rather than "immediate" — acceptable for the threat model.
**Priority:** Low.

### Sandbox `replyTo` is not rewritten — replies escape the sandbox
**Source:** P2-12 pre-push code review.
**Rationale:** `sendEmail` rewrites `to` to the sandbox recipient when `SANDBOX_FALLBACK_RECIPIENT` is set, but `replyTo` passes through. For contact-form sandbox testing, the team replies from the sandbox inbox and the reply lands with the real visitor — confusing, cross-environment.
**Action:** Either (a) also rewrite `replyTo` to the sandbox recipient when sandbox is active, or (b) document in `src/lib/email/send.ts` JSDoc.
**Priority:** Low.

---

## 🟡 UX / polish

### Phone input `maxLength` attribute
**Source:** P2-2 code review.
**Rationale:** Defensive nicety — paste-attack mitigation. Not a real risk (zod + DB CHECK reject).
**Action:** `maxLength={24}` on the phone input in `src/app/(auth)/join/join-form.tsx`. Fits `+44 7123 456 789` formatted.
**Priority:** Very low.

### Phone helper text position consistency
**Source:** P2-2 code review.
**Rationale:** "For event reminders and venue details" appears below the input; other fields' `(optional)` helpers are inline with the label. Visual inconsistency.
**Priority:** Very low.

### Email consent checkbox class duplication
**Source:** P2-2 code review.
**Rationale:** Small class churn in `join-form.tsx:295-307`.
**Priority:** Very low.

### `.env.example` grouping
**Source:** P2-2 code review.
**Rationale:** `SUPABASE_ACCESS_TOKEN` lives in its own "Supabase CLI" section. Would scan better grouped with the main `# ─── Supabase ───` block.
**Priority:** Very low.

### `<InstagramFollowSection>` link doesn't announce "opens in new tab"
**Source:** P2-12 pre-push code review.
**Rationale:** Screen-reader hint for new-tab behaviour is missing on `target="_blank"` links.
**Action:** Add `aria-label="Follow @the_social_seen on Instagram (opens in a new tab)"` + `aria-hidden="true"` on the lucide icon.
**Priority:** Low.

### Honeypot field name `company_website` sits next to a real `website` field on /collaborate
**Source:** P2-12 pre-push code review.
**Rationale:** A sophisticated bot could clock the proximity and skip only `company_website`. The 2-second timing + Turnstile are the real defence; this is pure defence-in-depth.
**Action:** Rename `HONEYPOT_FIELD` constant in `src/app/contact/actions.ts` + the matching `<input>` in both forms. Three-file find-and-replace.
**Priority:** Very low.

### `/?account_deleted=1` lands silently on the homepage
**Source:** P2-8b code review.
**Rationale:** After account deletion the user is redirected to `/?account_deleted=1` but there's no UI handler — normal landing page with no visible confirmation. Redirect is signal, but an explicit "Your account has been closed" toast would be nicer.
**Action:** Client Component in the root layout that reads `?account_deleted=1`, shows a toast, strips the param. Mirror `BookingCancelledHandler`.
**Priority:** Low.

### Legal-page "Last updated" dates are hardcoded
**Source:** P2-8b code review.
**Rationale:** `/privacy` + `/terms` both hardcode "Last updated: 21 April 2026" at the top. Two places to remember when re-publishing after a policy change.
**Action:** Extract to a shared constant in `src/app/(legal)/_constants.ts`, or pull from git log at build time.
**Priority:** Very low.

### Square `/logo.png` asset for Organization JSON-LD
**Source:** Phase 2.5 Batch 6.
**Rationale:** `organizationJsonLd()` now emits `logo` as a proper `ImageObject` but still references `/og-image.jpg` (1200×630, wide). Google's Knowledge Panel reserves a near-square area and crops the wide asset awkwardly.
**Action:** Upload a 600×600 square logo to `public/logo.png`, update three fields in `src/lib/seo/organization.ts:20-24` (url + width + height).
**Priority:** Low — operator asset dependency.

### Hide venue on public event listing cards
**Source:** P2-5 frontend.
**Rationale:** `EventCard.tsx` still shows `venue_name` on listing cards even when `venue_revealed = false`. The reveal gate scopes to the detail page; cards are arguably part of the teaser.
**Action:** Replace the `venue_name` label with "Venue revealed 1 week before" when `venue_revealed = false`. UX call.
**Priority:** Low.

---

## 📈 Analytics & measurement

### (none open — Phase 2.5 Batch 7 closed the analytics backlog.)

---

## 🧹 ShareActions / sharing polish (P2-6)

### Refactor ShareActions feature-detect to `useSyncExternalStore`
**Source:** P2-6 code review.
**Rationale:** `src/components/shared/ShareActions.tsx:40-55` uses `useState(false) + useEffect(() => setState(...))` with an `eslint-disable-next-line` to suppress the rule. `useSyncExternalStore` is the canonical pattern for reading post-hydration browser capabilities.
**Action:** Replace with `useSyncExternalStore(() => () => {}, () => navigator.share != null, () => false)`.
**Priority:** Very low.

### Timer-overlap flicker in "Copied" state
**Source:** P2-6 code review.
**Rationale:** `handleCopy` and `handleNativeShare` both write `copied` with independent `setTimeout`s. Rapid clicks can flicker the label for one tick.
**Action:** Track the timer with `useRef`, clear previous before starting new.
**Priority:** Very low.

### Share copy string duplicated across files
**Source:** P2-6 code review.
**Rationale:** `Join me at ${eventTitle}` appears inline in both `ShareActions.tsx:88` (native share text) and `share.ts:29` (WhatsApp message).
**Action:** Export `buildShareText(title)` from `src/lib/utils/share.ts`, use both places.
**Priority:** Very low.

### `BookingModal` "Link copied" toast fires on native-share too
**Source:** P2-6 code review.
**Rationale:** Previous behaviour was clipboard-only. After the refactor, the `linkCopied` state is set for both `'copied'` AND `'shared'` outcomes.
**Action:** Rename state + copy to outcome-agnostic ("Shared!") OR branch on outcome.
**Priority:** Very low.

### `buildEventShareUrl` SSR fallback returns relative URL
**Source:** P2-6 code review.
**Rationale:** `src/lib/utils/share.ts:16-20` returns `/events/${slug}` when `window` is undefined. Today only called from click handlers; a future Server Component prebuilding a share href would quietly break.
**Action:** Either throw in dev as a tripwire, or take the origin as an explicit parameter for Server usage.
**Priority:** Very low.

---

## 🧹 P2-5 / cron code-review follow-ups

### `sendWithLog` silently drops sends on non-dedupe insert failure
**Source:** P2-5 code review.
**Rationale:** If the `notifications` INSERT fails with anything other than 23505 (transient connection, CHECK violation), we `console.error` and return false. Retry loop can't see the row because it was never written.
**Action:** Attempt the send before writing the audit row (log both outcomes), or emit a distinct `Sentry.captureException` with `tags: { surface: 'edge-function-audit-insert' }`.
**Priority:** Low.

### Retry loop doesn't filter by event state
**Source:** P2-5 code review.
**Rationale:** `processRetries` re-sends any failed `notifications.email` row < 3 days old without checking whether the underlying event was cancelled.
**Action:** Re-parse `template_name` / `dedupe_key` to recover the event id, skip if `is_cancelled = true` or `deleted_at IS NOT NULL`. Or store `recipient_event_id` on reminder rows and filter.
**Priority:** Low.

### Retry path has a theoretical double-send race under concurrent invocation
**Source:** P2-5 code review.
**Rationale:** Two concurrent invocations could both pick up the same failed row. 12-hour cooldown makes this unlikely.
**Action:** Optimistic guard: `.eq('retried_at', row.retried_at ?? null)`. Or `SELECT ... FOR UPDATE SKIP LOCKED` via an RPC.
**Priority:** Very low.

### `type: 'reminder'` hardcoded for all new system-email rows
**Source:** P2-5 code review.
**Rationale:** `sendWithLog` inserts every new row with `type = 'reminder'` regardless of whether it's `venue_reveal` / `review_request` / `reminder_2day`. Column is informational only — no code branches on it.
**Action:** Extend `notification_type` enum with `venue_reveal` + `review_request`, or map to closest existing value. Enum change needs a migration.
**Priority:** Very low.

---

## 🧪 Testing gaps

### Playwright E2E for `book_event` / `book_event_paid` / `claim_waitlist_spot` RPCs
**Source:** Phase 2.5 Batch 8.
**Rationale:** The three booking RPCs enforce security-critical invariants (email-verified, active-status, capacity race-safety, waitlist transitions). Vitest can't exercise plpgsql. Manual 12-scenario checklist documented in `docs/BOOKING-RPCS-TEST-PLAN.md`.
**Action:** Stand up Playwright + `supabase start` in CI, seed test users per status × verification combo, automate the 12 scenarios.
**Priority:** **HIGH — do before the first real member signs up in production.** Estimate ~1-1.5 days.

### Countdown-tick test in verify-form
**Source:** P2-3 polish pass.
**Rationale:** Resend-button countdown isn't covered — initial "Resend in 60s" assertion is there, but ticking to 0 and asserting button-enabled proved fiddly with fake timers + the async auto-send effect.
**Action:** Wrap in `act()` with microtask drain before advancing fake timers, OR refactor countdown to recursive `setTimeout`.
**Priority:** Low.

### Migrate Server Action error wording to discriminated codes
**Source:** P2-3 code review.
**Rationale:** The verify-form keys off literal substrings (`"signed in"`, `"wait"`, `"rate"`). If backend wording drifts, frontend silently misclassifies.
**Action:** `{ error: string, code: 'unauthenticated' | 'rate_limited' | 'invalid_code' | ... }` shape. Frontend keys off `code`.
**Priority:** Low.

### Singleton browser client test-isolation concerns
**Source:** P2-1 code review.
**Rationale:** `createClient()` in `src/lib/supabase/client.ts` is a module-level singleton. Every test mocks it via `vi.mock`; an integration-style test that forgets would leak state.
**Action:** Dev/test-only reset helper behind `__TEST_ONLY__` guard.
**Priority:** Low.

### Integration test for edge function date-window selection
**Source:** P2-5 backend.
**Rationale:** Unit-testing the Deno edge function's selection queries from Vitest is awkward (Deno + remote imports). Current coverage is template rendering on the Node side + a manual smoke test.
**Action:** Seed DB → invoke function → assert `notifications` rows. Can be part of the Playwright scaffold.
**Priority:** Medium.

### `sent_by = recipient` convention needs a contributing note
**Source:** P2-10 post-merge code review.
**Rationale:** The Deno edge function's `sendWithLog` writes `sent_by = relatedProfileId` where `relatedProfileId` is the recipient's profile id. Critical for the GDPR scrub via path 1 (`sent_by = p_user_id`).
**Action:** CONTRIBUTING note or expand the inline comment warning future maintainers not to "fix" `sent_by` to a system uuid without keeping `recipient_user_id` populated.
**Priority:** Low. Inline comment already exists.

---

## 📝 Documentation / operator

### Resend domain verification (BLOCKS public email launch)
**Source:** P2-4.
**Rationale:** Resend sandbox-sends only to the account-owner email until DNS records (SPF/DKIM/DMARC) verify `the-social-seen.com`.
**Action:** Cofounder adds the 3 DNS records. On verify, swap `FROM_ADDRESS` in `src/lib/email/config.ts` + `supabase secrets` to the new branded address.
**Priority:** **HIGH — must ship before real emails go to real members.**

### Deploy `daily-notifications` edge function + configure cron (per environment)
**Source:** P2-5 backend.
**Rationale:** The cron schedule + edge function exist in code, but each Supabase project needs per-env wiring before they do anything. Captured in `docs/SUPABASE-CONFIG.md` §3. Apply on production spin-up.
**Action:** Follow the SUPABASE-CONFIG.md "Restoring to a fresh Supabase project" sequence.
**Priority:** Blocker for prod launch.

### Wire Supabase OTP email through Resend
**Source:** P2-4 backend.
**Rationale:** Supabase's default OTP email still flows via Supabase's built-in mailer, not Resend. Means OTP emails aren't branded and aren't logged in our notifications audit.
**Action:** Either configure Supabase SMTP via Management API to use Resend, or custom OTP issuance (generate code, store with TTL in a `verification_codes` table, send via our Resend wrapper).
**Priority:** Medium.

### React Email migration
**Source:** P2-4 backend.
**Rationale:** Current templates use hand-written inline-style HTML. Works, but dev experience for rich emails (tables, columns, cross-client compat) is painful. `@react-email/components` gives JSX authoring.
**Action:** Add the deps, migrate templates to JSX. Revisit once we have 5+ templates — we now have 7+, so justifiable.
**Priority:** Low.

---

## 🧹 `/events/past` improvements

### Omits cancelled events silently
**Source:** P2-10 post-merge code review.
**Rationale:** `getPastEvents` filters `eq('is_cancelled', false)`. An attendee searching the archive for an event they remember booking won't find it if cancelled.
**Action:** Show cancelled past events with a "Cancelled" badge variant, or document the omission on the empty state. Product call.
**Priority:** Low.

### No pagination beyond the first 60
**Source:** P2-10 post-merge code review.
**Rationale:** `getPastEvents` caps at `.limit(60)`. Oldest events drop silently from the public archive as it grows.
**Action:** Cursor-based pagination via `created_at`, or "Load more" Server Action appending the next 60.
**Priority:** Low. Years-away concern at current cadence.

---

## ⚙️ Operations

### Admin-announcement preference lookup is 1 DB round-trip per recipient
**Source:** Phase 2.5 Batch 2 code review.
**Rationale:** `sendEmail` does an extra SELECT on `notification_preferences` before every admin announcement. Combined with the attendee rate-limit already shipped in Batch 7, this compounds per-send latency at scale.
**Action:** Batch-fetch preferences upfront via a single `IN` query keyed by `recipient_user_id` list, consult an in-memory map per recipient.
**Priority:** Low — matters at 100+ attendees.

### Pending newsletter-subscriber cleanup
**Source:** Phase 2.5 Batch 9.
**Rationale:** Rows that never confirm after 30 days accumulate in `newsletter_subscribers`. Low volume, but tidy.
**Action:** pg_cron job deletes `status='pending'` rows older than 30 days. Or a manual admin action button.
**Priority:** Low.
