# W4 — Tester: coverage for Migrations 1, 2, and 3

**Agent:** `/project:tester`
**Wave:** W4 — runs after W1 (or after W2+W3, depending on cadence). Recommended: run twice — once after W1 lands, once after W2+W3 lands. Tighter feedback loops.
**Branch:** add tests onto whichever wave's branch is currently in review (W1's branch first, then W2+W3's branch). Or, if both have already merged, branch from main as `test/member-data-layer-coverage`.

---

## Prompt to paste into the agent

> Read `CLAUDE.md`, `social-seen-safety-SKILL.md`, and `docs/member-data-layer-spec.md` (skim — the SQL fragments + Risk Register + Decision 7 are the high-value sections for tests). The migrations themselves are the source of truth for actual SQL — tests should exercise *behaviour*, not assert SQL strings.
>
> **Goal:** add a focused test suite covering the new schema's correctness invariants. The migrations are by `/project:backend-developer`; your job is to prove they hold the line.
>
> **Test files to create:**
>
> 1. **`src/lib/supabase/__tests__/migration-w1-demographics.test.ts`** — Migration 1a + 1b coverage. The phone-number column was bundled into W1; this test file covers all three protected columns (gender, age_range, phone_number) using the same pattern repeated per column.
>    - **RLS / GRANT narrowing — anon** — fresh anon client `select gender, age_range, phone_number from profiles` must return permission-denied (not empty rows). Pattern: spawn a test client without auth, run the SELECT, expect a Postgres error code matching the GRANT denial. Run as three separate tests, one per column, so a failure cleanly identifies which column was over-exposed.
>    - **RLS / GRANT narrowing — authenticated non-admin** — same query as another authenticated user — must also fail. The whole point of Option A is that even authenticated users can't read these columns directly; only the SECURITY DEFINER functions can.
>    - **SECURITY DEFINER own-row read — demographics** — authenticated member calls `get_my_demographics()` and gets their own gender + age_range. Bonus: verify they cannot pass another user's id and read it.
>    - **SECURITY DEFINER own-row read — phone** — authenticated member calls `get_my_phone()` and gets their own phone_number. Same boundary check: cannot pass another user's id.
>    - **SECURITY DEFINER admin read — demographics** — admin calls `admin_get_user_demographics(target_user_id)` and gets the values; non-admin authenticated calls the function and gets a permission error.
>    - **SECURITY DEFINER admin read — phone** — admin calls `admin_get_user_phone(target_user_id)` and gets the phone; non-admin authenticated gets a permission error.
>    - **SMS-send path still works** — sanity check that `src/lib/sms/send.ts` (admin-client read) can still SELECT `phone_number` after the GRANT narrowing. The admin-client bypasses the GRANT; this test guards against an accidental REVOKE FROM postgres / service_role that would break the SMS pipeline.
>    - **Enum constraints** — INSERT into profiles with `gender = 'invalid_value'` fails; `gender = 'prefer_not_to_say'` succeeds; `age_range = '17-24'` fails (not in the spec's 7 bands); `age_range = '50+'` succeeds.
>    - **NULL handling** — gender, age_range, and phone_number are nullable; INSERT without them succeeds; updates to NULL succeed.
>    - **Existing self-read code paths still work** — manual / integration check that `ProfileHeader`, `SmsPreferencesSection`, and the privacy-export action still produce phone in the output after the migration to `get_my_phone()`. If unit tests for those components mock the data layer, ensure mocks return the same shape; if integration-style, verify against the real DB.
>
> 2. **`src/lib/supabase/__tests__/migration-w2-w3-taxonomy.test.ts`** — Migrations 2 + 3 coverage.
>    - **Seed integrity** — `select count(*) from tags` is exactly 23; the 15 primary-eligible slugs match the spec's Decision 4 list verbatim; `is_primary_eligible` constant in `src/lib/constants.ts` matches the seed.
>    - **Primary-tag uniqueness** — INSERT a second `is_primary = true` row for an event that already has one; expect unique-violation error from the partial unique index.
>    - **Bidirectional sync — events.category → event_tags** — UPDATE `events.category = 'drinks'`; assert the matching `event_tags` row with the `drinks-bars` tag has `is_primary = true` and any prior primary is now false.
>    - **Bidirectional sync — event_tags → events.category** — UPDATE `event_tags.is_primary = true` for a different tag; assert `events.category` updates to the matching enum value.
>    - **Trigger recursion guard** — UPDATE both sides in a transaction; assert the trigger doesn't infinite-loop (use a `pg_trigger_depth()`-aware test or a wall-clock timeout: completes in <50ms).
>    - **Backfill correctness** — after `supabase db reset` (which runs all migrations + seed):
>      - `select count(*) from event_tags where is_primary` equals `select count(*) from events where deleted_at is null`
>      - `select count(*) from event_tags where not is_primary` ≥ 16 (per spec)
>      - `select count(*) from user_interests where tag_id is null` is 0
>      - Spot-check: the Halloween event (Event 28) has `nightlife-dancing` as primary and `festivals-seasonal` + `themed-socials` as secondaries.
>    - **`user_interests.tag_id` FK integrity** — try INSERT with a `tag_id` that doesn't exist in tags; expect FK violation.
>    - **Unique constraint swap** — `uq_user_interests_user_tag (user_id, tag_id)` exists; same user inserting the same tag twice fails. The legacy `uq_user_interests_user_interest` constraint either still exists in parallel (if the migration kept it) or is gone — match whichever the migration did.
>
> **Test patterns:**
> - Use the existing pattern in `src/lib/supabase/__tests__/` for spinning up clients with different roles. If there isn't a clean pattern, look at how `src/app/(member)/profile/__tests__/privacy-actions.test.ts` mocks Supabase clients per role.
> - For migration-level RLS / GRANT tests, prefer integration tests against `supabase start` (the local Postgres). Vitest mocks won't catch GRANT-narrowing failures — they need the real DB enforcing the rules.
> - Each test must fail loudly when the invariant is broken: e.g. the GRANT test should fail if a future migration accidentally re-broadens the SELECT grant on `gender` to `authenticated`.
>
> **Out of scope:**
> - Frontend tests for the W5 banner / picker — those land in W5's branch with the UI work.
> - Stress tests for the bidirectional trigger under concurrent writes — Phase 3 stretch goal, not required for this round.
> - Playwright E2E for the full member-data flow — `docs/FOLLOW-UPS.md` already has Playwright on the testing-gaps list.
>
> **Verification before reporting done:**
> - `pnpm vitest run` shows total tests = (current count) + (your additions); zero failures.
> - Each new test, when intentionally inverted (e.g. comment out the GRANT line in the migration), fails with a clear diff. Confirm at least one test per file by manual sabotage.
> - Run against `supabase start` locally — confirm tests pass against a fresh DB reset.
>
> **Branch:**
> - If W1's branch is still open: add to that branch and amend the W1 PR description.
> - If W2+W3's branch is still open: add to that branch.
> - If both have merged: new branch `test/member-data-layer-coverage` from main.
>
> **Hard rules:**
> - Don't write tests that pass against mocks but would fail against the real DB. The whole point of these tests is to catch DB-layer regressions.
> - Don't disable any existing test to get yours green. If you suspect an existing test is wrong, flag it — don't delete it.
> - If the spec's Risk Register identifies a risk you can test for, write the test. Don't skip risks the architect explicitly called out.

---

## Spec sections this prompt depends on

- Decision 6 (primary-uniqueness constraint) — spec lines 460–511
- Decision 7 (RLS + GRANT narrowing) — spec lines 512–734
- Decision 8 (migration sequence) — spec lines 735–914
- Decision 9 (per-event backfill — for spot-check assertions) — spec lines 915–1031
- Risk Register — spec lines 1711–1730 (test the risks the architect already enumerated)
- All SQL fragments — spec lines 1073–1631 (these define the actual behaviour your tests assert)

## After W4 lands

W5 (Frontend) is the next user-visible work. Code-reviewer runs after W5 with full migration + test + UI in hand.
