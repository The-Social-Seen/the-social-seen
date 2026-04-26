# W5 — Frontend: Complete Your Profile banner + admin tag picker

**Agent:** `/project:frontend-developer`
**Wave:** W5 — runs after W1+W2+W3 are merged to main. Independent of W4 (tests run on the migrations, not on this UI).
**Branch:** `feat/member-data-layer-w5-frontend` from main.

---

## Pre-flight: UX decisions that should be made before this prompt runs

This prompt assumes a UX direction. If any of these aren't obvious from the spec, run `/project:ux-designer` first to produce a one-pager covering:

- Banner copy + dismiss/persistence behaviour for "Complete Your Profile"
- Tag picker visual: chip grid vs dropdown vs typeahead, how primary vs secondary is distinguished, how the admin selects "this is the primary"
- Q9 disposition: do existing members get re-prompted to confirm their interests post-migration, or silently re-mapped?

If product owner has answered Q9 in `docs/member-data-layer-spec.md` § "Questions for the product owner" — frontend can proceed without ux-designer. Otherwise, pause this prompt and run ux-designer first.

---

## Prompt to paste into the agent

> Read `CLAUDE.md`, `social-seen-safety-SKILL.md`, `docs/member-data-layer-spec.md` (Decisions 1, 2, 9, 10 + the Type-system surface section at lines 1632–1710 — that's your TS API surface), and any `docs/admin-mobile-spec.md` patterns relevant to the admin form. Also read `src/components/profile/ProfilePageClient.tsx` and `src/components/admin/EventForm.tsx` to understand the surfaces you're modifying.
>
> **Goal:** ship the user-visible surfaces of the Member Data Layer:
> 1. "Complete Your Profile" banner where members optionally fill in `gender` + `age_range` post-signup.
> 2. Admin EventForm tag picker — replaces the single `category` enum select with a primary tag (radio-style, exactly one) + secondary tags (multi-select chips). Saves to `event_tags` via the bidirectional trigger.
> 3. Optional: post-migration interest re-pick prompt (one-time banner asking existing members to verify their interests against the new canonical list) — only if Q9 is approved.
>
> **In scope:**
>
> 1. **Complete Your Profile banner** (member-facing).
>    - Component: extend the existing pattern referenced in CLAUDE.md ("Complete Your Profile" banner from Batch 5). If a `ProfileCompletionBanner` component exists, edit it; otherwise create one in `src/components/profile/`.
>    - Visible on the profile page when `gender IS NULL OR age_range IS NULL`. Dismissible (persist via cookie or `profile_dismissed_completion_banner_at` column — match the existing dismiss pattern if one exists; otherwise use a new column with a follow-up migration handled separately).
>    - Form: two fields — gender radio group (4 options matching the enum + a "prefer not to say" pre-selected for sensitivity) and age_range select (7 bands). Both optional.
>    - Copy: *"Helps us keep events balanced — optional, only visible to the team."* Reuse this exact copy unless ux-designer has refined it.
>    - Saves via a Server Action `updateMyDemographics(input: { gender?, age_range? })` in `src/app/(member)/profile/actions.ts` or equivalent. Server Action calls Supabase directly with the user's own auth — RLS allows self-update on these columns per Decision 7.
>    - **Privacy display rule**: gender and age_range MUST NOT appear anywhere on member-facing profile views (own profile read is fine; the public-community view never shows them). Only admin views may render them, and even then, the admin must read via the SECURITY DEFINER `admin_get_user_demographics()` function, not via direct SELECT.
>
> 2. **Admin EventForm tag picker** (admin-facing).
>    - Replace the existing single `category` `<select>` in `src/components/admin/EventForm.tsx` with a two-zone tag picker:
>      - **Primary tag** (required, exactly one): radio chip group of the 15 primary-eligible tags. The selected tag has `bg-gold/10 + border-gold` styling; unselected use `border-border + hover:border-gold/40`. Use the slug as the form value, label for display.
>      - **Secondary tags** (optional, 0..N): multi-select chip grid of all 23 tags. Selecting a tag toggles a secondary `event_tags` row. Visually distinct from primary (e.g. `bg-bg-card + border-blush/40` selected; `bg-transparent + border-border` unselected).
>    - Form submit goes to a new Server Action `saveEventTags(eventId, primary_slug, secondary_slugs[])` in `src/app/(admin)/admin/actions.ts`. Inserts into `event_tags`; the bidirectional trigger handles `events.category` automatically.
>    - **Existing form behaviour**: the legacy `category` `<select>` can be retired in this PR. The trigger will keep the column populated for legacy reads.
>    - **Edit flow**: when editing an existing event, pre-populate the picker from `event_tags` (one is_primary=true row + N is_primary=false rows). Use a Server Component fetch in the page; pass tag selections as props.
>    - **Validation**: refuse to save if no primary tag is selected. Inline error: *"Pick a primary tag — this is the main category for the event."*
>
> 3. **Q9 — Existing-member interest re-pick prompt** (conditional).
>    - **Only build this if the product owner has approved Option A in spec § "Questions for the product owner" Q9.** If the answer is Option B (silent re-map, no prompt), skip this work item entirely.
>    - If approved: a one-time dismissible banner shown to members whose `user_interests` were silently re-mapped (i.e. who logged in after Migration 3 ran without explicitly re-selecting). Banner copy: *"We've refined our interest categories. Take a moment to update yours."* CTA navigates to the existing interest-picker on the profile page.
>    - Track "user has reviewed post-migration interests" with a profile column or a flag — match the existing dismiss pattern.
>
> **Mobile responsiveness checks (mandatory — admin is now mobile-friendly per docs/admin-mobile-spec.md):**
> - Both the banner and the tag picker work at 375px and 390px.
> - Tag picker: chips wrap, touch targets ≥ 44×44, primary radio chips and secondary multi-select chips both visually distinct on mobile.
> - Banner: stacks vertically on mobile, dismiss button is 44×44 minimum.
> - Dark mode parity for both.
>
> **Out of scope:**
> - Recommendation engine ("events you might like").
> - Email targeting by tag overlap.
> - Search-by-tag UI.
> - Admin demographics dashboard / per-event ratio display (separate Phase 3 work).
> - Member-facing event filter by interest (separate; would consume the `event_tags` join).
> - Removing the legacy `events.category` column or `user_interests.interest` column — those are F1 / F2.
>
> **Verification before reporting done:**
> - `pnpm tsc --noEmit` clean
> - `pnpm lint` no new errors
> - `pnpm build` succeeds
> - `pnpm vitest run` 1188+ + W4's tests passing
> - Manually exercise:
>   - Create a new event in admin, pick a primary + 2 secondaries, save — confirm `event_tags` rows persist and `events.category` updates via trigger.
>   - Edit the same event, change the primary, save — confirm only one primary persists.
>   - Refuse-save check: try to save with no primary selected; confirm validation blocks.
>   - Member side: load profile page as a user with NULL gender; banner appears. Fill it in; banner dismisses. Reload; banner stays dismissed.
>   - Member side: confirm gender/age_range never render on the public community profile view (test by viewing another member's profile while logged in).
> - Mobile checks at 375 and 390: zero horizontal scroll, all touch targets ≥ 44×44.
>
> **Branch + PR:**
> - Branch from main: `git checkout main && git pull --ff-only && git checkout -b feat/member-data-layer-w5-frontend`
> - One PR: `feat(profile, admin): demographics banner + admin tag picker (W5)`
> - PR body: list components touched, screenshots of the banner (light + dark, mobile + desktop), screenshots of the admin tag picker (with primary + secondaries selected), confirmation that gender/age_range don't leak to member-facing views.
>
> **Hard rules:**
> - Member-facing views must never render gender or age_range. If you find yourself wiring it into a public profile component, STOP — that's a security regression.
> - Saves to demographics use the user's own auth, not the admin client. The user updates their own profile row only.
> - Saves to event_tags use admin auth. The Server Action verifies `profiles.role = 'admin'`.
> - Don't add new design tokens. All colours via existing Tailwind tokens.
> - Don't refactor unrelated admin-form code while you're in the EventForm — keep the diff focused.

---

## Spec sections this prompt depends on

- Decision 1 (gender enum values) — spec lines 72–117 — defines the radio options
- Decision 2 (age range bands) — spec lines 118–177 — defines the select options
- Decision 9 (reconciliation map) — spec lines 915–1031 — informs Q9 prompt copy if used
- Decision 10 (privacy policy revision) — spec lines 1032–1072 — banner copy must align with the policy
- Type-system surface — spec lines 1632–1710 — TS types for the new tables/columns

## After W5 lands

Code-reviewer runs against the full feature with W1, W2, W3, and W4 in main. PR for W5 is the trigger for the final review pass.
