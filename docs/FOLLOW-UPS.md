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

### UTF-8 em-dashes mojibake'd in event seed copy
**Source:** Spotted on iOS preview (PR #53 verification, 2026-04-25). Visible on the Summer Party event detail and likely many others.
**Symptom:** Em-dashes in event titles / descriptions render as `,Äî` instead of `—`. Example: "Mayfair ,Äî the Social Seen's summer party" should be "Mayfair — the Social Seen's summer party". Visible on hosted production, not just local.
**Root cause hypothesis:** `,Äî` is the exact mojibake produced when UTF-8 bytes for `—` (`E2 80 94`) are interpreted as Mac Roman. Likely the seed file was saved or transcoded through a Mac Roman step at some point — either pre-insert (the bytes in the DB are wrong) or at render time (less likely; the type is `text` in Postgres which is UTF-8 by default). Inspect first with `select short_description from events where short_description like '%,Äî%' limit 1;` against hosted to confirm the bytes in the DB are wrong.
**Action:**
1. Confirm whether the bytes in hosted Postgres are mojibake'd or correct.
2. If bytes are wrong: write a one-shot migration that does `UPDATE events SET short_description = replace(replace(short_description, ',Äî', '—'), ',Äì', '–'), description = same…` (and any other Mac-Roman→UTF-8 patterns found). Do this as a normal migration so it's reproducible against any restored backup.
3. If bytes are correct: investigate render path — Server Components / `dangerouslySetInnerHTML` / email templates — to find where the encoding is being misread.
4. Fix the seed file too so the bug doesn't reappear after a `db reset`.
**Priority:** Medium-high. Customer-facing copy quality issue; visible on every page that shows an affected event.

---

### Stripe receipt emails not sent in test mode
**Source:** User report, 2026-04-25 — paid bookings complete but no receipt email arrives from Stripe sandbox.
**Symptom:** After successful Checkout in test mode, no receipt email is delivered to the customer.
**Root cause:** Stripe doesn't auto-send receipts in test mode unless explicitly opted in. Production receipts depend on Stripe Dashboard → Settings → Customer emails → "Successful payments" being enabled. In test mode, the Dashboard setting is honored only after explicit opt-in OR if `payment_intent_data.receipt_email` is set on the Checkout session.
**Fix (pick one, do both for safety):**
1. Code: pass `payment_intent_data.receipt_email: input.userEmail` in `src/lib/stripe/checkout.ts:124-130` (already passing `metadata` there — add receipt_email next to it). Forces a receipt regardless of Dashboard setting, in any mode.
2. Operator: enable "Email customers about successful payments" in Stripe Dashboard for both Test and Live modes.
**Priority:** Medium — receipts are expected by users; lack of one looks broken even if charge succeeded.

### Admin area mobile responsive — Phase 2 deferrals
**Source:** PR #53 (`feat(admin): mobile-responsive pass on /admin/*`) shipped Phase 1; spec at `docs/admin-mobile-spec.md` §5 lists Phase 2 items deferred from that PR.
**Rationale:** Phase 1 closed the structural blockers (table → card stacking, sticky save bar, bottom-sheet dialogs, KPI 2-up, 44×44 touch targets, 43 new tests). These items hit the 15-file-per-batch cap or were explicitly out of scope.
**Action — Phase 2 polish:**
- `admin/events/page.tsx` Create Event CTA: stack `flex-col sm:flex-row` with `w-full sm:w-auto` button.
- `admin/events/[id]/page.tsx` DuplicateEventButton: stack on mobile.
- `BookingsChart.tsx`: drop `margin={{ left: -20 }}` on mobile so Y-axis labels stop clipping.
- `notifications/page.tsx`: failed-sends badge polish.
- Drag-to-reorder, swipe actions, FAB, pull-to-refresh — all explicitly out of scope per spec §5.
**Priority:** Low. Pure polish — admin is functional on mobile after PR #53.

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

### Stripe `ensureStripeCustomer` defensive fix
**Source:** 2026-04-27 outage post-mortem.
**Rationale:** The customer-creation path in the paid-booking flow was implicated. Hardening should land after F1b-schema ships so the fix doesn't tangle with the data-layer migration sequence.
**Action:** TBD by post-mortem write-up — likely retry with backoff, distinct error surface for "Stripe rejects vs Stripe unreachable", and a Sentry tag matching `surface: 'createPaidCheckout'` for filterable triage.
**Priority:** **HIGH — production reliability** for the paid-booking path.

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

### "More X Events" related-events sections can shrink to 1 peer post-F1a/b
**Source:** F1a manual preview verification.
**Rationale:** F1b-app's `getRelatedEvents(primaryTagSlug)` correctly narrows the match — Halloween Party's "More Nightlife & Dancing Events" now shows just one peer (Christmas Party at Tonteria). Pre-F1b would have shown the wider `cultural` bucket which conflated several primary tags. Sharper match = correct behaviour, but a 1-event "More Nightlife & Dancing Events" heading reads thin.
**Action:** Either rename the heading to "More events you'll like" and broaden the source query (cross-tag affinity vs strict same-primary), or adjust copy when there's <2 peers ("Another night to check out: …"). Product call.
**Priority:** Low — no functional regression, just thin-list awkwardness.

### AdminSidebar bottom-nav obscures form view when iOS keyboard is open
**Source:** PR #53 real-iOS verification (2026-04-25).
**Symptom:** On `/admin/events/[id]` and `/admin/events/new`, focusing the Description textarea opens the keyboard. The chrome stack from bottom up: keyboard → iOS field navigator → AdminSidebar bottom-nav (Overview/Events/Members/Reviews/Notifications) → Cancel button → Save button → form. Net result: the textarea shows ~2 lines of text. The sticky save bar itself works correctly (verified) — the issue is the bottom-nav is unnecessary while editing and eats vertical space.
**Action — pick one:**
- **Best:** hide AdminSidebar bottom-nav when a text input has focus (`:focus-within` on a form ancestor + `lg:hidden` on the nav, or VisualViewport API to detect keyboard).
- **Cheaper:** drop the bottom-nav on admin form pages (`/admin/events/[id]`, `/admin/events/new`, `/admin/notifications`) — these are deep pages where cross-section nav is rare during edit.
- **Cheapest:** stack Cancel + Save horizontally instead of vertically — recovers ~50px without behaviour change.
**Priority:** Low. Functional, just cluttered.

---

### Square `/logo.png` asset for Organization JSON-LD
**Source:** Phase 2.5 Batch 6.
**Rationale:** `organizationJsonLd()` now emits `logo` as a proper `ImageObject` but still references `/og-image.jpg` (1200×630, wide). Google's Knowledge Panel reserves a near-square area and crops the wide asset awkwardly.
**Action:** Upload a 600×600 square logo to `public/logo.png`, update three fields in `src/lib/seo/organization.ts:20-24` (url + width + height).
**Priority:** Low — operator asset dependency.

---

## 📈 Analytics & measurement

### (none open — Phase 2.5 Batch 7 closed the analytics backlog.)

---

## 🧹 Member data layer follow-ups

### `saveEventTags` DELETE-then-INSERT atomicity
**Source:** W5 code review (PR #61).
**Rationale:** The Server Action issues two PostgREST round-trips — `DELETE FROM event_tags WHERE event_id = X` then `INSERT INTO event_tags (...)`. PostgREST wraps each request in its own implicit transaction, so this is NOT atomic. During the ~5–50ms window the event has zero `event_tags` rows. Benign today (member-facing reads use `event_tags.tags.slug` JOIN — F1b-app — and the brief empty state is allowed by the partial unique index), but concurrent admin edits to the same event are a last-writer-wins race.
**Action:** Wrap the DELETE+INSERT in a Postgres function (RPC) that runs atomically. Same security posture (admin auth + tag-eligibility validation), single round-trip.
**Priority:** Low — only matters if multi-admin concurrency appears.

### Three-way slug→enum lockstep — 4th assertion
**Source:** W5 code review + F1a tester note.
**Rationale:** The lockstep guard in `src/lib/constants/__tests__/tags.test.ts` catches drift between (a) the test's expected table and Migration 2 SQL, (b) production constants in `src/lib/constants/tags.ts`, and (c) the per-slug parametrised test. But a coordinated drift in ALL THREE simultaneously slips past — realistically protected because migrations are immutable per safety rules.
**Action:** Add a 4th assertion comparing production constants directly to Migration 2 SQL (read the migration file's `_tag_slug_to_legacy_category` CASE or — post-F1b-schema — the seed insert's CASE) so all three sources are pairwise asserted.
**Priority:** Low — a test of last resort.

### Fixture-pattern refactor — `satisfies Event` to catch tsc-blind-spot
**Source:** F1b-schema tester note (caught 6 stale fixtures the dev's tsc missed).
**Rationale:** Mock helpers like `vi.fn(() => Promise.resolve({ data: <obj> }))` widen object literals to `unknown`, so TypeScript's excess-property checking is silent on stale fixtures. Future schema migrations that drop a column will hit the same blind spot — fixtures retain dead fields and tsc stays clean.
**Action:** Either (a) extract every inline mock object into a typed `const event: EventWithStats = {...}` before passing to mock, or (b) add `satisfies EventWithStats` clauses to fixture builders. The `satisfies` form is least invasive but requires changing builder return types from explicit annotations to `satisfies`. ~30 min refactor across the test files that currently use the widening pattern.
**Priority:** Low — bites only on the next schema-drop migration; surface-level test failures will still catch real bugs.

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

### CI migration-drift check (local vs hosted `schema_migrations`)
**Source:** Session-start handover (post-CL-9 — discovered 19 migrations were unapplied to hosted).
**Rationale:** Migration files are committed to git and applied locally / in CI on `supabase db reset`, but hosted apply is a manual `supabase db push` step. Drift is silent — the W2+W3 hosted-apply caught it via a different vector (`activity` enum quirk), and the F1b-schema verify script catches it for that specific column drop, but there's no general guard. Future PRs that add a migration but forget to instruct the operator to push will reproduce the bug.
**Action:** Option A — small CI step that queries hosted's `schema_migrations` table (read-only, via service-role + a postgres function that returns the version array) and compares to the file system list under `supabase/migrations/`. Fail CI on drift with a clear "X migrations pending hosted apply" message. ~30 min of CI work + a small SECURITY DEFINER function exposing the migration list.
**Priority:** Medium — prevents the same silent-drift class of bug as the W2+W3 + F1b-schema episodes.

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
