# Follow-ups

Items flagged during batches that were deliberately out of scope at the time. Maintained at the end of each batch so nothing gets lost in merged PR descriptions.

**Format:** short title, source batch, brief rationale, rough priority. Priorities are guidance, not commitment — re-weigh when you have bandwidth to pick something up.

**Flow:**
1. Flagged during a batch → added here at end of batch.
2. Revisited at end of each sprint — anything still relevant either gets picked up, converted to a GitHub issue, or explicitly dropped.
3. When actioned → remove from this file and reference the PR that closed it in the commit message.

---

## 🔴 Security / compliance

### SMS / Twilio transactional notifications were never built (Phase-2 plan slipped silently)
**Source:** docs/PHASE-2-PLAN-v2.md §P2-5 + Platform Decisions table — sweep during Phase 2 wrap.
**Rationale:** The original P2-5 plan promised venue reveals + 2-day reminders + day-of reminders via "email + SMS" using Twilio (~$15 trial credit, ~$20/month thereafter). The DB schema reflects this — `notifications.channel` CHECK constraint accepts `'in_app' | 'email' | 'sms'` (migration `20260421000001`). But every send path actually built (Node `sendEmail`, Deno `sendWithLog`, all 7 templates, the daily edge function) is email-only. No Twilio client, no SMS templates, no SMS dispatch in the edge function. The phone-number column on profiles (P2-2) is collected but unused for transactional sends. Not logged as a slip in Sprint 1 / 2 handovers.
**Action:** Phase 3. Build in this order:
1. Decide whether SMS is still worth it given the Resend email pipeline already covers reliable delivery + the WhatsApp community channel covers casual nudges. The original plan rationale was "venue reveals are time-critical and email gets buried" — re-test that assumption.
2. If yes: add Twilio client (`src/lib/sms/twilio.ts`), an `sendSms` wrapper analogous to `sendEmail` with the same audit-row logging into `notifications` (channel='sms'), an opt-in column on profiles (`sms_consent boolean`, NOT `email_consent` — separate consent for separate channel under UK GDPR), and Deno-side equivalents in `daily-notifications`.
3. Wire venue reveals + day-of reminders only — skip 2-day SMS to avoid spam. Provide a profile toggle.
**Priority:** Medium for Phase 3 — currently not blocking anything; email covers all communications and the WhatsApp group covers community chat.

### Instagram live oEmbed feed on /gallery (P2-12 deferred from Option B)
**Source:** docs/PHASE-2-PLAN-v2.md §P2-12 + P2-12 product call.
**Rationale:** P2-12 originally specified "oEmbed recent posts" on /gallery. Shipped Option A (static "Follow Us" CTA via `<InstagramFollowSection>`) instead because Meta's Instagram oEmbed endpoint has required a Facebook App token since 2020, gated on a multi-week app-review process out of scope for the demo. The static CTA is visually equivalent at brand level but doesn't surface live posts. Inline comment in `src/components/landing/InstagramFollowSection.tsx` flags this; promoting to a standalone follow-up so it doesn't get lost.
**Action:** Phase 3. Steps:
1. Create a Facebook App + submit for the `instagram_basic` permission review (~5-10 day Meta review).
2. On approval, store the long-lived access token as `INSTAGRAM_OEMBED_TOKEN` env var.
3. Server-fetch the last 3-6 posts on /gallery render (cached aggressively — Meta rate limits + iframe loading is heavy). Fall back to the existing `<InstagramFollowSection>` if the fetch fails or the env var is missing.
4. Update `next.config.ts` `remotePatterns` + `ALLOWED_IMAGE_HOSTS` for `scontent.cdninstagram.com` if rendering post thumbnails directly rather than via Meta's iframe.
**Priority:** Low — the static CTA does the brand job. Only worth doing if marketing data shows live-post embeds drive engagement materially better.

### Twitter / LinkedIn social channels — re-add when accounts exist
**Source:** P2-12 product call.
**Rationale:** Footer + Organization JSON-LD `sameAs` dropped Twitter + LinkedIn entries in P2-12 because those accounts don't exist yet. Pattern: extend `SOCIAL_LINKS` in `src/lib/constants.ts` and the footer + JSON-LD pick them up automatically.
**Action:** When the brand creates Twitter (or X) and LinkedIn accounts:
```ts
export const SOCIAL_LINKS = {
  instagram: 'https://www.instagram.com/the_social_seen',
  twitter: 'https://twitter.com/...',
  linkedin: 'https://www.linkedin.com/company/...',
} as const
```
Then re-add the icon entries to the footer's `socialLinks` array. The Organization JSON-LD `sameAs` already iterates `Object.values(SOCIAL_LINKS)` so it picks up automatically.
**Priority:** Low — depends on launch comms decision.

### Public contact + collaborate forms have no rate limiting (HIGH — before public launch)
**Source:** P2-12 pre-push code review (S2)
**Rationale:** `sendContactMessage` and `sendCollaborationPitch` accept anonymous POST submissions and dispatch via Resend (free tier: 3,000 emails / month). Defences shipped in P2-12 are honeypot + 2-second timing — sufficient for v1 demo traffic, trivially bypassable by a determined attacker scripting a 3-second wait. A modest 100 req/hour for 30 hours empties the entire month's Resend budget, taking down the P2-9 attendee-messaging + P2-5 cron-email pipelines as collateral.
**Action:** Add rate limiting BEFORE the contact + collaborate forms go in front of the public web. Three options ranked by effort:
1. **Cloudflare Turnstile** (recommended) — free, invisible, ~5-min wire-up. Add a token input + verify server-side in the Server Actions.
2. **Vercel Edge Middleware + KV/Upstash** — IP-bucketed rate limit. Heavier but auth-system-agnostic.
3. **Auth-gate the forms** — defeats the purpose; prospects can't reach us.
**Priority:** **HIGH — must ship before the contact + collaborate routes are publicly linked beyond the demo.** Inline comment in `src/app/contact/actions.ts` already flags Phase-3 deferral; this entry escalates the timing.

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

## 🧹 Image-host fix (PR #19) follow-ups

### Allowlist drift between `images.ts` and `next.config.ts`
**Source:** PR #19 code review (I1)
**Rationale:** `ALLOWED_IMAGE_HOSTS` in `src/lib/utils/images.ts:33-36` must stay in sync with `images.remotePatterns` in `next.config.ts:7-14`. Today they match, but if someone adds a new host to the Next config and forgets the runtime list, valid images silently fall back to the placeholder (or vice versa, allowing a URL we then can't render).
**Action:** A test that imports both and asserts they match. Or a lint rule. Or — at minimum — a one-line reminder in CLAUDE.md's image section. The Next config is transformed at build time so can't be imported directly at runtime; a test file can `require()` it in Node and compare.
**Priority:** Low. No drift today.

### Protocol check is implicit in `isAllowedImageHost`
**Source:** PR #19 code review (I2)
**Rationale:** `isAbsoluteUrl()` accepts both `http://` and `https://`, but `next/image` `remotePatterns` defaults to `https` only. If seed data ever has an `http://` URL on an allowlisted host, `isAllowedImageHost` returns `true` and the URL passes through, only to be rejected by `next/image` at render time — a different failure mode than the one this fix addresses but still broken.
**Action:** Inside `isAllowedImageHost`, also assert `url.protocol === 'https:'` (after the `new URL()` call).
**Priority:** Low. No `http://` URLs in current seed data.

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

## 🧹 P2-8a + P2-8b code-review follow-ups

### Middleware does a `profiles.status` round-trip on every authenticated request
**Source:** P2-8a code review (I2)
**Rationale:** `src/lib/supabase/middleware.ts` now reads `profiles.status` for every authenticated request to support immediate ban enforcement. At demo scale (~1000 members) it's unnoticeable; at real scale or on cold-start serverless it adds measurable p95 latency.
**Action (Phase 3):** Move `status` into a Supabase Auth JWT custom claim via an auth hook. Middleware reads from the JWT — zero DB hit per request. Ban-taking-effect time becomes "until next token refresh" (≤1 hour) rather than "immediate", which is acceptable for the threat model.
**Priority:** Low. Optimisation, not a correctness issue.

### Middleware should also sign out if `profiles.deleted_at` is set
**Source:** P2-8b code review (I3)
**Rationale:** The ban flow signs users out when `status = 'banned'`. The delete flow sets `deleted_at` but doesn't flip `status`. If `auth.signOut()` silently failed during deletion (rare but possible), the cookie persists and middleware wouldn't catch the deleted-but-still-logged-in state.
**Action:** Add a parallel `if (profile?.deleted_at) { signOut + redirect }` alongside the ban check in `src/lib/supabase/middleware.ts`. Three lines; belt-and-braces.
**Priority:** Low. Defence-in-depth.

### `/?account_deleted=1` lands silently on the homepage
**Source:** P2-8b code review (S1)
**Rationale:** After account deletion the user is redirected to `/?account_deleted=1`, but there's no UI handler for the param — they see the normal landing page with no visible confirmation the deletion completed. The redirect itself is signal, but an explicit "Your account has been closed" toast would be nicer.
**Action:** Client Component mounted in the root layout that reads `?account_deleted=1`, shows a toast, and strips the param via `router.replace`. Mirrors the `BookingCancelledHandler` pattern.
**Priority:** Low. UX polish.

### Legal-page "Last updated" dates are hardcoded
**Source:** P2-8b code review (S2)
**Rationale:** `/privacy` and `/terms` both hardcode "Last updated: 21 April 2026" at the top. Two places to remember when re-publishing after a policy change.
**Action:** Extract to a shared constant (`src/app/(legal)/_constants.ts` or similar), or pull from `git log` at build time via a script.
**Priority:** Very low.

<!-- Resolved in P2-9: migration 20260425000001 adds notifications.recipient_user_id
     FK + extends sanitise_user_notifications to (uuid, text DEFAULT NULL) which
     scrubs sender rows + recipient rows by FK + recipient rows by email match.
     deleteMyAccount now passes user.email so all three paths fire. The legacy
     1-arg overload is dropped explicitly to avoid PostgREST overload ambiguity. -->

### Attendee messaging fan-out has no rate limiting
**Source:** P2-9 code review (S3)
**Rationale:** `emailEventAttendees` runs a sequential `await sendEmail(...)` loop inside `next/server.after()`. Resend free tier caps at 10 req/sec — natural per-call latency throttles us under ~50 attendees, but a 100+ attendee blast will start hitting 429s after the first burst. Recoverable via the new failed-notifications retry view, but worth pre-empting.
**Action:** Add a small per-iteration delay (~120ms) or `p-limit({ concurrency: 8 })` cap before event sizes grow into 3-figure attendees. `src/app/(admin)/admin/actions.ts:emailEventAttendees`.
**Priority:** Low until typical event size exceeds 50 attendees.

### "Failed sends" link in admin notifications page lacks count badge
**Source:** P2-9 code review (nit)
**Rationale:** The original P2-9 plan called for a numeric pill on the failed-sends nav link so admins notice new failures without clicking through. Shipped without it for v1.
**Action:** Server-fetch a `count(*)` of email/failed rows in `/admin/notifications/page.tsx` and render a small pill if > 0. `src/components/admin/AdminSidebar.tsx` should also surface it on the mobile tab bar.
**Priority:** Low.

### `EventsPageClient` (upcoming events list) doesn't filter event images via `resolveEventImage`
**Source:** P2-10 preview verification
**Rationale:** The new `/events/past` page wraps `event.image_url` in `resolveEventImage()` so disallowed hosts fall through to a placeholder rather than crashing the page (the bug PR #19 originally fixed). The pre-existing `/events` listing client passes `event.image_url` straight to `next/image`, which still crashes for the seed data containing `ca-times.brightspotcdn.com`. The brightspot URL only doesn't currently take down `/events` because the affected event happens to be past — but as soon as a seeded upcoming event is added on a disallowed host, the listing dies.
**Action:** Switch `EventsPageClient` (and any other components that take `event.image_url` directly) to use `resolveEventImage()`. Also audit `EventCard`, `RelatedEvents`, etc. Likely a 30-min PR; bundle with the allowlist-drift test follow-up above.
**Priority:** Medium. Live foot-gun the moment seed data lands on a non-allowed host.

### Profile completion weights duplicated between Node and Deno
**Source:** P2-10 self-review
**Rationale:** `src/lib/utils/profile-completion.ts` (Node, source of truth, Vitest-tested) and `supabase/functions/daily-notifications/index.ts` (Deno, edge function) carry identical `PROFILE_FIELD_WEIGHTS` + `PROFILE_FIELD_LABELS` definitions. Drift would surface as the banner showing one percentage and the nudge email another. Vitest doesn't run Deno code, so no automated guard.
**Action:** Extract weights to a JSON file both runtimes can read, or write a script that reads both files and asserts the constants match (run in CI). Lower-effort interim: a comment in both files cross-referencing each other is already in place.
**Priority:** Low until the weights need to change.

### Profile-nudge cron window can permanently miss users when cron skips ≥2 days
**Source:** P2-10 self-review
**Rationale:** `processProfileNudges` matches profiles created in `[Y-4d, Y-3d]` on day Y. If pg_cron skips a day, the user falls outside both that window and any subsequent run's window — they never get nudged. The `profile_nudge_email_sent_at` column never gets stamped because they were never selected. The result is a silent drop, not an error.
**Action:** Widen the window or use a "no nudge sent AND created > 3 days ago AND created < 30 days ago" predicate. The current narrow window was chosen so the same user matches exactly once across runs; a wider predicate needs the `profile_nudge_email_sent_at IS NULL` check to remain the dedupe (which it already is — so widening is safe).
**Priority:** Low. Cron has been reliable to date.

### `[redacted` marker string is duplicated across migration + Server Action
**Source:** P2-9 code review (nit)
**Rationale:** `actions.ts:retryNotification` checks `body.startsWith('[redacted')`, mirroring the literal `[redacted — account deleted]` written by the `sanitise_user_notifications` RPC. If the RPC's redaction phrasing ever changes, the retry guard silently drifts.
**Action:** Extract to a shared TS constant (or expose via the schema) and update the migration's UPDATE values to reference the same prose in a comment.
**Priority:** Very low.

### `/events/past` omits cancelled events silently (no transparency)
**Source:** P2-10 post-merge code review (nit)
**Rationale:** `getPastEvents` filters `eq('is_cancelled', false)`. An attendee searching the archive for an event they remember booking won't find it if it was cancelled. Defensible (we'd rather not surface failures), but reduces transparency.
**Action:** Either show cancelled past events with a "Cancelled" badge variant, or accept the current omission and document it on the empty state. Product call. `src/lib/supabase/queries/events.ts:getPastEvents`.
**Priority:** Low.

### `/events/past` has no pagination beyond the first 60
**Source:** P2-10 post-merge code review (nit)
**Rationale:** `getPastEvents` caps at `.limit(60)` with no "Load more" affordance. As the archive grows past 60 events the oldest get dropped silently from the public archive. At today's cadence this is years away.
**Action:** Add cursor-based pagination via `created_at` (or a "Load more" Server Action that appends the next 60). `src/app/events/past/page.tsx` + `src/lib/supabase/queries/events.ts`.
**Priority:** Low. Not urgent at current event volume.

### Sitemap static-route `lastModified` always shifts to "now" on regeneration
**Source:** P2-11 pre-push code review (nit)
**Rationale:** `src/app/sitemap.ts` sets `lastModified: now` (a single `new Date()` captured at request time) for all 8 static routes. Every sitemap fetch shifts every static route's timestamp, signalling to crawlers that all 8 pages changed since the last visit — wasteful re-crawl for /privacy, /terms, /about etc. that update yearly at most.
**Action:** Bake a build-time constant per route, or read the page source's mtime. Dynamic event entries already use `event.updated_at` correctly.
**Priority:** Low. Crawlers' politeness throttles damp the impact.

### Organization JSON-LD `logo` points at the OG image (wide), not a square logo
**Source:** P2-11 pre-push code review (nit)
**Rationale:** `src/lib/seo/organization.ts:logo` references `/og-image.jpg` — that's the social-share image (1200x630, horizontal). Schema.org `Organization.logo` should be a near-square ImageObject for Knowledge Panel use. Current value works (Google accepts URL strings) but the wide aspect ratio gets cropped awkwardly in the panel.
**Action:** Add a `/logo.png` (square, ~600x600, transparent or brand background) and switch the JSON-LD to an ImageObject:
```ts
logo: { '@type': 'ImageObject', url: canonicalUrl('/logo.png'), width: 600, height: 600 }
```
**Priority:** Low. Worth doing alongside any brand-asset audit.

### Event JSON-LD Performer entries lack `image` / `url` (richer markup)
**Source:** P2-11 pre-push code review (nit)
**Rationale:** `src/lib/seo/event.ts:eventJsonLd` performers carry name + jobTitle + worksFor only. Schema.org Person also accepts `image` (avatar URL — already on `host.profile.avatar_url`) and `url` (host profile page — doesn't exist yet). Adding the avatar would enrich the rich-result preview.
**Action:** Route `host.profile.avatar_url` through `resolveAvatarUrl` (to filter disallowed hosts) and add as `image` on each performer Person. Defer `url` until per-host profile pages exist.
**Priority:** Low.

### `<JsonLd>` escape only handles `<` (defence-in-depth: also escape `>` and `&`)
**Source:** P2-11 pre-push code review (nit)
**Rationale:** `src/components/seo/JsonLd.tsx` escapes `<` to prevent script-tag breakout. Sufficient against the `</script>` attack, but some style guides also escape `>` and `&` as `\u003e` / `\u0026` for HTML-context defence-in-depth and consistency with `serialize-javascript`'s well-known behaviour. Not a known vulnerability vector for JSON-LD specifically; just hardening.
**Action:** Extend to `.replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))`. Mention in the JSON-LD security audit when one happens.
**Priority:** Very low.

### Footer quick-links column is now 8 entries
**Source:** P2-12 pre-push code review (S3)
**Rationale:** Events / Past Events / Gallery / About / Contact / Collaborate / Join / Sign In = 8 vertical entries in a single footer column. Functional but visually dense on desktop and a long scroll on mobile. The links are all useful — splitting them is the better fix than removing.
**Action:** Either two CSS columns under one heading, or two thematic groups: "Discover" (Events / Past Events / Gallery / About) + "Connect" (Contact / Collaborate / Join / Sign In). `src/components/layout/Footer.tsx`.
**Priority:** Low.

### `<InstagramFollowSection>` link doesn't announce "opens in new tab" to screen readers
**Source:** P2-12 pre-push code review (nit)
**Rationale:** Both card + banner variants render `<a target="_blank" rel="noopener noreferrer">` with text "Follow @the_social_seen" — visually clear, but screen readers don't announce the new-tab behaviour without an explicit signal. The lucide Instagram icon next to the text has no `aria-hidden` either; not a problem because the text label is sufficient, but tidy to mark decorative.
**Action:** Add `aria-label="Follow @the_social_seen on Instagram (opens in a new tab)"` on the anchor (or a visually-hidden `<span class="sr-only">`). Add `aria-hidden="true"` to the icon. `src/components/landing/InstagramFollowSection.tsx`.
**Priority:** Low.

### Honeypot field name `company_website` lives next to a real `website` field on /collaborate
**Source:** P2-12 pre-push code review (nit)
**Rationale:** A sophisticated bot inspecting form fields could clock the difference and skip only `company_website`. The 2-second timing check is the real second line, so this is defence-in-depth only, but renaming the honeypot to something semantically distant (`fax_number`, `referral_code`) closes the proximity vector.
**Action:** Rename `HONEYPOT_FIELD` constant in `src/app/contact/actions.ts` and the matching `<input name="...">` in both `ContactForm.tsx` and `CollaborateForm.tsx`. Three-file find-and-replace. Will land cleanly with the rate-limiting follow-up.
**Priority:** Very low.

### Sandbox `replyTo` is not rewritten — replies escape the sandbox
**Source:** P2-12 pre-push code review (nit)
**Rationale:** When `SANDBOX_FALLBACK_RECIPIENT` is set (current state until Resend domain DNS verifies), `sendEmail` rewrites `to` to the sandbox recipient and prefixes the subject. The new `replyTo` extension does NOT participate — a contact-form submission goes to the sandbox inbox, but if the team replies, it goes to the real visitor email. For internal testing this is confusing (test "submissions" trigger replies that hit the real visitor); for prod it's the desired behaviour but invisible during sandbox.
**Action:** Either (a) also rewrite `replyTo` to the sandbox recipient when sandbox is active, or (b) accept the current behaviour and document it in `src/lib/email/send.ts` doc comment + `docs/SPRINT-2-HANDOVER.md`. Operator concern.
**Priority:** Low.

### Document the `sent_by` = recipient convention for cron-driven sends
**Source:** P2-10 post-merge code review (nit, partially actioned)
**Rationale:** The Deno edge function's `sendWithLog` writes `sent_by = relatedProfileId` where `relatedProfileId` is the recipient's profile id (not the cron's identity). This is critical for the GDPR scrub via path 1 (`sent_by = p_user_id`). The follow-up commit on the P2-11 branch added `recipient_user_id` population so the FK path also covers it, but the `sent_by` convention remains the legacy guard.
**Action:** Add a CONTRIBUTING/architecture note (or extend the comment in `sendWithLog`) explicitly warning future maintainers not to "fix" `sent_by` to a system uuid without keeping `recipient_user_id` populated.
**Priority:** Low. The inline comment now exists; documentation expansion is just-in-case.

---

## 🧪 Testing gaps

<!-- Resolved in P2-8b (PR #24): wrapped the assertion in `waitFor(...)`
     after it flaked two CI runs in a row. Inline fix preferred over
     another re-run. -->

### Dialog a11y — focus trap + Escape-key on moderation/delete/share dialogs
**Source:** P2-7a + P2-8a + P2-8b + P2-9 code reviews
**Rationale:** Five dialog/confirm sites now in the codebase (`BookingCancelledHandler`'s toast, `MemberModerationDialog`, `DataPrivacySection`'s delete dialog, `DuplicateEventButton`'s native `confirm()`, `EmailAttendeesForm`'s native `confirm()`) lack focus trap + Escape-key close. The two new P2-9 sites use native `window.confirm` for consistency with the existing `EventsTable` delete pattern, but should migrate alongside the others. Radix Dialog is in deps; wrapping these gets focus trap, Escape, portal, and scroll-lock for free.
**Action:** Migrate all five sites to Radix Dialog in a focused a11y PR. Small, mechanical change; no behaviour impact beyond the a11y improvement.
**Priority:** Low. A11y gap, not a blocker. Worth bundling with any other a11y work (e.g. WCAG AA audit).

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
