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

### Document Supabase Auth Management API config
**Source:** P2-3 backend handover
**Rationale:** Several Supabase auth settings are now configured live via the Management API (`mailer_otp_length: 6`, `mailer_otp_exp: 600`, plus future changes). These aren't represented anywhere in git, so production deployment will need the same PATCH calls and nobody will remember.
**Action:** Create `docs/SUPABASE-CONFIG.md` documenting the current non-default settings and a curl snippet to re-apply them. Update whenever a config change is made. Alternatively, a small `scripts/apply-supabase-config.sh` that wraps the API calls.
**Priority:** Medium. Will bite hard when we create the production project and forget what was customised.

### Customise Supabase email templates
**Source:** P2-3 backend handover
**Rationale:** OTP email currently uses Supabase's default copy. Works, but not branded.
**Action:** Customise via Dashboard → Authentication → Email Templates, or the Management API. Or replace entirely with Resend-sent emails in P2-4.
**Priority:** Will be handled by P2-4 (transactional email). If P2-4 slips, pick this up as a standalone fix.

---

## 🚀 Out-of-scope product ideas (Phase 3+)

These were mentioned in reviews or handovers but are explicitly Phase 3 — logged here for completeness, not action.

- **Ban-bypass mitigation** (P2-2 code review) — when P2-8 implements banning, the ban check should key on phone number + email domain, not just `profiles.id`. Otherwise a banned user can sign up again with a different email.
- **Per-owner column grants on `phone_number`** — if we ever let authenticated non-admin members browse other members' profiles, `phone_number` should be visible only to row owner + admins. Requires a security-definer function or view.
- **Email as hidden column** — related to the first item in the security section. Worth its own migration eventually.
