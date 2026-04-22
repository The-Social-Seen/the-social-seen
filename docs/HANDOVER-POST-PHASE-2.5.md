# Post-Phase-2.5 Handover — for the next session

**Date:** 2026-04-22 (end of Phase 2.5)
**Last commit on main:** `5f999a1` — docs: post-Phase-2.5 FOLLOW-UPS cleanup (#39)
**Test baseline:** 1095/1095 passing
**Branch:** all Phase 2.5 work squash-merged → branches deleted. Local repo clean on `main` except for unrelated user-side debug `console.log`s in `src/components/layout/Header.tsx` (stashed as "user debug logs (not mine)" — restore with `git stash pop` if wanted).

Phase 2.5 is **fully wrapped** across 9 feature batches + 1 docs tidy. This session delivered PRs #30 through #39. Next session runs the **Cleanup Phase** (clears remaining polish debt) followed by **Phase 3 sprints 1-4** (trimmed scope — see below).

Read `CLAUDE.md`, `docs/FOLLOW-UPS.md`, `docs/PHASE-3-BACKLOG.md`, `docs/SUPABASE-CONFIG.md`, and `docs/BOOKING-RPCS-TEST-PLAN.md` before starting. Everything else is project-local context you can rebuild from git log.

---

## Health check

```bash
git status                              # clean on main
git log --oneline -5                    # 5f999a1 cleanup PR at top
export PATH="$HOME/.local/bin:$PATH"
pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build
# Expect: tsc clean, 0 lint errors (29 pre-existing warnings), 1095 tests, build clean.
```

If the number isn't 1095, stop and diagnose — something shifted unexpectedly.

---

## Scope decisions already made (don't re-litigate)

**Cleanup Phase — 5 batches, ~4 code days:**
- **CL-1 SKIPPED** — operator-only (Resend DNS, UNSUBSCRIBE_TOKEN_SECRET rotation, edge-function redeploy, square logo asset, pending-subscriber cleanup cron). User handles.
- **Start with CL-2 + CL-3 as one combined PR** — polish sprint.
- **CL-4** — Playwright scaffold + booking-RPC E2E.
- **CL-5** — Test infra polish.
- **CL-6** — Medium-pri feature-adjacent debt.

**Phase 3 — trimmed to 4 sprints:**
- **P3-1** — Referral system
- **P3-2** — Multi-ticket bookings (+1)
- **P3-3** — User-submitted event photos + moderation queue (**NO check-in**)
- **P3-4** — Instagram oEmbed + security hardening (ban-bypass, per-owner phone grants)

**Deliberately dropped** — user explicitly said skip:
- **Check-in QR / scanning** (was originally P3-3)
- **P3-5** — PWA + rich-text admin messaging
- **Phase 3.5** — WhatsApp Business API

If someone proposes adding them back, push back politely and point at this handover.

---

## Credentials already issued to the user (ask them for the values when needed)

The operator already has working credentials for the three external services integrated during Phase 2.5. **Do not ask them to re-issue** — just ask for the values when you need to paste into `.env.local` or verify a flow end-to-end:

- **Cloudflare Turnstile** — `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public, starts `0x4AAAAAAD...`) + `TURNSTILE_SECRET_KEY` (secret, same prefix). Used by `/contact` + `/collaborate` Server Actions.
- **Twilio** — `TWILIO_ACCOUNT_SID` (starts `AC...`), `TWILIO_AUTH_TOKEN` (32 hex), `TWILIO_SENDER_ID=SocialSeen`. Used by SMS send wrappers (Node + Deno).
- **Brevo** — `BREVO_API_KEY` (starts `xkeysib-`), `BREVO_LIST_ID` (operator sets after creating the list in Brevo dashboard). Used by newsletter subscribe/confirm/unsubscribe.

**Never paste real values into committed code.** Placeholders only in `.env.example`. Real values live in the operator's `.env.local` + Vercel env vars + `supabase secrets set`.

---

## CL-2 + CL-3 — combined polish sprint (start here)

One PR, ~1.5 days. Fifteen small items from `docs/FOLLOW-UPS.md`:

### Very Low priority (CL-2 block)
1. `maxLength={24}` on phone input in `src/app/(auth)/join/join-form.tsx`
2. Phone helper-text alignment — move "For event reminders and venue details" inline with label (or convert every other field's helper to below-input style). UX designer call — just pick one for consistency.
3. Checkbox class duplication cleanup in `join-form.tsx:295-307` (minor churn where both `border-gold bg-gold` and `Checkbox.Indicator`'s only-render-when-checked overlap).
4. `.env.example` grouping — move `SUPABASE_ACCESS_TOKEN` into the main `# ─── Supabase ───` block (it's currently its own section).
5. `<InstagramFollowSection>` a11y — add `aria-label="Follow @the_social_seen on Instagram (opens in a new tab)"` on the anchor, `aria-hidden="true"` on the lucide Instagram icon next to the text.
6. Rename honeypot field `company_website` → `fax_number` or `referral_code` (something semantically distant from the real `website` field on /collaborate). Three-file find-and-replace: `src/app/contact/actions.ts`, `ContactForm.tsx`, `CollaborateForm.tsx`.
7. `?account_deleted=1` toast — client component in root layout reads the param, shows "Your account has been closed" toast, strips via `router.replace`. Mirror `BookingCancelledHandler` pattern.
8. Legal-page "Last updated" — extract to shared constant `src/app/(legal)/_constants.ts`.
9. Sandbox `replyTo` rewrite — either (a) also rewrite `replyTo` to `SANDBOX_FALLBACK_RECIPIENT` when sandbox active, or (b) just document the behaviour in `sendEmail` JSDoc. (b) is simpler.
10. Hide `venue_name` on `EventCard` when `venue_revealed=false` — replace with "Venue revealed 1 week before".

### P2-6 ShareActions polish (CL-3 block)
11. Replace `useState + useEffect` at `src/components/shared/ShareActions.tsx:40-55` with `useSyncExternalStore(() => () => {}, () => navigator.share != null, () => false)`. Remove the `eslint-disable-next-line`.
12. Timer-overlap flicker — `handleCopy` + `handleNativeShare` share `copied` state with independent `setTimeout`s. Track timer via `useRef`, clear previous before starting new.
13. Share copy duplication — `Join me at ${eventTitle}` appears in `ShareActions.tsx:88` and `share.ts:29`. Export `buildShareText(title)` from `src/lib/utils/share.ts`, use both sites.
14. `BookingModal` "Link copied" toast — fires on `'shared'` too post-refactor. Rename to "Shared!" OR branch on outcome. `src/components/events/BookingModal.tsx:504-513`.
15. `buildEventShareUrl` SSR fallback returns relative URL at `src/lib/utils/share.ts:16-20`. Either throw in `NODE_ENV !== 'production'` as a tripwire or take origin as a parameter.

### P2-5 cron polish (CL-3 block continued)
16. `sendWithLog` silent-drop in Deno edge function — emit `Sentry.captureException` with `tags: { surface: 'edge-function-audit-insert' }` for non-23505 insert failures. `supabase/functions/daily-notifications/index.ts:461-468`.
17. Retry loop event-state filter — skip retries for events that are now cancelled/deleted. Store `recipient_event_id` on reminder rows (currently only on admin announcements) OR re-parse `template_name`/`dedupe_key`. `supabase/functions/daily-notifications/index.ts:358-384`.
18. Retry double-send race — `.eq('retried_at', row.retried_at ?? null)` as an optimistic guard.
19. `type='reminder'` hardcoded — either widen the `notification_type` enum (migration) or map to closest value per template.

**Tests:** each nit should have at least one assertion if the diff is non-trivial. ShareActions nits can piggyback on existing tests.

**Gate:** CL-2 + CL-3 combined should land in one PR. Expect ~+10 tests, ~19 file edits. `pnpm tsc && pnpm lint && pnpm test && pnpm build` all clean.

---

## CL-4 — Playwright scaffold + booking-RPC E2E (~1.5 days)

**Next, because Phase 3 flies blind without it.**

1. Install `@playwright/test` + `playwright` devDeps.
2. `playwright.config.ts` at repo root — parallel off for deterministic DB state, `webServer` pointing at `pnpm dev`.
3. CI integration: `supabase start` inside the test runner so a local DB is available. Use `tsx` or a shell script to seed fixtures.
4. Test helpers in `e2e/helpers/` — factory for test users keyed by `(status, email_verified, paid-event-booker-or-not)` combinations.
5. Port the 12 scenarios from `docs/BOOKING-RPCS-TEST-PLAN.md` to Playwright specs at `e2e/booking-rpcs.spec.ts`.
6. Add one edge-function integration test: seed an event 7 days out → invoke daily-notifications via `curl` inside the test → assert `notifications` rows created with the right templates.
7. Wire `pnpm e2e` to package.json. CI already runs `pnpm test` (vitest) — add a separate GitHub Action job for `pnpm e2e` so slow E2E doesn't block fast unit feedback.

**Existing doc:** `docs/BOOKING-RPCS-TEST-PLAN.md` has the 12 scenarios. Convert them.

---

## CL-5 — Test infra polish (~0.5 day)

Bundle as a single PR after CL-4.

1. Server Action error-code discriminators — move the verify-form off literal-substring matching (`"signed in"`, `"wait"`, `"rate"`). Change `{ error: string }` to `{ error: string, code: 'unauthenticated' | 'rate_limited' | 'invalid_code' | 'invalid_otp' | 'send_failed' }`. Frontend keys off `code`; `error` is display only. Source: `src/app/(auth)/actions.ts` + verify-form.
2. Singleton browser client test-isolation helper — export a `__TEST_ONLY__resetClient()` from `src/lib/supabase/client.ts` (guarded), call in afterEach where needed.
3. `sent_by = recipient` convention — add a CONTRIBUTING note OR expand the existing inline comment in `sendWithLog` to warn future maintainers not to "fix" `sent_by` to a system uuid without keeping `recipient_user_id` populated.

---

## CL-6 — Medium-pri feature-adjacent debt (~1 day)

One PR.

1. `/events/past` pagination — cursor-based via `created_at`, "Load more" Server Action appends next 60. `src/app/events/past/page.tsx` + `src/lib/supabase/queries/events.ts`.
2. `/events/past` cancelled transparency — surface past cancelled events with a "Cancelled" badge. Product call: show them or document the omission? Recommend: show with badge. UX lives in `EventCard` variant.
3. Admin preference batch-fetch — in `emailEventAttendees`, batch-fetch `notification_preferences` for the recipient list before the loop. Single `.in('user_id', ids)` query → in-memory map → per-iteration lookup. `src/app/(admin)/admin/actions.ts`.
4. `email_verified` reconciliation — in the server-client middleware OR on auth'd page load, sync `profiles.email_verified` against `auth.users.email_confirmed_at` if they diverge. Low-frequency check; don't hammer the DB every request.

---

## Phase 3 — after cleanup lands

Pull the scope from `docs/PHASE-3-BACKLOG.md`. Sprints:

### P3-1 — Referral system (~3-5 days)
- Migration: `profiles.referral_code text UNIQUE`, `profiles.referred_by uuid references profiles(id)`, generate a short slug on profile creation (trigger, 6-char alphanumeric). Migration also REVOKES `referred_by` from anon.
- Registration: optional "How did you hear about us?" → "Referral code" field on /join Step 1.
- On signup, set `profiles.referred_by` if a valid code is provided. Track a PostHog event `referral_attributed`.
- `/profile` — show member's own code + "Invite a friend" share copy + count of successful referrals.
- Rewards — MVP: no auto-reward, admin sees attribution in `/admin/members`. Phase 3.5 can tie to Stripe Coupons.
- Tests: code generation uniqueness, invalid-code validation, self-referral rejection.

### P3-2 — Multi-ticket bookings (+1) (~4-5 days)
- Migration: `bookings.ticket_count int NOT NULL DEFAULT 1`, CHECK `ticket_count BETWEEN 1 AND 4`.
- Update `book_event()` + `book_event_paid()` RPCs — capacity math uses `SUM(ticket_count) FILTER (WHERE status IN (confirmed, pending_payment))`.
- Update `claim_waitlist_spot()` RPC for multi-ticket claims.
- Stripe integration — line item × N instead of single item.
- UI: `+1 / +2 / +3 / +4` selector on `BookingModal`. Defaults to 1.
- Admin attendee table shows `ticket_count`; total attendee count = sum.
- Refunds already Stripe-per-booking so multi-ticket refund = full booking refund. No partial-ticket refund (v1 limitation, document).
- Tests: capacity-math with multi-ticket, waitlist-position preservation across multi-ticket claims, booking-confirmation email shows "×3" where appropriate.

### P3-3 — User-submitted photos + moderation (~3-4 days)
**Does NOT include check-in QR** — dropped from scope.
- Migration: extend `event_photos` with `uploaded_by uuid references profiles(id)`, `is_approved boolean default false`, `moderation_notes text`. RLS: public SELECT filters to `is_approved=true`; upload allowed for confirmed attendees only.
- Upload UI on event detail page (post-event only): drag-drop to Supabase Storage + insert row with `is_approved=false`.
- Admin moderation queue at `/admin/photos` — approve / reject buttons. Rejection deletes the Storage object + row.
- Storage cleanup: approved photos stay in the existing bucket; rejected get hard-deleted.
- Add `moderation_notes` textarea (internal-only, for admin memory).
- Tests: RLS (non-attendee can't upload, non-admin can't moderate), image size + MIME validation.

### P3-4 — Instagram oEmbed + security hardening (~4-5 days)
- **Instagram oEmbed** — needs Facebook App + `instagram_basic` review (~5-10 days Meta lead time). Request the review first, build the code path while waiting.
  - Code: server-fetch last 6 posts on `/gallery` render. Cache aggressively (5-min TTL via `unstable_cache`). Fall back to the existing `<InstagramFollowSection>` on failure.
  - Add `scontent.cdninstagram.com` to `next.config.ts` `remotePatterns` + `ALLOWED_IMAGE_HOSTS`. Drift test already guards this.
- **Ban-bypass mitigation** — cross-check phone + email domain at signup against `profiles.status='banned'`. Return a generic "Unable to create account — contact us" rather than leaking the ban reason. Metadata-only check; doesn't block unique people from using a shared household email.
- **Per-owner `phone_number` grants** — only matters if the profile-browser feature lands. For now, document the security posture in `social-seen-safety-SKILL.md`. If a profile-browser ships during P3, add a `get_profile_public(uuid)` SECURITY DEFINER that strips phone_number for non-owner callers.

---

## Hard rules (all still apply)

- **Run `/code-reviewer` LOCALLY before `git push`.** Never after PR opens. Every batch has caught real issues.
- **Post-response work:** `import { after } from 'next/server'`, never bare `void promise`.
- **New profiles column = explicit anon decision.** Default: don't add to the anon GRANT list. Document in the migration header.
- **Image hosts:** update BOTH `next.config.ts` remotePatterns AND `ALLOWED_IMAGE_HOSTS` in `src/lib/utils/images.ts`. Drift test enforces.
- **Stripe idempotency keys** on every retry-prone API call.
- **Every batch gate:** `pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build` all clean before commit. Tests added, not removed.
- **Feature branches only.** Squash-merge + delete branch on user approval. Never push to main directly.
- **Operator-facing secrets:** only ever land in `.env.example` as placeholders. Real values are on Vercel + operator paste.
- **Sandbox-flag callout:** never set `SANDBOX_FALLBACK_RECIPIENT` or `SMS_SANDBOX_FALLBACK_RECIPIENT` in production. They silently reroute every email / SMS.
- **Newsletter + unsubscribe + confirmation flows are two-step (GET preview + POST confirm)** because email security scanners prefetch GETs. Don't "simplify" back to single-GET without understanding this.

---

## Operator items pending (NOT your responsibility — user's)

User explicitly said they'd handle CL-1 (operator tasks). Don't re-prompt unless they don't ship and it blocks something:

- Apply Phase 2.5 migrations to staging (all 6, list below):
  - `20260427000001_tighten_profiles_anon_grant`
  - `20260428000001_notification_preferences`
  - `20260428000002_sanitise_user_notifications_body_scrub`
  - `20260429000001_add_profiles_sms_consent`
  - `20260430000001_newsletter_subscribers`
  - Plus any Sprint-2 leftovers that never applied: `20260425000001`, `20260426000001`
- Redeploy `daily-notifications` edge function.
- Set edge function secrets: `TWILIO_*`, `BREVO_API_KEY`, `BREVO_LIST_ID`, `UNSUBSCRIBE_TOKEN_SECRET`.
- Set Vercel env vars (Preview + Production): all of the above + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.
- Resend DNS verification (SPF/DKIM/DMARC on `the-social-seen.com`).
- Stripe webhook subscribed to both `checkout.session.completed` AND `charge.refunded`.
- Square `/logo.png` asset uploaded to `public/`.
- Twilio personal phone verified (trial mode).
- Brevo: create list, copy `BREVO_LIST_ID`, verify a sender email.

If any of these haven't happened by the time you're ready to test CL-4 E2E, flag it — some tests need the staging secrets to pass.

---

## Agent workflow (non-negotiable)

Same as Phase 2.5:
1. Create feature branch from latest main. `feat/cleanup-cl-2-and-3-polish`, `feat/cleanup-cl-4-playwright`, `feat/phase-3-p3-1-referrals`, etc.
2. Build in small focused chunks; tests alongside implementation.
3. **Run `/code-reviewer` locally before `git push`.** Address findings inline.
4. Gates clean before commit.
5. Verbose conventional-commits message (follow Phase 2.5 commits for the template).
6. Push + open PR with a structured body (Summary / Test plan / Operator items / Follow-ups).
7. Wait for user "merge" → squash-merge + delete branch.

---

## Starting state for CL-2 + CL-3 (first PR of the next session)

1. Branch: `feat/cleanup-cl-2-cl-3-polish`
2. ~19 edits across the 19 items above.
3. Expect ~+10 tests.
4. One combined PR titled `chore: cleanup phase CL-2 + CL-3 — polish sprint`.
5. Run `/code-reviewer` before push. Handle findings inline.
6. PR body: summarise the 19 items (one line each), test plan (Vercel preview visual spot checks for the UI-visible ones), operator items (none).

Don't touch `src/components/layout/Header.tsx` — the user has unrelated `console.log` debug edits in a local stash (`stash@{0}: user debug logs (not mine)`). Their debugging, not yours.

Go.
