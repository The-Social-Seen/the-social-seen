# W1 — Backend: Migration 1 (profile demographics + phone GRANT-narrowing bundle)

**Agent:** `/project:backend-developer`
**Wave:** W1 of the Member Data Layer build (Phase 3) — bundled with the deferred phone_number GRANT-narrowing fix from `docs/PHASE-3-BACKLOG.md` § "Per-owner column grants on `phone_number`".
**Depends on:** Q1 product-owner sign-off (Decision 7 Option A vs B for GRANT narrowing). **CONFIRMED: Option A.**
**Branch to create:** `feat/member-data-layer-w1-profile-demographics-phone` from latest `main` (after the spec branch lands).

---

## Why phone is bundled

The phone_number column's GRANT narrowing was already deferred in `20260420000003_harden_profiles_pii_access_fix.sql:19-27` with an explicit comment: *"column-level grants tied to phone_number can be added later"*. That "later" is now, since we're applying the same SECURITY DEFINER pattern to gender + age_range. Same migration ceremony, same code-reviewer scrutiny, same test harness. Closing two security-hardening items in one PR is materially cheaper than two sequential ones.

Phone consumers audited (no breakage expected):

| Consumer | Path | Action |
|---|---|---|
| Self-edit phone | `src/app/(member)/profile/actions.ts:69-82` | UPDATE via own auth, RLS-protected — no change |
| Self-read phone (own profile) | `src/components/profile/ProfileHeader.tsx:110-113`, `src/app/(member)/profile/preferences-actions.ts:110`, `src/app/(member)/profile/privacy-actions.ts:115` | Migrate to `get_my_phone()` SECURITY DEFINER call |
| SMS-send code | `src/lib/sms/send.ts:81-108` | Uses admin client — unaffected (bypasses GRANT) |
| Signup write | `src/app/(auth)/actions.ts:115` | INSERT via auth trigger — unaffected |
| GDPR-export anonymise | `src/app/(member)/profile/privacy-actions.ts:321` | UPDATE to NULL via admin client — unaffected |
| Admin display | None — admin views don't render phone | n/a |

---

## Prompt to paste into the agent

> Read `CLAUDE.md`, `social-seen-safety-SKILL.md`, and `docs/member-data-layer-spec.md` (in full) before starting. The spec is your source of truth for demographics — when in doubt, defer to it rather than improvise. For the phone-number side of W1, the spec's pattern (Decision 7 Option A) extends mechanically; the file head matter above this prompt names the consumers you need to migrate.
>
> **Goal:** ship two migrations and three small app-code migrations in one PR:
> 1. **Migration 1a — demographics**: adds `gender` + `age_range` enums and columns to `public.profiles`, narrows the `authenticated` GRANT, creates SECURITY DEFINER functions for self-read and admin-read.
> 2. **Migration 1b — phone GRANT narrowing**: applies the same Option A pattern to the existing `phone_number` column. Revokes SELECT (`phone_number`) from `authenticated`, creates `get_my_phone()` and `admin_get_user_phone(p_user_id uuid)` SECURITY DEFINER functions mirroring the demographics ones.
> 3. **App-code migrations**: switch the three self-read sites in `src/` from direct `select phone_number` to the new `get_my_phone()` function.
>
> **In scope (this PR):**
>
> **Migrations (two `.sql` files):**
> 1. `supabase/migrations/<timestamp>_add_profile_demographics.sql`. Body contains the SQL fragments verbatim from spec sections:
>    - "New enums (Migration 1)" — spec lines ~1080–1100
>    - "Profile column additions (Migration 1)" — spec lines ~1101–1119
>    - "SECURITY DEFINER demographics functions (Migration 1)" — spec lines ~1120–1164
>    - GRANT narrowing per **Decision 7 Option A** (CONFIRMED by product owner)
>    - Migration header per project pattern: intent, anon-visibility decision (NOT exposed, admin-only via SECURITY DEFINER), lawful basis (legitimate interest in event-mix balancing).
>
> 2. `supabase/migrations/<timestamp+1>_narrow_phone_number_grant.sql`. Body mirrors the demographics GRANT-narrowing pattern, applied to phone_number:
>    - `REVOKE SELECT (phone_number) ON public.profiles FROM authenticated;`
>    - `GRANT SELECT (phone_number) ON public.profiles TO postgres, service_role;` (or whatever the existing project pattern uses for admin paths — match Decision 7 exactly).
>    - Two SECURITY DEFINER functions mirroring the demographics ones in shape:
>      - `public.get_my_phone() RETURNS text` — reads `phone_number` for `auth.uid()`'s own row.
>      - `public.admin_get_user_phone(p_user_id uuid) RETURNS text` — reads phone for any user, but raises `EXCEPTION` if caller is not an admin (verify via `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')`).
>    - Migration header: explicit reference to `20260420000003_harden_profiles_pii_access_fix.sql:19-27` which deferred this work; explicit reference to spec's Decision 7 Option A as the pattern source; note that this closes the `docs/PHASE-3-BACKLOG.md` § "Per-owner column grants on `phone_number`" entry.
>
> **App-code migrations (three sites):**
> 3. `src/components/profile/ProfileHeader.tsx:110-113` — currently renders `profile.phone_number` directly. Change so the phone is fetched via `get_my_phone()` in the parent Server Component and passed as a prop. The component still receives a `string | null` — the source just changes.
> 4. `src/app/(member)/profile/preferences-actions.ts:110` — change the `select('sms_consent, phone_number')` to `.select('sms_consent')` plus a separate `get_my_phone()` call. Compose the result before returning.
> 5. `src/app/(member)/profile/privacy-actions.ts:115` (the GDPR data-export path) — change the export to source phone via `get_my_phone()` rather than the direct SELECT. The line at 321 (UPDATE phone_number to NULL on delete) uses the admin client and is unaffected — leave it.
>
> All three sites should keep their existing return shapes; only the source of the phone string changes. After the change, `grep -rn "phone_number" src/` should show only:
> - The TypeScript type at `src/types/index.ts:66`
> - The signup write at `src/app/(auth)/actions.ts:115`
> - The own-profile UPDATE at `src/app/(member)/profile/actions.ts:69-82`
> - The SMS server code at `src/lib/sms/send.ts:81-108` (admin-client read, unaffected)
> - The privacy-action anonymise at `src/app/(member)/profile/privacy-actions.ts:321` (admin-client write, unaffected)
> No SELECT against `phone_number` on the user's own auth path should remain in `src/`.
>
> **Out of scope (do NOT touch in this PR):**
> - Migrations 2, 3, or 4 from the spec.
> - Tests — Tester (W4) writes them.
> - The privacy policy edit (operator action, separate PR after migration lands).
> - Seed data changes.
> - `phone_number` validation, CHECK constraint, or column type — already established in `20260420000001`. We're only narrowing access, not redefining the column.
> - Any non-phone, non-demographic column. This PR is a focused security pass on three columns; resist scope creep.
>
> **Verification before reporting done:**
> - `pnpm tsc --noEmit` clean
> - `pnpm lint` no new errors
> - `pnpm build` succeeds
> - `pnpm vitest run` 1188+ passing (no regressions). Pay particular attention to existing tests for `ProfileHeader`, `SmsPreferencesSection`, and `privacy-actions` — they should still pass since shape didn't change.
> - Local migration apply: `supabase db reset` then run both migrations. Confirm:
>   - `\df+ public.get_my_demographics` exists with SECURITY DEFINER.
>   - `\df+ public.admin_get_user_demographics` exists with SECURITY DEFINER.
>   - `\df+ public.get_my_phone` exists with SECURITY DEFINER.
>   - `\df+ public.admin_get_user_phone` exists with SECURITY DEFINER.
>   - Anon visibility: `select gender, age_range, phone_number from profiles` from a fresh anon connection returns permission-denied (not empty rows). All three columns must reject anon SELECT.
>   - Authenticated non-admin visibility: same query from an authenticated client also returns permission-denied for these three columns. Other profile columns still read fine.
>   - Self-read works: authenticated user calls `get_my_phone()`, gets back their own phone string. Calls it without auth — gets NULL or permission error (depending on architect's spec for demographics, mirror that exactly).
>   - Admin-read works: user with `role = 'admin'` calls `admin_get_user_phone('<other-user-id>')` and gets the phone back. Same call by a non-admin returns an error.
> - Manual smoke test the three migrated app-code sites: load own profile page, confirm phone renders. Open SMS preferences, confirm phone shows. Trigger a data export, confirm phone is in the JSON.
>
> **Branch + PR:**
> - Branch from `main` after the spec PR has landed: `git checkout main && git pull --ff-only && git checkout -b feat/member-data-layer-w1-profile-demographics-phone`
> - Suggested commit shape (or one combined commit):
>   - `feat(profiles): migration 1a — gender + age_range demographics with admin-only access`
>   - `feat(profiles): migration 1b — narrow phone_number GRANT (closes deferred backlog entry)`
>   - `refactor(profile): switch self-read phone sites to get_my_phone() SECURITY DEFINER fn`
> - Open PR titled `feat(profiles): demographics + phone GRANT narrowing (W1)`. Body must include:
>   - Link to the spec
>   - List of SQL operations across both migrations
>   - Confirmation of GRANT narrowing approach (Option A — confirmed)
>   - The before/after `grep -rn "phone_number" src/` evidence showing only intentional remaining references
>   - Verification checklist results
>   - Note that this PR closes both Decision 7 Option A for demographics AND the `docs/PHASE-3-BACKLOG.md` § "Per-owner column grants on `phone_number`" entry.
> - Do NOT push directly to main; follow the PR review flow per CLAUDE.md.
>
> **Hard rules:**
> - No `supabase db reset` against hosted. Local only.
> - Do not modify `auth.users` directly.
> - Do not skip the GRANT narrowing on either column — that's the entire security point of W1.
> - The phone-number functions must mirror the demographics functions in shape and naming pattern, so future maintainers see "same pattern, different column" not "two different patterns".
> - If you discover the spec is internally inconsistent on Decision 7, STOP and report rather than guess.
> - If your audit of phone-number consumers in `src/` finds anything not in the table at the head of this prompt file, STOP and report — there may be a path the planner missed and we don't want to silently break it.

---

## Spec sections this prompt depends on (for the agent's quick reference)

- Decision 1 (gender enum values) — spec lines 72–117
- Decision 2 (age range bands) — spec lines 118–177
- Decision 7 (RLS policies + GRANT narrowing options) — spec lines 512–734
- Decision 8 (migration sequence intent — Migration 1 sub-section) — spec lines 735–914
- SQL fragment "New enums (Migration 1)" — spec lines 1080–1100
- SQL fragment "Profile column additions (Migration 1)" — spec lines 1101–1119
- SQL fragment "SECURITY DEFINER demographics functions (Migration 1)" — spec lines 1120–1164

For the phone bundle:
- Existing column definition + CHECK constraint — `supabase/migrations/20260420000001_add_profile_registration_fields.sql:26-37`
- Pre-existing harden migration that deferred GRANT narrowing — `supabase/migrations/20260420000003_harden_profiles_pii_access_fix.sql:19-27`
- Backlog entry being closed — `docs/PHASE-3-BACKLOG.md` § "Per-owner column grants on `phone_number`"

## After W1 lands

- W2+W3 unblocks. Run `prompts/phase-3-member-data-W2-W3-backend.md` next.
- Tester (W4) covers W1's RLS + SECURITY DEFINER cases for **all three columns** (gender, age_range, phone_number) — the test prompt at `prompts/phase-3-member-data-W4-tester.md` already includes parallel cases for phone (RLS / GRANT narrowing for `gender` is a template that the tester applies to each protected column).
- Once W1 lands, remove the "Per-owner column grants on `phone_number`" entry from `docs/PHASE-3-BACKLOG.md` in a small follow-up docs commit.
- Consider running W4 directly after W1 (tighter feedback loop) or hold until after W2+W3.
