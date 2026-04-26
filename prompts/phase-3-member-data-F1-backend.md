# F1 — Backend: Migration 4 (drop `events.category` enum) — HELD

**Status:** ⏸️ HELD until app code has fully migrated off `events.category` reads.

**Agent (when ready):** `/project:backend-developer`
**Depends on:** every read-path consumer of `events.category` migrated to `event_tags`. Verify by `grep -rn "events.category\|event\.category\|\.category" src/` returning zero hits in production code paths.
**Branch (when ready):** `feat/member-data-layer-f1-drop-category-enum` from main.

---

## Why this is held

Migration 2's bidirectional sync trigger keeps `events.category` populated for legacy reads. Until every consumer migrates to read from `event_tags` (filtered by `is_primary = true`), dropping the enum / column would break the app at runtime. F1 ships only after all such consumers are gone.

**How to know it's safe to ship F1:**

1. `grep -rn "events.category\|event\.category" src/` returns zero matches in production code (test files / migrations may reference it; that's fine).
2. `grep -rn "EventCategory\b\|event_category" src/` confirms the TS enum + column reference is also gone (or only present in legacy types).
3. Search Server Actions for any `.select('category')` or `.eq('category', ...)` against the events table. All gone.
4. Search the events listing / filter UI — no `categoryFilter` state, no `?category=` URL params, no `<CategoryTag>` component reading from `event.category`.

If any of those return hits, F1 stays held. The frontend-developer / backend-developer wave that migrates those consumers ships first; F1 ships in a release after.

---

## Prompt to paste into the agent (when ready)

> Read `CLAUDE.md`, `social-seen-safety-SKILL.md`, and `docs/member-data-layer-spec.md` (Decision 5 — drop strategy, lines 370–459 — and Decision 8 — Migration 4 sub-section). Verify the four "how to know it's safe" checks listed in the F1 prompt file head matter return zero hits before proceeding.
>
> **Goal:** Migration 4 — drop the bidirectional sync trigger and its supporting functions, drop `events.category`, drop the `event_category` enum type. Net result: `event_tags` becomes the sole source of truth.
>
> **In scope (one migration file):**
>
> `supabase/migrations/<timestamp>_drop_events_category_enum.sql`. Body:
> 1. Drop the bidirectional sync triggers (both directions) from Migration 2.
> 2. Drop the trigger functions.
> 3. ALTER TABLE events DROP COLUMN category.
> 4. DROP TYPE public.event_category.
> 5. Update any leftover references in views, RLS policies, or check constraints. (Per spec, there shouldn't be any — but verify with `\d events` after step 3 in a local apply.)
>
> Migration header: intent (collapse the dual-source-of-truth back to single source via `event_tags`); confirmation that pre-flight check passed (paste the grep results showing zero consumers in src/); explicit reference to spec Decision 5.
>
> **Out of scope:**
> - Any source files. The whole point is that source files don't read `events.category` anymore.
> - F2 (`user_interests.interest` text column drop) — separate follow-up.
>
> **Verification before reporting done:**
> - `pnpm tsc --noEmit` — must be clean. If any source file references `events.category` it will fail to compile here.
> - `pnpm lint` — no new errors.
> - `pnpm build` — succeeds.
> - `pnpm vitest run` — 100% passing. The W4 tester migration tests should still pass; if any test was asserting the trigger's existence, those need updating.
> - Local migration apply: `supabase db reset` then up; confirm `\d events` shows no `category` column and `\dT` shows no `event_category` enum.
> - Spot check: existing event-listing pages render correctly using `event_tags` only (i.e. the migration didn't accidentally remove a column some component still reads).
>
> **Branch + PR:**
> - Branch from main: `git checkout main && git pull --ff-only && git checkout -b feat/member-data-layer-f1-drop-category-enum`
> - One commit: `feat(taxonomy): F1 — drop events.category enum + bidirectional triggers`
> - PR body: confirm pre-flight check results (the grep zero-hit evidence); link to spec Decision 5; flag this PR as the **final cleanup** of the Member Data Layer build.
>
> **Hard rules:**
> - Do NOT skip the pre-flight check. If `events.category` is still referenced anywhere in production code, this migration will break runtime.
> - Do NOT bundle F2 (drop `user_interests.interest` text column) into this PR. Separate releases.
> - The migration must be reversible only by restoring from backup — there's no clean "undo drop column". This is a one-way move.

---

## Spec sections this prompt depends on (when ready)

- Decision 5 (drop strategy) — spec lines 370–459
- Decision 8 (Migration 4 intent sub-section) — spec lines 735–914

## After F1 lands

F2 (`drop_user_interests_interest_text`) becomes the next candidate for cleanup. Same shape: held until all consumers of `user_interests.interest` migrate to `tag_id`. Mirror this prompt's structure when F2 is ready to write.

---

## How to know F1 is ready to dispatch

When the answer to all four pre-flight `grep`s is zero, ping the planner. The planner re-confirms timing relative to any in-flight PRs and gives the green light. Until then, this file sits in `prompts/` as a reminder.
