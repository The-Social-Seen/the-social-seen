# Follow-ups

Open technical debt and polish items — things deliberately scoped out of a batch that should still land eventually. Phase 3 new-feature items live in `docs/PHASE-3-BACKLOG.md`; this file is the maintenance backlog.

**Format:** short title, source, brief rationale, rough priority.

**Flow:**
1. Flagged during a batch → added here at end of batch.
2. Revisited at end of each sprint.
3. When actioned → remove from this file and reference the PR in the commit message.

**Last tidy:** after Phase 2.5 wrap (PR #39 — 25 shipped items removed, 5 feature items moved to PHASE-3-BACKLOG).

---

## 🔴 Bugs / regressions to investigate

### Paid-event booking returns "Something went wrong" on production
**Source:** User report, post-CL-9.
**Symptom:** Clicking "Book" on a paid event shows the generic BookingModal error toast. No Stripe Checkout redirect.
**Diagnostic order:**
1. Vercel function logs (filter to Errors + `/events/[slug]`) — gives the actual exception thrown by the Server Action.
2. Stripe dashboard → Developers → Logs — if request never reached Stripe, the failure is upstream (env / RPC / verification gate).
3. Most likely cause: `profiles.email_verified = false` for the booker → `book_event_paid` RPC rejects with "Verify your email before booking", but the BookingModal swallows the message into the generic toast. Verify by `UPDATE profiles SET email_verified = true WHERE email = '...';` and retrying.
4. Other suspects: `STRIPE_SECRET_KEY` missing in Vercel Production env, `book_event_paid` migration (20260423000001) not yet applied to the hosted project, Stripe webhook signing secret mismatch.
**Fix once diagnosed:**
- If verification gate: surface the RPC's `error` field to the user instead of the generic fallback. One-line change in `src/app/events/[slug]/actions.ts` createPaidCheckout — bubble `data.error` from the RPC response into the action's return.
- If env / migration: pure operator fix, no code change.
**Priority:** **HIGH — blocks first paid booking.**

### Admin area is not mobile-friendly
**Source:** User report, post-CL-9.
**Rationale:** `/admin/*` routes were built desktop-first. The DataTable component overflows on small screens; the event create/edit form, attendee list, members table, reviews moderation, and notifications retry view all need a responsive pass.
**Action:** Sprint-sized — touch every `/admin/*` page. DataTable likely needs a card-on-mobile variant; tables should swap to stacked rows below the `md:` breakpoint. Forms need single-column reflow.
**Estimate:** ~1.5–2 days for a full responsive pass on the admin surface.
**Priority:** Medium — admin is operator-only, so it doesn't block members. Worth doing before a second admin joins (cofounder, events ops, etc.).

---

## 🔴 Security / compliance

### Refactor existing `callerIp` duplicates to the shared `getCallerIp` helper
**Source:** CL-7 code review.
**Rationale:** `src/lib/utils/caller-ip.ts` is now the canonical helper but `src/app/contact/actions.ts:65` and `src/app/newsletter/actions.ts:54` still have their own private copies. Three-line cleanup; matters because the next caller (e.g. signup throttling) should not invent a fourth.
**Action:** Replace both inline `callerIp` functions with `import { getCallerIp } from '@/lib/utils/caller-ip'`.
**Priority:** Low.

### Cover the rate-limited signIn flow with an integration test
**Source:** CL-7 code review.
**Rationale:** The unit-tests for `src/lib/rate-limit.ts` cover the limiter in isolation; the wiring into `signIn` (which axes are checked, that successful logins do NOT bump the bucket, that the friendly "too many attempts" error surfaces) is currently uncovered.
**Action:** Add a Vitest case that stubs `supabase.auth.signInWithPassword` to fail 10× then asserts the 11th `signIn` returns the friendly error without ever calling Supabase.
**Priority:** Low.

### Diagnose Supabase-local OTP delivery for the login + verify E2E scenario
**Source:** CL-7 CI runs.
**Rationale:** `e2e/ui/auth.spec.ts` scenario 3 is currently `test.skip()`'d. Inbucket IS running in CI and the plus-alias normalisation is correct, but `waitForOtp` times out — the OTP email never lands in the mailbox we poll.
**Candidate causes (check in this order):**
1. **Supabase's `rate_limit_email_sent` (4/hour default, project-wide)** — should reset per CI run but worth checking Auth Logs for `over_email_send_rate_limit`.
2. **Autoconfirm short-circuit** for users seeded with `admin.createUser({ email_confirm: true })` — `signInWithOtp` may skip the send entirely when the email is already confirmed at the auth-user level.
3. **Inbucket mailbox routing** — OTP may be landing in a different mailbox shape than our helper expects (beyond the plus-alias stripping we already do).
4. **`@test.local` domain filter** in Supabase Auth.
**Action:** Run scenario 3 locally with Inbucket's webUI open at `http://127.0.0.1:54324` and Supabase's Auth Logs open; see which mailbox (if any) receives the OTP and whether the send even fires. Fix whichever bucket the evidence points at — likely either switch the fixture to an unverified seed that triggers a real signup OTP, or invoke the OTP via the app's `sendVerificationOtp` Server Action from the test rather than via `/verify` auto-fire.
**Priority:** Medium — the register flows (scenarios 1 + 2) cover the signup path; this scenario is the only E2E of the verify flow.

### Add a phone-field test to `EditProfileForm`
**Source:** CL-7 code review.
**Rationale:** The phone input was added without an accompanying test. The wider form is well-tested; phone needs a render + change + submit assertion.
**Priority:** Low.

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

---

## 🟡 UX / polish

### Square `/logo.png` asset for Organization JSON-LD
**Source:** Phase 2.5 Batch 6.
**Rationale:** `organizationJsonLd()` now emits `logo` as a proper `ImageObject` but still references `/og-image.jpg` (1200×630, wide). Google's Knowledge Panel reserves a near-square area and crops the wide asset awkwardly.
**Action:** Upload a 600×600 square logo to `public/logo.png`, update three fields in `src/lib/seo/organization.ts:20-24` (url + width + height).
**Priority:** Low — operator asset dependency.

---

## 📈 Analytics & measurement

### (none open — Phase 2.5 Batch 7 closed the analytics backlog.)

---

## 🧹 P2-5 / cron code-review follow-ups

### Map edge-function `type` column to the new enum values
**Source:** CL-3 (follows migration `20260501000001_widen_notification_type_enum`).
**Rationale:** The migration extended `notification_type` with `venue_reveal`, `review_request`, `profile_nudge`. The edge function's `sendWithLog` still hardcodes `type = 'reminder'` — deferred to avoid chicken-and-egg with the migration rollout (code would reject the new values until the migration lands in every environment).
**Action:** Once the migration is applied everywhere, thread a `notificationType` through `sendWithLog` and remove the hardcode.
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
