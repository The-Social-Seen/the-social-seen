# W2 + W3 — Backend: Migrations 2 & 3 (canonical taxonomy + user_interests reconciliation)

**Agent:** `/project:backend-developer`
**Wave:** W2 + W3 of the Member Data Layer build, bundled in one PR.
**Depends on:** W1 merged (so the GRANT pattern is established) — *not strictly required for these migrations to apply, but ordering keeps the "demographic-related" work landing as a coherent sequence.* If you want to ship W2+W3 in parallel with W1 review, you can — they touch disjoint tables.
**Branch to create:** `feat/member-data-layer-w2-w3-tags-taxonomy` from latest `main`.

---

## Why bundled

W3 depends on `tags` rows existing before `user_interests.tag_id` can FK in. Shipping them as one PR avoids a half-migrated state where `user_interests.interest` (text) is unmapped on production. Two `.sql` files, one PR.

---

## Prompt to paste into the agent

> Read `CLAUDE.md`, `social-seen-safety-SKILL.md`, and `docs/member-data-layer-spec.md` (in full) before starting. Pay particular attention to the per-event backfill mapping in Decision 9 — it's a hand-curated `CASE` statement covering 33 historic events.
>
> **Goal:** ship Migrations 2 and 3 in one PR. Migration 2 creates the canonical `tags` + `event_tags` tables, seeds the 23 canonical tags (15 primary-eligible + 8 interest-only), backfills `event_tags` from existing `events.category` + per-event manual classifications, and installs the bidirectional sync trigger keeping `events.category` in lockstep with `event_tags.is_primary` until Migration 4 drops the enum. Migration 3 adds `user_interests.tag_id` (nullable initially), backfills it from `user_interests.interest` via the reconciliation map, then makes it NOT NULL with the FK constraint and replaces the unique constraint.
>
> **In scope (this PR — two `.sql` files):**
>
> 1. `supabase/migrations/<timestamp>_create_tags_and_event_tags.sql` — Migration 2.
>    Body assembles the SQL fragments verbatim from spec sections:
>    - "New tables (Migration 2)" — spec lines 1165–1221
>    - "Tag seed insert (Migration 2)" — spec lines 1222–1260 (23 rows)
>    - "Event-tags backfill (Migration 2)" — spec lines 1261–1447 (the per-event CASE)
>    - "Bidirectional sync trigger (Migration 2)" — spec lines 1448–1594
>    Migration header per project pattern: intent, anon visibility decision for `tags` (anyone reads — public taxonomy) and `event_tags` (anyone reads for published events; admins write), and a note that this migration is paired with Migration 3 (apply both in sequence).
>
> 2. `supabase/migrations/<timestamp+1>_migrate_user_interests_to_tag_id.sql` — Migration 3.
>    Body assembles the SQL fragments verbatim from spec section:
>    - "user_interests schema change (Migration 3)" — spec lines 1595–1631
>    Migration header: intent (re-point `user_interests` from free `text` to `tag_id` FK), the reconciliation strategy (Decision 9 map applied via SQL `CASE`), and explicit note that the legacy `interest` text column is **kept** until follow-up F2 — this is intentional belt-and-braces in case the reconciliation needs auditing post-merge.
>
> **Migration 2 specifics that need extra care:**
> - The 23-tag seed must match Decision 4's table exactly. Slug = canonical, label = display, sort_order = the 10–230 sequence specified, `is_primary_eligible` reflects whether the tag is in the 15 primary list.
> - The per-event backfill CASE (Decision 9 + the architect's update) is **complete** — every one of the 33 seed events has a primary tag mapping, and the multi-tagged events (e.g. Halloween Party = primary nightlife-dancing + secondaries festivals-seasonal + themed-socials) have the secondary INSERTs alongside.
> - The bidirectional sync trigger is recursion-safe (uses `pg_trigger_depth() = 1` guard or equivalent — refer to spec).
> - The partial unique index `WHERE is_primary = true` enforces "exactly one primary tag per event" at the DB layer.
>
> **Migration 3 specifics that need extra care:**
> - Add `user_interests.tag_id uuid` as **nullable** first.
> - Backfill via SQL `CASE` covering all 14 historic `INTEREST_OPTIONS` values (see Decision 9). The `CASE` may not catch unexpected legacy values — the migration must include a defensive `SELECT count(*) FROM user_interests WHERE tag_id IS NULL` check that fails the migration if any rows are unmapped.
> - Once verified non-null everywhere, ALTER COLUMN to NOT NULL and add the FK constraint to `tags(id)`.
> - Replace the existing unique constraint `uq_user_interests_user_interest (user_id, interest)` with a new one `uq_user_interests_user_tag (user_id, tag_id)`. Both can co-exist briefly during migration.
> - The legacy `interest` text column **stays in place** — F2 drops it later. This is intentional rollback insurance.
>
> **Out of scope (do NOT touch in this PR):**
> - Any source files (`src/`) — no app code changes. Old read-paths still see `events.category` (kept in sync by the trigger). Old read-paths still see `user_interests.interest` (kept by Migration 3 not dropping it).
> - Migration 4 (drop enum). That's F1, held for later.
> - F2 (drop `user_interests.interest`). Held for later.
> - Tests — Tester (W4) writes those.
> - Admin EventForm / banner UI changes. That's W5.
> - Seed file (`supabase/seed.sql`) — no need to update. The seed runs the new migrations automatically and the per-event backfill CASE handles the existing seeded rows.
>
> **Verification before reporting done:**
> - `pnpm tsc --noEmit` clean
> - `pnpm lint` no new errors
> - `pnpm build` succeeds
> - `pnpm vitest run` 1188+ passing (no regressions — old code paths still work because the trigger keeps `events.category` synced)
> - Local migration apply: `supabase db reset` then run both migrations. Confirm:
>   - `select count(*) from tags` returns 23
>   - `select count(*) from event_tags where is_primary` equals `select count(*) from events where deleted_at is null` (every event has exactly one primary)
>   - `select count(*) from event_tags where not is_primary` is at least 16 (the multi-tagged events from the spec backfill)
>   - `select count(*) from user_interests where tag_id is null` is 0
>   - The bidirectional trigger: `update events set category = 'drinks' where id = '<some-event-id>'` updates `event_tags.is_primary` to point at the `drinks-bars` tag without recursing; same in reverse via `update event_tags set is_primary = true where ...`.
>   - The partial unique index: try inserting a second `is_primary = true` row for an event — must fail with unique violation.
>
> **Branch + PR:**
> - Branch from `main`: `git checkout main && git pull --ff-only && git checkout -b feat/member-data-layer-w2-w3-tags-taxonomy`
> - Two commits OK (one per migration), or one combined commit titled `feat(taxonomy): migrations 2 + 3 — canonical tags + user_interests reconciliation`
> - PR title: `feat(taxonomy): canonical tags + event_tags + user_interests reconciliation (W2+W3)`
> - PR body must include: link to spec; the 23-tag seed list (full table); the per-event backfill table from Decision 9; verification checklist results; explicit note that `events.category` enum is kept in sync via trigger and dropped only in F1.
>
> **Hard rules:**
> - No `supabase db reset` against hosted.
> - Do not drop `events.category` enum in this PR — that's F1, held until app code migrates off.
> - Do not drop `user_interests.interest` text column in this PR — that's F2.
> - If the per-event backfill CASE is missing any of the 33 seed events, STOP and report — do not silently default to a fallback tag.
> - Defensive checks (e.g. the `tag_id IS NULL` zero-row assertion in Migration 3) must be `RAISE EXCEPTION` failures, not warnings — the migration should refuse to apply if data is inconsistent.

---

## Spec sections this prompt depends on (for the agent's quick reference)

- Decision 3 (`tags` table shape) — spec lines 178–232
- Decision 4 (canonical seed list — 23 tags) — spec lines 233–369
- Decision 5 (drop or keep `events.category` strategy) — spec lines 370–459
- Decision 6 (primary-uniqueness constraint) — spec lines 460–511
- Decision 8 (migration sequence — M2+M3 sub-sections) — spec lines 735–914
- Decision 9 (reconciliation map + per-event backfill) — spec lines 915–1031
- SQL fragment "New tables (Migration 2)" — spec lines 1165–1221
- SQL fragment "Tag seed insert (Migration 2)" — spec lines 1222–1260
- SQL fragment "Event-tags backfill (Migration 2)" — spec lines 1261–1447
- SQL fragment "Bidirectional sync trigger (Migration 2)" — spec lines 1448–1594
- SQL fragment "user_interests schema change (Migration 3)" — spec lines 1595–1631

## After W2+W3 lands

W4 (Tester) is the next agent for the implementation portion. W5 (Frontend) can start in parallel on its own branch — it depends on these migrations being IN main, not necessarily the tester pass.
