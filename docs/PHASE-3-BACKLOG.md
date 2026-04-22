# Phase 3 Backlog

New-feature items scoped out of Phase 2 / Phase 2.5. Not open debt — ship-or-don't-ship product decisions for when Phase 3 starts.

Maintained at the end of each phase so feature ideas don't get lost in merged PR descriptions.

**Format:** title, source, rationale, rough estimate, dependencies.

---

## 🚀 Major features (original Phase 2 "What's Cut" list)

### Referral system
**Source:** PHASE-2-PLAN-v2.md §"What's Cut from Phase 2".
**Why deferred:** Rewards need mature payment infrastructure. Word-of-mouth already works via WhatsApp.
**Rough estimate:** 3-5 days for the MVP (referral code on profile, signup credit applied, admin view of attribution).
**Dependencies:** Stripe integration (shipped P2-7) — can use Stripe Coupons API.

### Multi-ticket bookings (+1 / +N)
**Source:** PHASE-2-PLAN-v2.md §"What's Cut from Phase 2".
**Why deferred:** Adds complexity to capacity logic (one booking consumes N spots) + payments (single charge for multiple tickets + split refunds). Revisit after core payments stable.
**Rough estimate:** 4-5 days.
**Dependencies:** None new. Needs `bookings.ticket_count` column + RPC updates for capacity math + UI for +N selection.

### Attendee check-in (QR / scanning)
**Source:** PHASE-2-PLAN-v2.md §"What's Cut from Phase 2".
**Why deferred:** No-show toggle (P2-8a shipped) covers the 80% operational need. Full check-in is a bigger build.
**Rough estimate:** 3-4 days (QR code per booking, scanner PWA, check-in state on booking).
**Dependencies:** PWA scaffold (itself a Phase 3 item) makes the scanner more usable on host phones.

### User-submitted event photos (with moderation queue)
**Source:** PHASE-2-PLAN-v2.md §"What's Cut from Phase 2".
**Why deferred:** Requires moderation queue + reject flow. Admin-uploaded photos cover current gallery.
**Rough estimate:** 3-4 days.
**Dependencies:** Supabase Storage quota planning if volume scales.

### PWA + push notifications
**Source:** PHASE-2-PLAN-v2.md §"What's Cut from Phase 2".
**Why deferred:** SMS (Batch 5) + email cover notification needs today. PWA is a "nicer app experience" story without a time-critical use case.
**Rough estimate:** 4-5 days (manifest + service worker + push subscription + VAPID keys + admin send).
**Dependencies:** None.

### Rich text admin messaging + mini-groups
**Source:** PHASE-2-PLAN-v2.md §"What's Cut from Phase 2".
**Why deferred:** Plain-text "Email All Attendees" (P2-9 shipped) covers 90% of need.
**Rough estimate:** 3-4 days for the rich-text editor + mini-group schema.
**Dependencies:** None.

### WhatsApp Business API
**Source:** PHASE-2-PLAN-v2.md §"What's Cut from Phase 2".
**Why deferred:** Requires Meta business verification (~1-2 weeks) + per-conversation costs. SMS via Twilio (Batch 5 shipped) covers transactional. Community WhatsApp group covers chat.
**Rough estimate:** 5-7 days + 2 weeks of operator-side verification.
**Dependencies:** Meta business verification complete.

---

## 🔌 Integrations deferred

### Instagram live oEmbed feed on /gallery
**Source:** P2-12.
**Rationale:** P2-12 originally specified oEmbed recent posts on /gallery. Shipped static "Follow Us" CTA instead because Meta's oEmbed endpoint requires a Facebook App + app-review process (~5-10 days).
**Action:** Create Facebook App + submit for `instagram_basic` review. On approval, server-fetch last 3-6 posts on /gallery render (cache aggressively — Meta rate limits). Fall back to the existing `<InstagramFollowSection>` on fetch failure.
**Priority:** Low — static CTA does the brand job. Only worth doing if marketing data shows live-post embeds drive engagement materially better.

### Twitter / LinkedIn social channels
**Source:** P2-12.
**Rationale:** Footer + Organization JSON-LD `sameAs` dropped Twitter + LinkedIn in P2-12 because those accounts don't exist yet.
**Action:** When the brand creates Twitter/X + LinkedIn, extend `SOCIAL_LINKS` in `src/lib/constants.ts` — footer + JSON-LD pick up automatically.
**Priority:** Trivial wire-up when accounts exist.

---

## 🛡️ Security hardening (deferred until launch scale)

### Ban-bypass mitigation
**Source:** P2-2 code review.
**Rationale:** P2-8 ban keys on `profiles.id`. A banned user can sign up again with a different email — new id, clean slate.
**Action:** Cross-check `phone_number` + `email` domain against `profiles` where `status='banned'` at signup. Tricky UX (what do you show a banned-then-banned user?) — product call.
**Priority:** Launch-scale issue; not a demo blocker.

### Per-owner column grants on `phone_number`
**Source:** Phase 2.5 context.
**Rationale:** If we ever let authenticated non-admin members browse other members' profiles, `phone_number` should be visible only to row owner + admins. Requires a security-definer function or view; current state is authenticated retains full SELECT (OK today because there's no member-facing profile browser).
**Action:** When profile-browser feature lands, add `get_profile_public(uuid)` SECURITY DEFINER that strips phone_number for non-owner callers.
**Priority:** Blocks the profile-browser feature if / when it ships.

### Email as hidden anon column
**Source:** Phase 2.5 Batch 1.
**Rationale:** Batch 1 tightened anon GRANT to remove email. Worth monitoring if any anon-facing code regresses this (e.g. a future event-detail page exposes host.email).
**Priority:** Prevention via the migration checklist note; no active work.

---

## 🧪 Test infrastructure

### Playwright scaffold
**Source:** Phase 2.5 Batch 8 + CLAUDE.md stretch goal.
**Rationale:** Booking RPC regression tests are manual today. Playwright + `supabase start` in CI closes the gap.
**Action:** See `docs/BOOKING-RPCS-TEST-PLAN.md` for the 12-scenario matrix that needs automating. Also covers edge-function date-window integration testing.
**Priority:** **HIGH — first Phase 3 item** per Batch 8 code review. Before first real signup.

---

## Revisiting cadence

Re-read this file at the start of each Phase 3 sprint. Pick one major feature + a handful of polish items per sprint. Don't treat Phase 3 as a monolith — cherry-pick based on actual member feedback + launch signals.
