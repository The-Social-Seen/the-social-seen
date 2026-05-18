# Follow-ups

Open technical debt and polish items — things deliberately scoped out of a batch that should still land eventually. Phase 3 new-feature items live in `docs/PHASE-3-BACKLOG.md`; this file is the maintenance backlog.

**Format:** short title, source, brief rationale, rough priority.

**Flow:**
1. Flagged during a batch → added here at end of batch.
2. Revisited at end of each sprint.
3. When actioned → remove from this file and reference the PR in the commit message.

**Last tidy:** 2026-04-29 — refresh after the 9-PR session that closed the 2026-04-27 Stripe incident class end-to-end. Removed 4 shipped items (Stripe defensive fix shipped #76, orphan reaper shipped #77, stale doc cleanup #75, auth-emails runbook #75) and added 3 new ones (flaky Playwright E2E, `@resend.dev` lint guardrail, Brevo orphan-opt-in backfill). Prior tidy: 2026-04-28 (PR #74 — initial post-session refresh adding 8 entries). Earlier baseline: Phase 2.5 wrap (PR #39 — 25 shipped items removed, 5 feature items moved to PHASE-3-BACKLOG).

---

## Refund-fee-deduction follow-ups
**Source:** `SYSTEM-DESIGN-refund-fee-deduction.md` §9 and §10.3 (shipped 2026-05-18 as `feat(payments): non-refundable booking fee...`).

- **Admin reporting dashboard for `stripe_fee_pence`** — gross revenue, Stripe processing fees (sum of `bookings.stripe_fee_pence`), refunds split by source (user vs `admin_event_cancelled`), net. Surfaces from the new columns added in migration `20260517000001`. Priority: Medium.
- **VAT on booking fees** — once we cross the HMRC threshold, the platform-charged booking fee likely becomes a taxable supply. Out of scope for v1. Priority: Low until volume threshold.
- **Promotion-code-applied fee distortion** — `allow_promotion_codes: true` is on at Checkout. If codes are configured in Stripe Dashboard, the discount applies to the combined `unit_amount` (ticket + fee) so the fee:price ratio gets distorted. Re-evaluate when promo codes are actually used. Priority: Low.
- **Admin-cancel orphan-payment race** — when an admin cancels an event while a user is mid-Stripe-Checkout (pending_payment → cancelled, then user completes payment), the webhook's `.eq('status', 'pending_payment')` guard no-ops and the user is charged with no booking. Runbook entry: after cancelling an event check Stripe for payments landing within 30 minutes; issue manual refunds for orphans. A code fix could either programmatically expire Stripe Checkout Sessions on admin cancel or auto-refund any payment that lands on a cancelled-event booking. Priority: Medium (real but rare).
- **Refund-retry queue** — currently failed refunds in `cancelEventAndRefundBookings` surface in `summary.failedRefunds` for manual admin retry. A retry queue (Stripe idempotency keys already make this safe) would surface a single button in the admin UI. Priority: Low until partial-failure incidents start happening.
- **Email dedup on `cancelEventAndRefundBookings`** — a user with multiple cancellations gets multiple cancellation emails. Fine for v1 (most users have at most one booking per event); consider a per-user summary email when multi-event cancellations become common. Priority: Low.
- **Deprecate legacy `cancelEvent()`** — the legacy `cancelEvent()` admin action still exists and just flips `is_cancelled` without refunds. The admin UI will route through `cancelEventAndRefundBookings()` exclusively after the frontend prompt lands. Once nothing internal calls `cancelEvent()`, remove the export. Priority: Low.

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

### Lint guardrail against `@resend.dev` sandbox-sender literals
**Source:** PR #70 code-review follow-up (parking note `project_email_config_post_incident_tidy.md` (b)).
**Rationale:** PR #70 fixed the 2026-04-27 transactional-email outage where `FROM_ADDRESS` was hardcoded to `onboarding@resend.dev` (Resend's sandbox sender — only delivers to the account owner). The fix added a Vitest config-shape regression test + comment block naming the trap. Both work but can be silently disabled (test deleted, comment ignored). A second layer prevents re-introduction at PR-CI time across the entire repo.
**Action:** ESLint `no-restricted-syntax` rule against the `@resend.dev` literal in source code. Scope MUST cover BOTH `src/` AND `supabase/functions/` (the 2026-04-28 incident's Edge Function fallback was the second code path; lint scoped only to `src/` would miss it). Memory note (b) details the rule shape.
**Priority:** Low — hardening, not blocking. Existing Vitest assertion + comment block is enough for now. Worth doing if/when this class of issue recurs.

### Next.js 16 middleware propagation broken (CSP nonce silently disabled)
**Source:** 2026-04-28 incident — diagnosed during the admin-events listing fix (PR #69).
**Rationale:** `NextResponse.next({ request: { headers: requestHeaders } })` in `src/lib/supabase/middleware.ts` is not propagating modified request headers to Server Components in Next.js 16.2.4 + Turbopack. Verified via temporary `/api/diag-headers` route handler — `headers().get('x-csp-nonce')` returns null. The same propagation failure means `Content-Security-Policy` doesn't appear on dev responses (and possibly production). The CSP nonce path at `src/app/layout.tsx:87-112` (the inline theme-detect script tagged with `nonce={cspNonce}`) is silently broken: nonce is undefined, so under strict CSP the script either runs unrestricted (if CSP isn't applied) or gets blocked (if it is). Either way the security posture documented in `social-seen-safety-SKILL.md` ("nonce-based CSP") is fictional.
**Action:** Two paths to evaluate (deferred — both larger than this branch's scope). (1) Migrate `middleware.ts` → `proxy.ts` (Next.js 16's deprecation path; Node.js runtime instead of Edge). Likely fixes propagation per the deprecation rationale but not verified. (2) Move CSP/nonce setting out of middleware into `src/app/layout.tsx` directly via a different pattern. Verify prod is also affected (Vercel may behave differently than local Turbopack dev) before deciding urgency. Memory: `project_nextjs16_middleware_propagation.md`.
**Priority:** **HIGH — silent security degradation.** Real exposure even if no exploit lands today; CLAUDE.md and the safety skill describe a CSP that may not be applied.

### Image allowlist multi-admin revisit
**Source:** PR #71 (`fix(images): permit any HTTPS image source`) — explicit deferred decision.
**Rationale:** The permissive-HTTPS image allowlist is contingent on the single-admin trust model. When multi-admin / delegated-host / UGC patterns land, the threat model changes (admin pastes URL → tracking pixels, referrer leaks, phishing images on member-visible pages).
**Action:** When ANY trigger fires (second admin added, host-delegation pattern introduced, UGC URL submission gated by admin), re-evaluate. Four compensating-control options (hostname allowlist / server-side image proxy / referrer policy / hybrid) documented in `memory/project_image_allowlist_revisit_on_multi_admin.md`.
**Priority:** Parked — not urgent under current single-admin operating model. Trigger-driven, not date-driven.

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

### Regression guard pattern-2-vs-3 ordering — diagnostic label mis-attribution
**Source:** F2-schema tester + reviewer (PR #67).
**Rationale:** The `user-interests-text-column-migration-guard.test.ts` and `event-category-migration-guard.test.ts` guards both use a `PROTECTED_PATTERNS` array iterated in order, breaking on first match. For a `.select('id, interest, created_at')` shape, both pattern 2 (destructure `\binterest\s*[,)\}]`) and pattern 3 (SELECT-list `select.*[, ]interest\b`) match — pattern 2 wins by array order, so the diagnostic mis-labels a SELECT-list match as "destructured `interest` identifier". Detection still fires correctly; only the label is imprecise.
**Action:** Flip the array order so pattern 3 (SELECT-list) is checked before pattern 2 (destructure). One-line change. Or: add a more specific pattern for SELECT lists that consumes the wrapping quote so it wins over the destructure pattern.
**Priority:** Very low — cosmetic, no detection gap.

### Regression guard narrow gap on single-quoted single-column SELECTs
**Source:** F2-schema tester (PR #67).
**Rationale:** Patterns 2 (`\binterest\s*[,)\}]`) and 3 (`select.*[, ]interest\b`) both require a delimiter — `,`, `)`, or `}` for pattern 2, and `,` or space immediately before `interest` for pattern 3. A hypothetical `.select('interest')` (single quoted single-column, first character is `'`) would slip past both. Vanishingly rare in real code (always at least `id, interest`); runtime would fail anyway because the column is dropped.
**Action:** Tighten pattern 3 to also catch `'interest` after a quote. One-line regex change.
**Priority:** Very low — narrow vector, runtime catches it anyway.

### Stale TODO(W4-docker) comments at `migration-w2-w3-taxonomy.test.ts:995, 1003, 1004`
**Source:** F2-schema tester (PR #67).
**Rationale:** Three `it.skip(...)` blocks at those lines reference `interest: 'X'` / `interest: 'A'` / `interest: 'B'` synthetic INSERT shapes inside test bodies that would now fail (the `interest` column is gone post-F2-schema). When/if W4-docker enables, those test bodies need updating to drop the `interest:` field from the synthetic INSERTs.
**Action:** Skip-block bodies update to use `(user_id, tag_id)` shape. ~10 min when W4-docker work resumes.
**Priority:** Very low — affects only the `it.skip(...)` path; live tests are unaffected.

### Regression guard `__tests__` walk-skip — widening optional
**Source:** F1b-schema + F2-schema tester (PRs #64, #67).
**Rationale:** Both regression guards skip scanning `__tests__/` directories during the file walk. Post-F2-schema fixture sweeps removed all live `interest:` mock entries, so widening the scan to `__tests__/` would be safe today — but invites a different fragility class: test files legitimately use `interest` mock values in unrelated contexts (e.g. `NotificationCategory` interest types, taxonomy tests using `interest-` slug prefix).
**Action:** Decision call. Widen + add an allowlist for legitimate test-only references, OR keep the deferred state with a comment explaining the trade-off.
**Priority:** Very low — judgment call, neither path is wrong.

### Defensive `Array.isArray(row.tags)` fallback not directly tested
**Source:** F2-app + F2-schema reviewers (PRs #66, #67).
**Rationale:** `getProfile` (`src/lib/supabase/queries/profile.ts:66`) and `exportMyData` (`src/app/(member)/profile/privacy-actions.ts:132`) both contain a defensive `Array.isArray(row.tags) ? row.tags[0] : row.tags` fallback for the joined tag. Mirrors the existing `getMyBookings` convention in the same file. Shape lock-in tests pass `tags: { slug, label }` object form only — the array branch isn't exercised. Defensive code, low runtime risk.
**Action:** Add a test case that mocks the array form and asserts the fallback resolves correctly. Or remove the array branch if `tag_id` NOT NULL FK + Supabase typegen guarantee the singular form (would require codegen confirmation).
**Priority:** Very low.

### Tag kind hardening — explicit `tag_kind` column on `tags`
**Source:** PR #73 code review (closes the W5 cross-check gap).
**Rationale:** `getRegistrationInterestTags` filters via `.not('slug', 'like', 'interest-%')` to exclude the 8 interest-only tags from registration + profile-edit. The convention is enforced by **naming discipline in the migration seed**, not by any DB column or constraint. Two failure modes if the convention slips: (a) a primary-eligible tag with slug starting `interest-` (e.g. `interest-rate-tracking`) silently disappears from registration, (b) an interest-only tag added without the prefix silently appears in registration.
**Action:** Add a `tag_kind` enum column to `public.tags` with values `('primary_eligible', 'interest_only')`. Migrate existing rows; switch `getRegistrationInterestTags` from slug-prefix filter to `.eq('tag_kind', 'primary_eligible')`. Memory: `project_tag_kind_hardening.md` (a).
**Priority:** Low — convention has held cleanly through three F1/F2 phases. Hardening for future-state, not a present bug.

### Hard-retire the 8 interest-only tags (when product decides)
**Source:** PR #73 — soft-retire only, hard-retire deferred.
**Rationale:** PR #73 hid `interest-*` tags from user-facing flows but left them in the `tags` table as `is_active=true` rows; admin tag picker still sees the full 23 via `getActiveTags`. Existing `user_interests` rows pointing to interest-* tags survive UNTIL the user re-saves their profile (delete-then-insert in `updateInterests` wipes them at that point).
**Action:** When/if the product team decides to fully retire the 8 interest-only tags, three deliberate decisions: (1) drop rows OR flip to `is_active=false` (recommended: deactivate first, drop later); (2) cascade-delete `user_interests` rows or leave them orphaned but harmless; (3) member comms or silent change. Memory: `project_tag_kind_hardening.md` (b).
**Priority:** Parked — trigger-driven, not date-driven. Don't pick up speculatively.

### `updateInterests` / `saveInterests` non-transactional delete-then-insert
**Source:** PR #73 code reviewer flag (pre-existing tech debt; surfaces here because the new flow exercises the same pattern).
**Rationale:** Both `saveInterests` (signup) and `updateInterests` (profile-edit) issue two PostgREST round-trips: `DELETE FROM user_interests WHERE user_id = X` then `INSERT INTO user_interests (...)`. PostgREST wraps each request in its own implicit transaction, so this is NOT atomic. If the delete succeeds and the insert fails (network blip, RLS denial mid-flight), the user is left with zero interests and no rollback.
**Action:** Wrap the DELETE+INSERT in a Postgres function (RPC) that runs atomically. Same security posture (auth + active-tag validation), single round-trip. Same pattern as `set_my_demographics`.
**Priority:** Low — only matters under network-flake or RLS-misconfiguration during the brief delete-insert window. Same shape as the existing `saveEventTags` atomicity entry above.

---

## 🧹 P2-5 / cron code-review follow-ups

### Map edge-function `type` column to the new enum values
**Source:** CL-3 (follows migration `20260501000001_widen_notification_type_enum`).
**Rationale:** The migration extended `notification_type` with `venue_reveal`, `review_request`, `profile_nudge`. The edge function's `sendWithLog` still hardcodes `type = 'reminder'` — deferred to avoid chicken-and-egg with the migration rollout (code would reject the new values until the migration lands in every environment).
**Action:** Once the migration is applied everywhere, thread a `notificationType` through `sendWithLog` and remove the hardcode.
**Priority:** Very low.

---

## 🧪 Testing gaps

### Playwright E2E flakiness — 30s timeout under slow-CI conditions
**Source:** PR #74 + PR #77 — observed across multiple session merges.
**Rationale:** Multiple Playwright tests time out at 30s when CI (especially the `pull_request` runner — slower than `push`) is under load. Same commit can pass one run and fail the next. Affected tests vary: `auth.spec.ts:34` (register happy path, `page.waitForURL` timeout) and `daily-notifications.spec.ts:50` (venue-reveal, polls for notifications row). Both depend on real systems (Edge Function, Supabase, Resend, Vercel preview) all completing within 30s. Memory: `project_flaky_e2e_daily_notifications.md` for full diagnostic + same-commit smoking-gun evidence.
**Action — three paths, pick when annoyance > effort:**
1. Bump per-test timeout 30s → 60s in `playwright.config.ts`. One-line. Closes the failure mode for the slow-runner case.
2. `test.describe.configure({ retries: 1 })` at the suite level. Auto-retry once before flagging. Doesn't fix root cause but stops merge noise.
3. Mock Resend in the Edge Function path for E2E (env var gate). Tightest, most deterministic. Bigger change.
**Priority:** Low — doesn't gate merges (re-running CI usually works), doesn't break production. Add when the noise becomes annoying.

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

### Deploy `daily-notifications` edge function + configure cron (per environment)
**Source:** P2-5 backend.
**Rationale:** The cron schedule + edge function exist in code, but each Supabase project needs per-env wiring before they do anything. Captured in `docs/SUPABASE-CONFIG.md` §3. Apply on production spin-up.
**Action:** Follow the SUPABASE-CONFIG.md "Restoring to a fresh Supabase project" sequence.
**Priority:** Blocker for prod launch.

### React Email migration
**Source:** P2-4 backend.
**Rationale:** Current templates use hand-written inline-style HTML. Works, but dev experience for rich emails (tables, columns, cross-client compat) is painful. `@react-email/components` gives JSX authoring.
**Action:** Add the deps, migrate templates to JSX. Revisit once we have 5+ templates — we now have 7+, so justifiable.
**Priority:** Low.

### Brevo orphan-opt-in backfill
**Source:** 2026-04-29 — discovered during the post-Stripe-fix session that `BREVO_API_KEY` was missing from Vercel env, so every consenting signup since the integration shipped was a silent no-op via `isBrevoConfigured()`. There's currently 1 affected user. Code at `src/app/(auth)/actions.ts:425-426` even pre-anticipated this scenario in a comment: "A Phase-3 reconciler can backfill orphan opt-ins."
**Rationale:** Right now it's one row — manual add in the Brevo dashboard is faster than building a tool. But if Vercel env ever drifts again, OR a Resend / Brevo account rotation invalidates a key, the next discovery could be N>1 orphans.
**Action:** Small one-shot Server Action or admin route that (a) selects all profiles where `email_consent = true AND deleted_at IS NULL AND email IS NOT NULL`, (b) calls `upsertContact` for each, (c) reports `{ added, failed, errors }`. Gate behind admin-only RLS as usual. Build when orphan count crosses ~5 OR another silent-drift incident surfaces. Memory cross-ref: `project_account_rotation_cascade_pattern.md` item #1 (Vercel env drift checklist).
**Priority:** Low — bounded blast radius today (one user). Becomes Medium if a second orphan surfaces.

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
