# Member Data Layer — Schema Specification

**Status:** Draft for product-owner review
**Author:** /project:architect
**Date:** 2026-04-26
**Branch:** `feat/member-data-layer-spec`
**Source backlog item:** [docs/PHASE-3-BACKLOG.md](./PHASE-3-BACKLOG.md) → "Member-data layer (demographics + canonical taxonomy)"

---

## 0. Purpose & scope

This spec defines the **data layer only** for three bundled schema changes:

1. **Gender** on `profiles` — nullable enum, admin-only visibility
2. **Age range** on `profiles` — banded nullable enum (no DOB)
3. **Canonical taxonomy** — replace the dual `events.category` enum + free-text
   `user_interests.interest` vocabulary with a single `tags` lookup table
   plus `event_tags` join

**Explicitly out of scope** (separate later work, do not design here):

- Recommendation engine ("events you might like")
- Event-mix balancing logic (admin caps, soft warnings, automated enforcement)
- Email targeting / segmentation by tag overlap
- Search-by-tag UI
- Hierarchy on tags (deferred — see §3)
- Frontend UI for collecting demographics (the "Complete Your Profile" banner
  is a separate frontend-developer task; this spec only defines what fields
  exist and how they're stored)

**The contract:** a backend developer should be able to write four migrations
straight from this spec without further architectural input. A frontend
developer should be able to wire admin forms and the profile-completion banner
straight from §1, §2, and the Reconciliation Map.

---

## Current state — what exists today

For grounding, the following are the moving parts this spec touches:

| Object | Today | Migration ref |
|---|---|---|
| `event_category` enum | 9 values: `drinks, dining, cultural, wellness, sport, workshops, music, networking, activity` | `20260402000001`, `20260406000001` |
| `events.category` | NOT NULL `event_category` column | `20260402000003` |
| `user_interests` | `(id, user_id, interest TEXT, created_at)` with UNIQUE(user_id, interest) | `20260402000009` |
| `INTEREST_OPTIONS` | 14 free-text strings in `src/lib/constants.ts` | code only — **not enforced by DB** |
| `profiles` anon GRANT | Narrow allow-list — id, full_name, avatar_url, job_title, company, industry, bio, linkedin_url, role, status, created_at | `20260427000001` |

**Seed-data observation** (run on current `main`):

```
event categories actually used in seed:
  10 drinks
   8 cultural
   7 sport
   5 dining
   3 music
```

`wellness`, `workshops`, `networking`, `activity` are defined in the enum but
have zero seed events. This shapes the §4 reconciliation map: the canonical
list cannot drop categories that are enum-valid even if the seed doesn't use
them — admins may have draft events with those categories, and existing user
interests reference some of them.

---

## The 10 decisions

### Decision 1 — Gender enum values

**Decision:** Use the four-value enum exactly as proposed.

```sql
CREATE TYPE gender AS ENUM (
  'female',
  'male',
  'non_binary',
  'prefer_not_to_say'
);
```

(Underscore in `non_binary` rather than hyphen — Postgres enum values are
case-sensitive identifiers and underscores are friendlier to TypeScript
codegen than hyphens. UI label is `"Non-binary"`.)

**Rationale:**

- **Why an enum and not free text:** event-mix balancing (the downstream
  consumer that justifies collecting this) needs categorical aggregation. Free
  text would force string-normalisation on every query and prevent a stable
  RLS-able schema.
- **Why these four values:** the four-bucket shape is the dominant pattern in
  UK survey design (ONS, GOV.UK service standard) for a self-declared gender
  field where the operational use is balancing/representation rather than
  medical research. `prefer_not_to_say` is a first-class option (not "null"
  by another name) so we can distinguish "actively declined" from "hasn't
  filled it in yet" — the latter is `NULL`.
- **Why not five values (adding `self_describe` + a free-text "other" field):**
  for a London-30s/40s-professional product where the lawful basis is
  legitimate interest in event-mix balancing, the four-bucket form is enough.
  Adding a free-text follow-up has GDPR consequences (special-category data
  in some readings) and adds admin-form complexity for a use case that
  doesn't yet exist. Revisit if the community asks for it.
- **Why `prefer_not_to_say` rather than just `NULL`:** lets us tell apart
  "user opened the form and chose not to disclose" (treat as private but
  intentional) from "user has never seen the form" (still nudge them).
  Operationally this matters for the "Complete Your Profile" banner — it
  should *not* re-nudge someone who has explicitly declined.

**Storage:** column `profiles.gender gender NULL`. No default. NULL = not yet
asked or skipped without engaging.

---

### Decision 2 — Age range bands

**Decision:** Use the proposed seven-band enum, adjusted to add an `under_18`
guardrail-bucket the form will never offer (so the enum stays valid if a
member self-declares wrongly via the API).

```sql
CREATE TYPE age_range AS ENUM (
  '18-24',
  '25-29',
  '30-34',
  '35-39',
  '40-44',
  '45-49',
  '50+'
);
```

(No `under_18` after all — see "Considered and rejected" below.)

**Rationale:**

- **Bands not DOB:** less invasive, less PII, sufficient for the only
  documented downstream use (event-mix balancing + positioning sanity
  checks). DOB introduces birthday handling, age recalculation cron, and a
  more sensitive PII category. Bands are a deliberate downgrade.
- **Why these seven bands:** the product positioning is "London professionals
  in their 30s and 40s." The 5-year buckets across the 25–49 range give the
  resolution needed for that core demographic — useful for spotting "we've
  drifted to a 35–44 product" vs "still balanced 30s/40s." `18-24` exists
  because the membership rules don't formally exclude it (rare edge case —
  early-career members brought by a colleague). `50+` is intentionally
  open-ended; finer resolution above 50 has no operational use today and
  collecting it would feel pointed.
- **Why not narrower bands (e.g. 30-32, 33-35):** crosses the line from
  "balancing signal" to "demographic profiling" without a corresponding
  product use. Members would notice and find it intrusive.
- **Why not wider bands (e.g. 30-40, 40-50):** loses the only resolution
  worth collecting — telling apart "early 30s" vs "late 30s" attendance
  patterns, which is exactly the boundary the product positions on.
- **Why no DOB-derived computed column for forward-compat:** explicitly
  declining the option to store DOB anywhere. If we later need exact age,
  we'd ask for it on a separate consent.

**Considered and rejected:**

- **`under_18`:** the registration flow already gates 18+ via the existing
  age-confirmation checkbox at signup (P2-2). Adding `under_18` to the enum
  invites bad-shape values into the column. If a member misconfigures, the
  form should reject the submission, not store it. Out of the enum.
- **`prefer_not_to_say`:** for age range this is what `NULL` already means.
  Unlike gender, where `prefer_not_to_say` carries social signal worth
  preserving distinctly, age range either is or isn't disclosed — leaving
  it `NULL` covers both "skipped" and "declined." A separate enum value
  would be ceremony for no operational gain.

**Storage:** column `profiles.age_range age_range NULL`. No default.

---

### Decision 3 — `tags` table shape

**Decision:** Include `parent_id` as a nullable column from day one.

```sql
CREATE TABLE public.tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  label       text NOT NULL,
  parent_id   uuid REFERENCES public.tags(id) ON DELETE SET NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tags_parent ON public.tags(parent_id);
CREATE INDEX idx_tags_active_sort ON public.tags(is_active, sort_order);
```

**Rationale:**

- **Why include `parent_id` even though hierarchy is out of scope:**
  - The cost is a single nullable FK column + one index — close to nothing.
  - The cost of *adding* it later is a migration, a backfill, and a
    coordination point with whatever code already uses the table. With ~14
    tags and a future where "Wine & Cocktails" might want to live under
    "Drinks" — or "Yoga & Wellness" + "Running & Sport" might want to live
    under "Active" — it's a near-certainty we'll regret omitting it.
  - It does **not** introduce hierarchy semantics into queries — without a
    population in `parent_id`, every existing query sees a flat list. The
    column simply exists, all values are `NULL`, no current consumer cares.
- **Why `ON DELETE SET NULL` and not `RESTRICT`:** if a parent tag is later
  deleted, child tags should become orphans (root-level), not block the
  delete. Tag deletion is admin-only and rare; the parent disappearing is
  always intentional reorganisation.
- **Why `is_active` rather than soft-delete `deleted_at`:** taxonomy isn't
  user-generated content. Tags get retired and reactivated by admins; that's
  a curation operation, not a user-data deletion. `is_active = false` hides a
  tag from admin pickers and member-facing UIs but keeps the row so existing
  `event_tags` rows stay valid (and the backfill audit trail is preserved).
- **Why `sort_order` as an integer, not alphabetical:** event-card UI
  ordering matters editorially. "Drinks" should come before "Workshops" by
  product preference, not by alphabet. Stored ordering keeps the admin UI
  simple — drag-to-reorder maps to integer renumbering.
- **Why no `description`:** YAGNI. Add when a use surfaces (e.g. tooltip on
  the interests picker). One column added later is cheaper than carrying an
  empty one now.

**Slug constraints:** `lower-kebab-case`, e.g. `wine-cocktails`. The DB has
no CHECK on this — admin form layer enforces it. Adding a CHECK constraint
that breaks future i18n would be premature.

---

### Decision 4 — Seed list for tags (canonical reconciliation)

**Decision:** A single 16-tag canonical list. See "Canonical seed list"
section below for the table.

The reconciliation work:

| Source list | Members |
|---|---|
| `event_category` enum | 9 values |
| `INTEREST_OPTIONS` (free text) | 14 values |
| **Canonical tags** | **16 values** |

Two of the 14 interest values map cleanly to existing event categories
(`Networking` → category `networking`; sort of `Yoga & Wellness` → category
`wellness`, but see Reconciliation Map for the nuance). The rest don't have
1:1 event peers; the spec keeps them all because:

- They're already chosen by members in the seed and live behaviour — dropping
  them silently would erase user signal.
- They're plausible future event categories ("Photography" walks, "Travel"
  trip-planning meetups, "Books & Literature" supper club) — keeping them as
  *interests-only* (`is_primary_eligible = false`) is the cheapest forward
  path.

**Canonical seed list:**

| slug | label | sort_order | is_primary_eligible | Notes |
|---|---|---|---|---|
| `drinks` | Drinks | 10 | yes | Direct from event enum + maps `Wine & Cocktails` interest |
| `dining` | Dining | 20 | yes | Direct from event enum + maps `Fine Dining` interest |
| `cultural` | Cultural | 30 | yes | Direct from event enum + maps `Art & Culture` interest |
| `wellness` | Wellness | 40 | yes | Direct from event enum + maps `Yoga & Wellness` interest |
| `sport` | Sport | 50 | yes | Direct from event enum + maps `Running & Sport` interest |
| `workshops` | Workshops | 60 | yes | Direct from event enum |
| `music` | Music | 70 | yes | Direct from event enum + maps `Jazz & Music` interest |
| `networking` | Networking | 80 | yes | Direct from event enum + matches identical interest value |
| `activity` | Activity | 90 | yes | Direct from event enum (added in `20260406000001`) |
| `technology` | Technology | 100 | yes | Promoted from interest-only — admins regularly run tech-meetup events; making it primary-eligible unblocks that |
| `entrepreneurship` | Entrepreneurship | 110 | yes | Same rationale as `technology` — there is a known pipeline of founder-circle events |
| `photography` | Photography | 120 | no | Interest-only. No current event uses this; admins can promote later by flipping `is_primary_eligible` |
| `travel` | Travel | 130 | no | Interest-only. Future trips/travel meetups would promote this |
| `books-literature` | Books & Literature | 140 | no | Interest-only. Future supper clubs / book-club events could promote |
| `sustainable-living` | Sustainable Living | 150 | no | Interest-only |
| `film-cinema` | Film & Cinema | 160 | no | Interest-only |

**Items dropped or merged:**

- None dropped. All 9 event categories survive (with the two-letter merges
  noted in §10 Reconciliation Map). All 14 interest values survive (some as
  primary-eligible promotions, the rest as interest-only).

**Note on `is_primary_eligible`:** this is a **business rule encoded in
seed/admin UI**, not a column on the `tags` table. Adding it as a column
would couple the taxonomy table to the events use case (interest-only members
also need this list — they don't care about primary-eligibility). The column
is documented as a **constant** in `src/lib/constants.ts` and read by the
admin event-creation form; the DB enforces "exactly one primary per event"
via Decision 6. If future use expands (e.g. user-facing tag picker also wants
to filter by "events bookable in this tag"), the column is one ALTER away.

**This is item 1 in §"Questions for the product owner"** — the
primary-eligibility column for `technology` and `entrepreneurship` was a
judgment call.

---

### Decision 5 — Drop or keep `events.category` enum?

**Decision:** **Keep as-is** (Option C in the prompt — dual writes) for
**migrations 1–3**, then **drop in migration 4** (deferrable, but planned).

Motivation: option A (drop entirely) is the right end-state, but doing it in
the same migration set as the schema change introduces a coordination
problem — every page, query, server action, type, and seed reference using
`events.category` has to flip in lockstep. Dual-write windows are risky in
isolation but very safe when they're explicit and time-bounded.

**The path:**

1. **Migrations 2 + 3:** introduce `tags` and `event_tags`. Backfill
   `event_tags` with one primary tag per existing event, derived from
   `events.category`. Add a trigger that keeps `events.category` and the
   primary `event_tags` row in sync (writes to either side propagate). All
   existing `category` queries continue to work unchanged.
2. **Follow-up release** (after the application code has migrated to query
   `event_tags` for the primary tag): **migration 4** drops the trigger,
   drops the `category` column, and drops the `event_category` enum. Until
   that release ships, dual-writes remain in place.

**Why not Option A (drop in migration 2):**

- Forces every consumer to flip simultaneously. The current codebase has
  ~20+ files referencing `events.category` (filters page, event card,
  detail page, admin form, JSON-LD, type system). That's a "no parallel work
  on `events`" lockout for the duration of the migration.
- Forecloses the rollback path. If migration 2 ships and the new
  `event_tags` flow has a bug, "revert" with no `category` column means the
  rollback ships an unusable build.

**Why not Option B (generated/computed column):**

- Postgres generated columns can derive from other columns in the same row,
  not from joined data. Making `events.category` a generated column derived
  from `event_tags` is technically possible only via a SECURITY DEFINER
  function — which means RLS bypass to read tag data, query-plan opacity,
  and a second source of truth that's *almost* canonical. Dual writes are
  more honest about what's happening.

**Why C is acceptable as the interim state:**

- A trigger on `event_tags` (UPDATE/INSERT WHERE is_primary = true) writes
  the new primary tag's slug back to `events.category`. A trigger on
  `events` (UPDATE OF category) writes through to `event_tags`. Both are
  short, idempotent, and safe under concurrent writes (event admin actions
  are sequenced; a primary-tag flip and a category edit racing each other
  is a UI bug, not a data integrity bug — last-writer-wins is fine).
- The window is short (one release cycle).

**Migration 4 plan:** runs after the application code is fully migrated and
no consumer reads `events.category`. The migration drops the trigger first
(so writes don't try to propagate to a column being removed), then `ALTER
TABLE events DROP COLUMN category`, then `DROP TYPE event_category`.

**Caveat for the backend developer:** the trigger that keeps `events.category`
and `event_tags` in sync needs to handle the case where a primary tag's slug
doesn't exist as an enum value. Migration 2's seed list deliberately keeps
the enum-mapped slugs (`drinks`, `dining`, etc.) identical to the enum's
existing values. New tags promoted to `is_primary_eligible = true` after
migration 2 (e.g. `technology`, `entrepreneurship`) need to be added to the
`event_category` enum *first* (one-statement enum add, no rewrite), or the
trigger raises. The cleanest sequencing: migration 2 also adds `technology`
and `entrepreneurship` to the enum so the seed `event_tags` backfill
doesn't need a special case.

---

### Decision 6 — "Exactly one primary tag per event" enforcement

**Decision:** **Partial unique index.**

```sql
CREATE UNIQUE INDEX uq_event_tags_one_primary
  ON public.event_tags (event_id)
  WHERE is_primary = true;
```

**Rationale:**

- **Why partial unique index:** declarative, fast (no row-by-row trigger
  overhead), and matches Postgres's idiomatic way of saying "at most one row
  satisfying X per event_id." The semantics are exact: at most one row with
  `is_primary = true` per event.
- **Why not a CHECK constraint:** CHECK can't reference other rows. Would
  require a subquery, which Postgres rejects in CHECK.
- **Why not a trigger:** triggers fire per-row on INSERT/UPDATE, are
  invisible in `\d table` introspection, and require extra care under
  concurrent writes (you'd need a serializable transaction or `SELECT FOR
  UPDATE` to make it safe). The partial unique index is enforced at the
  storage layer with no race.
- **Caveat — "at most one" vs "exactly one":** the partial unique index
  enforces *at most one*. Enforcing *exactly one* (every event must have a
  primary) is a separate problem — best handled at the application layer
  (Server Action that adds an event also requires one tag with
  `is_primary = true`) plus a NOT VALID CHECK that gets validated after
  the migration backfill completes. For Migration 2, the application is the
  enforcement point for new events; the backfill guarantees existing events
  all get exactly one.

**Application-layer companion rule** (for the backend-developer to encode in
the events Server Action):

> When inserting or updating an event, the action must insert at least one
> `event_tags` row with `is_primary = true`. Attempting to set `is_primary =
> true` on a second row for the same event raises a unique-constraint
> violation that should be surfaced as a UX-friendly error ("An event can
> only have one primary tag — change the existing primary first").

**Behavioural notes:**

- Setting an existing primary to non-primary, then setting a different tag
  to primary, must happen in the right order. The Server Action should
  use a transaction: clear the old primary first, then set the new.
- Deleting the primary `event_tags` row leaves the event with zero primary
  tags. The Server Action must reject "delete primary without replacement."
  This is application-level — the partial unique index can't enforce it.

---

### Decision 7 — RLS policies for the new tables

#### `tags` — public taxonomy, admin write

```sql
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

-- Anyone can read active tags. Inactive tags are admin-only (so member-
-- facing pickers don't accidentally show a retired tag).
CREATE POLICY "tags_select_active"
  ON public.tags FOR SELECT
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "tags_insert_admin"
  ON public.tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "tags_update_admin"
  ON public.tags FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Soft retirement via is_active = false; no DELETE policy.
```

**Schema-level GRANT** (this table needs to be visible to anon for the
landing-page event filters; it's pure public taxonomy):

```sql
GRANT SELECT ON public.tags TO anon, authenticated;
```

#### `event_tags` — public for published events, admin write

```sql
ALTER TABLE public.event_tags ENABLE ROW LEVEL SECURITY;

-- Anyone can read tag rows for published, non-deleted events.
-- For draft/deleted events, only admins.
CREATE POLICY "event_tags_select"
  ON public.event_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_tags.event_id
        AND e.deleted_at IS NULL
        AND (
          e.is_published = true
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
          )
        )
    )
  );

CREATE POLICY "event_tags_insert_admin"
  ON public.event_tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "event_tags_update_admin"
  ON public.event_tags FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "event_tags_delete_admin"
  ON public.event_tags FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

**Schema-level GRANT:**

```sql
GRANT SELECT ON public.event_tags TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_tags TO authenticated;
-- (RLS gates writes to admins only.)
```

**Note on the SELECT policy subquery:** it includes a join into `events` for
the `is_published` + `deleted_at` filter. This is one lookup per row, but the
`events_publish_status_idx` (existing on `idx_events_published`) covers it,
and `event_tags.event_id` is indexed via the join's PK lookup. Should be a
sub-millisecond cost on the queries that matter (events listing).

#### `profiles.gender` and `profiles.age_range` — column-level GRANT decision

Per CLAUDE.md's "anon-visibility decision" rule (established in
`20260420000003_harden_profiles_pii_access_fix.sql`, tightened in
`20260427000001_tighten_profiles_anon_grant.sql`): the secure-by-default
posture is **omit new columns from the anon GRANT**.

**Decision:** `gender` and `age_range` **MUST NOT** be added to the anon
SELECT GRANT. They are also **not** added to the authenticated SELECT GRANT
in any narrowed form — the existing `GRANT SELECT ON public.profiles TO
authenticated` is broad. The visibility model relies on:

1. **Anon:** can't see these columns at all (no GRANT). REST queries
   requesting them fail with `code: 42501` (permission denied).
2. **Authenticated non-admin members:** *can* technically SELECT these
   columns over the REST API today (because `authenticated` has broad
   table-level SELECT), but the existing RLS policy (`profiles_select USING
   (true)`) is what makes profile rows visible across users. That policy is
   pre-existing and intentional (the community is "public").

**This creates a problem:** today, a logged-in member could `select
gender, age_range from profiles where id = '<other-member-id>'` and see
another member's demographics. That's a privacy regression vs the spec's
intent ("admin-only visibility").

**Resolution — two options for the backend-developer:**

**Option A (recommended):** narrow `authenticated`'s grant to a column list,
mirroring the anon pattern. This requires REVOKE + re-GRANT and is a
follow-on PII-hardening migration that should ship in the **same Migration
1** as the gender/age_range columns.

```sql
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  -- existing visible columns (mirrors anon list + the auth-private fields)
  id, email, full_name, avatar_url, job_title, company, industry, bio,
  linkedin_url, role, onboarding_complete, referral_source, status,
  phone_number, email_consent, email_verified, created_at, updated_at,
  deleted_at,
  -- columns added by 20260423000002, 20260426000001, 20260428000001,
  -- 20260429000001 (audit / nudge / notification prefs / sms_consent) —
  -- backend-developer to enumerate the actual current set when writing
  -- the migration; this spec lists the principle, not the snapshot.
  -- NB: gender + age_range are DELIBERATELY OMITTED from this list.
) ON public.profiles TO authenticated;
```

Then **own-row read** of these new columns is exposed through a SECURITY
DEFINER function:

```sql
CREATE OR REPLACE FUNCTION public.get_my_demographics()
RETURNS TABLE (gender public.gender, age_range public.age_range)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT gender, age_range FROM public.profiles WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_demographics() TO authenticated;
```

And **admin reads** (for admin demographics views) go through a separate
SECURITY DEFINER function gated on admin role:

```sql
CREATE OR REPLACE FUNCTION public.admin_get_demographics(target_user_id uuid)
RETURNS TABLE (gender public.gender, age_range public.age_range)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT gender, age_range
    FROM public.profiles WHERE id = target_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_demographics(uuid) TO authenticated;
```

**Option B (less safe, faster):** rely on application-layer gating (the
profile query in `src/lib/supabase/queries/profile.ts` doesn't SELECT
`gender` or `age_range` for non-self/non-admin reads). Document the rule;
trust the codebase to comply. This is the pattern the codebase uses today
for `phone_number` (the Phase 3 backlog flags it as "blocks the
profile-browser feature if/when it ships").

**Recommendation:** **Option A.** The product is collecting these fields
specifically so admins can do balancing analysis, and giving every
authenticated member SELECT on every other member's demographics is a
direct contradiction of the consent text the user agrees to ("only visible
to the team"). The cost of doing it right at migration time is small; the
cost of retrofitting after a member discovers it via the REST endpoint and
asks a journalist is large.

**This is item 2 in §"Questions for the product owner"** (Option A vs B).

#### `user_interests` — existing RLS stays

No change. The schema change (text → tag_id FK) doesn't change the visibility
model. The existing four policies (`select`, `insert`, `update`, `delete` —
all gated on `user_id = auth.uid()` or admin) carry over unchanged.

The only schema-side change to RLS is updating the SELECT policy if the
query needs to join through `tags` for the slug — but that's just selecting
through a public-readable table, no policy change required.

---

### Decision 8 — Migration sequence and intent

**Migration 1 — `add_profile_demographics`**

- **Intent:** Add `gender` enum, `age_range` enum, `profiles.gender` column,
  `profiles.age_range` column. Re-narrow the `authenticated` GRANT on
  `profiles` to a column list that excludes the two new columns (Option A in
  Decision 7). Add the two SECURITY DEFINER functions for own-row + admin
  reads.
- **Safety:**
  - Both columns are nullable with no default → no table rewrite, no lock
    on the existing rows. Concurrent reads/writes unaffected.
  - The REVOKE+GRANT is fast (catalog-only, no row-level work). It does
    introduce a tiny window where SELECT permission is briefly absent from
    `authenticated`; wrap REVOKE+GRANT in a single transaction so it's
    atomic from any concurrent session's view.
  - The SECURITY DEFINER functions need `SET search_path = public` to
    prevent search-path injection attacks (this is a Supabase-recommended
    pattern; mirrors `handle_new_user` in `20260402000002`).
  - The `handle_new_user` trigger does **not** need updating — new accounts
    start with NULL for both columns, which is correct (the
    "Complete Your Profile" banner collects them post-signup).
- **Application-side coupling:** none in this migration. The `Profile` type
  in `src/types/index.ts` gets two new optional fields; queries that read
  the profile via `getProfile()` need to either include the new SECURITY
  DEFINER call or extend their SELECT to the new columns (which only works
  for own-row reads after Option A). The frontend-developer wires the
  banner UI in a separate batch.
- **Rollback:** trivial — drop the two columns, drop the two functions,
  restore the prior GRANT. No data loss because no data has been written
  yet.

**Migration 2 — `create_tags_and_event_tags`**

- **Intent:** Create `tags` table with full schema (including `parent_id`
  nullable). Create `event_tags(event_id, tag_id, is_primary)` join with
  partial unique index for primary uniqueness. Add `technology` +
  `entrepreneurship` values to the existing `event_category` enum so the
  trigger doesn't fail when those slugs become primary. Seed `tags` with the
  16-row canonical list. Backfill `event_tags` with one primary row per
  existing event (mapping from `events.category`). Install the
  bidirectional sync trigger between `events.category` and primary
  `event_tags`. RLS policies + GRANTs as Decision 7.
- **Safety:**
  - Creating `tags` and `event_tags` is additive — zero impact on any
    existing query.
  - Adding enum values: `ALTER TYPE … ADD VALUE` is a single-row catalog
    change. **Caveat:** in Postgres < 12, ADD VALUE inside a transaction
    is restricted; in Supabase (current Postgres 15+) the restriction is
    lifted, but the ADD VALUE statement still cannot be rolled back inside
    the same transaction as a use of the new value. Backend-developer
    note: run the ADD VALUE statements as their own statements (not in a
    DO block with the seed insert). The migration file structure is:
    `(1) ADD VALUE` → `(2) INSERT into tags` → `(3) INSERT into
    event_tags` → `(4) CREATE TRIGGER`.
  - Backfilling `event_tags`: one INSERT per event with a SELECT join to
    `tags` on slug. With ~50 events this is fast; even at 50K it's seconds.
    The partial unique index is created *after* the backfill (or as the
    last step before sync trigger install) so the backfill's "exactly one
    primary per event" property is verifiable.
  - The bidirectional trigger needs to be **idempotent and re-entry-safe** —
    if updating `events.category` fires the events-side trigger which
    writes to `event_tags` which fires the event_tags-side trigger which
    writes back to `events.category`, you have an infinite loop. The
    backend-developer must implement a `pg_trigger_depth()` check or set a
    session-local guard variable to break the cycle.
  - Default values: `event_tags.is_primary` defaults to `false`. The
    backfill explicitly sets `is_primary = true` for every event.
  - RLS enabled before any INSERT (Postgres allows INSERTs during
    migrations as the `postgres` role which bypasses RLS, so the seed
    inserts work; but the policies are in place before any session
    operates on the tables).
- **Application-side coupling:** none required immediately — the
  bidirectional trigger means existing `events.category` queries continue
  to work. The frontend-developer adds a tag picker to the admin event form
  in a separate batch; until then, admins still set `category` via the
  current dropdown and the trigger updates `event_tags`.
- **Rollback:** drop the trigger first, drop `event_tags`, drop `tags`,
  remove the two enum values (NB: removing enum values requires CREATE TYPE
  + ALTER COLUMN dance — practically irreversible for a migration that's
  shipped). Realistically, "rollback" of migration 2 is a forward fix, not
  a revert. Backend-developer should treat the enum additions as one-way.

**Migration 3 — `migrate_user_interests_to_tag_id`**

- **Intent:** Add `tag_id uuid REFERENCES public.tags(id)` column to
  `user_interests`, nullable initially. Backfill `tag_id` from existing
  `interest` text via the §"Reconciliation Map" lookup. Add the
  NOT NULL constraint after backfill verifies no nulls remain. Add the
  ON DELETE constraint (`ON DELETE CASCADE` — if a tag is deleted, the
  user-interests row goes with it; the alternative is `ON DELETE SET NULL`
  + a trigger to soft-delete, which is overkill for taxonomy that's
  admin-curated). Replace the existing UNIQUE(user_id, interest) with a
  new UNIQUE(user_id, tag_id) constraint. Decision: **keep** the `interest`
  text column for one release as a fallback, then drop in a follow-up
  migration after the application code no longer references it.
- **Safety:**
  - Adding a nullable column: instant, no rewrite.
  - The backfill: bounded UPDATE. With ~50 user_interests rows in seed,
    trivial. At 1,000 members × ~4 interests each, still fast (~4K rows).
    The reconciliation map (§10) handles every existing INTEREST_OPTIONS
    value, so post-backfill there should be zero NULLs in `tag_id`. The
    migration includes a verification SELECT that raises if any NULLs
    remain — fail-loud, not silent.
  - "What if a member has an interest text that's not in INTEREST_OPTIONS"
    (e.g. a stale row from before the constants tightening)? The
    backfill SELECT joins on a CASE expression mapping the known 14
    values; rows that don't match map to NULL. The verification step
    raises if any NULL exists, surfacing the unmapped value — backend
    developer handles by either adding the mapping to the migration or
    deleting the orphan row with explicit acknowledgement.
  - The new UNIQUE constraint: in the same migration, after the backfill
    + NOT NULL, drop the old unique on `(user_id, interest)` and add the
    new one on `(user_id, tag_id)`. Wrap the swap in a transaction.
  - Keeping the `interest` text column: trades a tiny disk cost for a
    reversible rollback path. After one release where the application has
    stopped reading `user_interests.interest` and reads only the joined
    `tags.label`, ship a follow-up `drop_user_interests_interest_text`
    migration.
- **Application-side coupling:** the `getProfile()` query (and four other
  call sites identified in `src/app/(member)/profile/`,
  `src/app/(auth)/`, and `src/lib/supabase/queries/profile.ts`) currently
  read `user_interests.interest` as a string. After Migration 3 they
  should switch to a join (`select tag_id, tags(slug, label)`). The
  text column being kept for one release means the migration can ship
  without the application change blocking, but the application change
  must ship before Migration 3-followup drops the text column.
- **Rollback:** drop the new unique, restore the old unique, drop the
  NOT NULL on `tag_id`, drop the `tag_id` column. The text column is
  still populated, so the old query path resumes working immediately.

**Migration 4 (deferrable) — `drop_events_category_enum`**

- **Intent:** Drop the bidirectional sync trigger. Drop the `category`
  column on `events`. Drop the `event_category` enum.
- **Prerequisites:** every consumer of `events.category` has migrated to
  query `event_tags` for the primary tag's slug. The Phase 3 follow-up
  release that includes:
  - `EventCard` reads tag from `event_tags` join, not `events.category`
  - `EventFilters` filters by tag, not category
  - `EventDetail` displays tag, not category
  - JSON-LD `keywords` field uses tag slugs, not category
  - Type system: `EventCategory` type deprecated in favour of a `Tag`
    type sourced from `tags`
  - All seed data uses tags, no `events.category` writes
- **Safety:**
  - DROP COLUMN on `events` rewrites the table — for ~50 rows this is
    instant; the operation takes an ACCESS EXCLUSIVE lock briefly.
    Acceptable for an off-peak deploy.
  - DROP TYPE event_category requires no remaining users (column is
    already dropped — clean).
  - The trigger drop must happen first, before the column drop, because
    the trigger references the column.
- **Rollback:** practically irreversible without losing the new tag-only
  source of truth. Treat as one-way; the recommendation is to ship after
  one full release of stable Migration 3 use.

---

### Decision 9 — Reconciliation map for `user_interests.interest` → `tag_id`

For each of the 14 existing `INTEREST_OPTIONS` values, the canonical tag it
maps to:

| Source `interest` text | → Canonical tag slug | Source category | Notes |
|---|---|---|---|
| `Wine & Cocktails` | `drinks` | match | "Wine & Cocktails" was the interest-flavour label; `Drinks` is the broader event category. Reusing tag preserves overlap. |
| `Fine Dining` | `dining` | match | Same logic — `Dining` is the broader version. |
| `Art & Culture` | `cultural` | match | Same — `Cultural` is the event-category form. |
| `Yoga & Wellness` | `wellness` | match | Same. |
| `Running & Sport` | `sport` | match | Same. |
| `Technology` | `technology` | new primary-eligible tag | Promoted from interest-only; a future tech-meetup event uses this as primary. |
| `Entrepreneurship` | `entrepreneurship` | new primary-eligible tag | Same. |
| `Jazz & Music` | `music` | match | `Music` is broader. |
| `Networking` | `networking` | exact | Direct match. |
| `Photography` | `photography` | interest-only | Kept; future events could promote. |
| `Travel` | `travel` | interest-only | Kept; future events could promote. |
| `Books & Literature` | `books-literature` | interest-only | Kept; future supper-club events could promote. |
| `Sustainable Living` | `sustainable-living` | interest-only | Kept; future events could promote. |
| `Film & Cinema` | `film-cinema` | interest-only | Kept; future events could promote. |

**No drops, no merges of source values.** The five "interest-only" tags
(`photography`, `travel`, `books-literature`, `sustainable-living`,
`film-cinema`) preserve member signal that the current event categories
can't represent. Promoting them later is a one-row UPDATE to flip
`is_primary_eligible` (constant in code) and an enum ADD VALUE if migration
4 hasn't shipped.

**SQL fragment for the backfill** (illustrative — backend-developer
implements):

```sql
UPDATE public.user_interests ui
SET tag_id = t.id
FROM public.tags t
WHERE t.slug = CASE ui.interest
  WHEN 'Wine & Cocktails'   THEN 'drinks'
  WHEN 'Fine Dining'        THEN 'dining'
  WHEN 'Art & Culture'      THEN 'cultural'
  WHEN 'Yoga & Wellness'    THEN 'wellness'
  WHEN 'Running & Sport'    THEN 'sport'
  WHEN 'Technology'         THEN 'technology'
  WHEN 'Entrepreneurship'   THEN 'entrepreneurship'
  WHEN 'Jazz & Music'       THEN 'music'
  WHEN 'Networking'         THEN 'networking'
  WHEN 'Photography'        THEN 'photography'
  WHEN 'Travel'             THEN 'travel'
  WHEN 'Books & Literature' THEN 'books-literature'
  WHEN 'Sustainable Living' THEN 'sustainable-living'
  WHEN 'Film & Cinema'      THEN 'film-cinema'
END;

-- Verification — must return 0
SELECT count(*) FROM public.user_interests WHERE tag_id IS NULL;
```

---

### Decision 10 — Privacy policy revision

Two adjustments are needed to `src/app/privacy/page.tsx`:

**Adjustment A — "What we collect" section, "Profile details" bullet.**
Current text:

> **Profile details:** job title, company, industry, bio, LinkedIn URL,
> interests, profile photo — all optional and self-provided.

Becomes:

> **Profile details:** job title, company, industry, bio, LinkedIn URL,
> interests, profile photo — all optional and self-provided. We also collect
> two optional demographic fields (gender and age range, in five-year bands)
> if you choose to share them via the "Complete Your Profile" prompt.

**Adjustment B — new sub-section under "Why we collect it"** (or a new bullet
in the "Legitimate interests" entry). Recommended as a new sub-section for
clarity:

> **Demographic data — event-mix balancing**
>
> If you tell us your gender or age range, we use that data to keep our
> events feeling representative — making sure no single event drifts so far
> in one direction that the room stops being a balanced cross-section of
> the community. These two fields are visible only to the small core team
> running the platform; they are not displayed on your public profile, not
> shared with other members, not used for advertising, and never sold. The
> lawful basis is our legitimate interest in running a curated community
> event programme; you can edit or remove these fields any time from your
> profile, and you can leave them blank without affecting your access to
> any event.

**Operational rule** (already in place per the file's docstring): bump
`LEGAL_LAST_UPDATED` in `src/lib/legal/constants.ts` whenever this page
changes. The frontend-developer ships these adjustments alongside the
banner UI work, in the same release that exposes the form to members.

---

## Concrete SQL fragments — gathered

For the backend-developer's convenience, the SQL fragments referenced above,
collected in one place. **These are not migration files.** The
backend-developer writes the actual migrations, formatted to match the
existing migration style (header comment, idempotent guards, etc.).

### New enums (Migration 1)

```sql
CREATE TYPE public.gender AS ENUM (
  'female',
  'male',
  'non_binary',
  'prefer_not_to_say'
);

CREATE TYPE public.age_range AS ENUM (
  '18-24',
  '25-29',
  '30-34',
  '35-39',
  '40-44',
  '45-49',
  '50+'
);
```

### Profile column additions (Migration 1)

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender    public.gender,
  ADD COLUMN IF NOT EXISTS age_range public.age_range;

-- Authenticated GRANT narrowing — backend-developer enumerates the full
-- current safe-column list when writing the migration. Pattern in
-- 20260427000001_tighten_profiles_anon_grant.sql is the template.
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  -- enumerate all currently visible columns EXCEPT gender + age_range
) ON public.profiles TO authenticated;

-- Anon GRANT: NO change. New columns are not in the existing GRANT, so
-- they are invisible to anon callers automatically.
```

### SECURITY DEFINER demographics functions (Migration 1)

```sql
CREATE OR REPLACE FUNCTION public.get_my_demographics()
RETURNS TABLE (gender public.gender, age_range public.age_range)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT gender, age_range FROM public.profiles WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_demographics() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_my_demographics(
  p_gender public.gender,
  p_age_range public.age_range
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
  SET gender = p_gender,
      age_range = p_age_range,
      updated_at = now()
  WHERE id = auth.uid();
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_my_demographics(
  public.gender, public.age_range
) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_demographics(target_user_id uuid)
RETURNS TABLE (gender public.gender, age_range public.age_range)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT gender, age_range
    FROM public.profiles WHERE id = target_user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_demographics(uuid) TO authenticated;
```

### New tables (Migration 2)

```sql
CREATE TABLE IF NOT EXISTS public.tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  label       text NOT NULL,
  parent_id   uuid REFERENCES public.tags(id) ON DELETE SET NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tags_parent ON public.tags(parent_id);
CREATE INDEX IF NOT EXISTS idx_tags_active_sort
  ON public.tags(is_active, sort_order);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.tags TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tags TO authenticated;
-- Policies as Decision 7

CREATE TRIGGER set_tags_updated_at
  BEFORE UPDATE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── event_tags ──

CREATE TABLE IF NOT EXISTS public.event_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES public.tags(id)   ON DELETE RESTRICT,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_event_tags_event_tag UNIQUE (event_id, tag_id)
);

-- Partial unique index — exactly-one-primary-per-event
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_tags_one_primary
  ON public.event_tags (event_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_event_tags_event ON public.event_tags(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_tag   ON public.event_tags(tag_id);

ALTER TABLE public.event_tags ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.event_tags TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_tags TO authenticated;
-- Policies as Decision 7
```

`ON DELETE RESTRICT` on `tag_id` means a tag can't be hard-deleted while
events reference it. Combined with the `is_active` soft-retire pattern,
this is the correct safety: admins retire tags, never delete them.

### Tag seed insert (Migration 2)

```sql
INSERT INTO public.tags (slug, label, sort_order, is_active) VALUES
  ('drinks',             'Drinks',              10,  true),
  ('dining',             'Dining',              20,  true),
  ('cultural',           'Cultural',            30,  true),
  ('wellness',           'Wellness',            40,  true),
  ('sport',              'Sport',               50,  true),
  ('workshops',          'Workshops',           60,  true),
  ('music',              'Music',               70,  true),
  ('networking',         'Networking',          80,  true),
  ('activity',           'Activity',            90,  true),
  ('technology',         'Technology',         100,  true),
  ('entrepreneurship',   'Entrepreneurship',   110,  true),
  ('photography',        'Photography',        120,  true),
  ('travel',             'Travel',             130,  true),
  ('books-literature',   'Books & Literature', 140,  true),
  ('sustainable-living', 'Sustainable Living', 150,  true),
  ('film-cinema',        'Film & Cinema',      160,  true)
ON CONFLICT (slug) DO NOTHING;
```

### Event-tags backfill (Migration 2)

```sql
INSERT INTO public.event_tags (event_id, tag_id, is_primary)
SELECT
  e.id,
  t.id,
  true
FROM public.events e
JOIN public.tags t ON t.slug = e.category::text
WHERE e.deleted_at IS NULL
ON CONFLICT (event_id, tag_id) DO NOTHING;

-- Verify
DO $$
DECLARE
  missing_count int;
BEGIN
  SELECT count(*) INTO missing_count
  FROM public.events e
  WHERE e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.event_tags et
      WHERE et.event_id = e.id AND et.is_primary = true
    );
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % events without primary tag', missing_count;
  END IF;
END $$;
```

The cast `e.category::text` works because the enum's text representation
matches the canonical slug for all current values. New enum values added in
this migration (`technology`, `entrepreneurship`) follow the same pattern.

### Bidirectional sync trigger (Migration 2)

The mechanics are documented in §Decision 5; the backend-developer should
treat the implementation as: two trigger functions, one on each side, each
guarded by a `pg_trigger_depth()` check or a session-local `set_config`
flag to prevent cycles. Pseudocode:

```sql
-- After UPDATE on events (only when category changed):
--   if pg_trigger_depth() > 1: return  -- we're in the cycle
--   UPDATE event_tags SET tag_id = (SELECT id FROM tags WHERE slug = NEW.category::text)
--   WHERE event_id = NEW.id AND is_primary = true

-- After UPDATE/INSERT on event_tags (only when is_primary = true):
--   if pg_trigger_depth() > 1: return
--   UPDATE events SET category = (SELECT slug FROM tags WHERE id = NEW.tag_id)::event_category
--   WHERE id = NEW.event_id
```

Both triggers fire AFTER the row is committed-to-the-statement; both are
idempotent under `pg_trigger_depth()` guard.

### user_interests schema change (Migration 3)

```sql
ALTER TABLE public.user_interests
  ADD COLUMN IF NOT EXISTS tag_id uuid REFERENCES public.tags(id) ON DELETE CASCADE;

-- Backfill — see §Decision 9 for the full CASE statement

-- Verify zero NULLs
DO $$
DECLARE
  null_count int;
BEGIN
  SELECT count(*) INTO null_count FROM public.user_interests WHERE tag_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'user_interests backfill failed: % rows with null tag_id', null_count;
  END IF;
END $$;

-- Now safe to NOT NULL
ALTER TABLE public.user_interests ALTER COLUMN tag_id SET NOT NULL;

-- Swap unique constraint
ALTER TABLE public.user_interests
  DROP CONSTRAINT IF EXISTS uq_user_interests_user_interest;
ALTER TABLE public.user_interests
  ADD CONSTRAINT uq_user_interests_user_tag UNIQUE (user_id, tag_id);

-- The `interest` text column is KEPT for one release. Drop in a follow-up
-- migration (`drop_user_interests_interest_text`) after the application
-- is fully migrated to the FK.

CREATE INDEX IF NOT EXISTS idx_user_interests_tag ON public.user_interests(tag_id);
```

---

## Type-system surface (informational, for the frontend-developer)

The new fields in `src/types/index.ts` after all migrations:

```ts
// New enums
export type Gender = 'female' | 'male' | 'non_binary' | 'prefer_not_to_say'
export type AgeRange = '18-24' | '25-29' | '30-34' | '35-39'
                    | '40-44' | '45-49' | '50+'

// Profile additions (NB: only present when fetched via own-row or admin paths)
export interface Profile {
  // ... existing fields
  gender?:    Gender    | null
  age_range?: AgeRange  | null
}

// New types
export interface Tag {
  id:          string
  slug:        string
  label:       string
  parent_id:   string | null
  sort_order:  number
  is_active:   boolean
  created_at:  string
  updated_at:  string
}

export interface EventTag {
  id:          string
  event_id:    string
  tag_id:      string
  is_primary:  boolean
  created_at:  string
}

// Updated UserInterest
export interface UserInterest {
  id:         string
  user_id:    string
  tag_id:     string         // NEW — required after Migration 3
  interest:   string         // KEPT for one release (Migration 3 keeps the column)
  created_at: string
}
```

A constant for `is_primary_eligible` lives in `src/lib/constants.ts`:

```ts
export const PRIMARY_ELIGIBLE_TAG_SLUGS = new Set<string>([
  'drinks', 'dining', 'cultural', 'wellness', 'sport', 'workshops',
  'music', 'networking', 'activity', 'technology', 'entrepreneurship',
])
```

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| `authenticated` GRANT narrowing breaks an unrelated query | Medium | Backend-developer enumerates the full current column set before REVOKE; tester runs the existing profile/auth suite against the new GRANT. |
| Bidirectional sync trigger causes infinite loops | Medium | `pg_trigger_depth()` guard on both sides; tester writes a Vitest case that updates both sides and asserts no recursion. |
| Backfill of `user_interests.tag_id` leaves NULLs | Low | Migration verification step (DO $$ … RAISE EXCEPTION) fails the migration, surfacing unmapped rows immediately. |
| Adding enum values then trying to use them in same migration | Medium | Backend-developer splits ADD VALUE into its own statement, separate from the seed insert. |
| Member discovers other-member demographics via REST | High before Migration 1; mitigated by Option A | Decision 7 Option A narrows `authenticated` GRANT in the same migration that adds the columns. |
| Privacy policy update lags the column visibility | Low (operational) | Frontend-developer ships the privacy text update in the same release as the demographics banner. Don't deploy the banner without the privacy change. |
| Gender/age forms feel intrusive — sign-up drop-off | Out of data-layer scope | UX-designer + product-owner own the banner copy. Spec recommends the post-signup banner over signup form (per PHASE-3-BACKLOG.md). |
| Two-stage drop of `events.category` (Migration 2 trigger → Migration 4 drop) leaves dual writes longer than expected | Low | Acceptable. The bidirectional trigger is cheap; if Migration 4 slips, nothing breaks. |
| `event_tags` SELECT policy subquery hot-path performance regression on `/events` listing | Low | The `idx_events_published` partial index covers the join's filter. Tester adds an EXPLAIN check on the events listing query post-migration. |

---

## Questions for the product owner

These are decisions where the data-layer architect can recommend a default,
but the call genuinely belongs to the product owner:

1. **`technology` and `entrepreneurship` as primary-eligible tags.** Spec
   default: yes (recommended). These promote two interest values to
   first-class event categories, opening the door to founder-circle and
   tech-meetup events as a first-tag-bearing category. The alternative is
   to keep them interest-only for now (matching the current state) and
   promote later via a flip of `is_primary_eligible` when the first such
   event is scheduled. The cost of including now is two enum ADD VALUE
   statements and adding both slugs to `PRIMARY_ELIGIBLE_TAG_SLUGS`. **No
   downside to deferring; small upside to including now.** Product owner
   call.

2. **Decision 7 Option A vs Option B for `authenticated` GRANT narrowing.**
   Spec default: Option A (narrow the GRANT in the same migration). Option
   B (rely on application-layer gating) is the path the codebase uses
   today for `phone_number`, with a known follow-up risk flagged in the
   Phase 3 backlog. Option A is more migration work but eliminates the
   risk class entirely. Product owner call: are we comfortable that
   demographic data is sensitive enough to warrant the stricter gate?

3. **Whether to expose member-set demographics in the member's own profile
   edit form, or **only** via the post-signup banner.** Spec assumes the
   profile edit form (and "Your data & privacy" download) gets the new
   fields, so members can edit later. Product owner call: are these
   fields visible-and-editable forever, or one-time-set with no edit UI?
   Spec's recommendation: visible-and-editable, because members
   genuinely change identity claims, and immutability would surprise
   people who chose `prefer_not_to_say` and later want to update. The
   admin-only visibility argument is about who *reads* the data, not
   who *writes* it.

4. **Retention rule for demographics on account deletion.** The existing
   account-deletion flow (`privacy-actions.ts`) anonymises the profile
   and hard-deletes after 30 days. The two new columns are PII and
   should be anonymised along with everything else. Spec assumes the
   backend-developer extends the existing deletion sequence to NULL out
   `gender` and `age_range` (or the SECURITY DEFINER admin function
   simply returns NULL for soft-deleted profiles). Product owner sign-off:
   confirm the same retention as other PII.

5. **Tag retirement vs deletion.** `is_active = false` is the soft-retire
   path; there's no hard-delete UI proposed here. Product owner call: do
   admins ever need a "permanently delete this tag" path, or is "make
   it inactive and forget it" sufficient? Spec assumes the latter.

6. **The 16th tag is a lot for a member-facing interest picker.** The
   current registration Step 2 shows 14 options as a chip grid. Adding
   `activity` (currently event-only) brings this to 15; promoting
   `technology` + `entrepreneurship` for events (already interest values)
   is neutral. Product owner: comfortable showing all 16 in the
   registration interest picker, or should the picker filter to a curated
   subset?

7. **Migration 4 timing.** Spec recommends "after one stable release of
   Migration 3." Product owner: any preference for cadence — bundle all
   four in one PR for the data team to review together, or stage them
   across two PRs (Migrations 1+2+3 → release → Migration 4 in a
   follow-up)?

---

## Out of scope — not designed in this spec

Restating from §0, with one-line reasons each:

- **Recommendation engine** ("events you might like"): consumes the new
  data layer; algorithm design is its own product call.
- **Event-mix balancing logic** (admin caps, soft warnings, automatic
  enforcement): consumes demographics; threshold rules and UI are a
  separate spec.
- **Email targeting / segmentation by tag overlap**: a separate
  notification feature that joins `user_interests` to `bookings`/`events`
  via `event_tags`.
- **Search-by-tag UI**: members browsing events filtered by tag is a UX
  feature — separate frontend brief.
- **Tag hierarchy**: `parent_id` exists per Decision 3, but the query
  patterns and admin UI for hierarchy are not designed here. The flat
  list is sufficient until member or admin friction surfaces it.
- **PWA / push notifications, multi-ticket bookings, referral system,
  promo codes** — Phase 3 backlog items unrelated to the data layer.

---

## HANDOVER

- **Agent:** architect
- **Task:** Member-data layer schema spec — gender + age_range on profiles, canonical tag taxonomy replacing dual `events.category` + `user_interests.interest` vocabulary
- **Files changed:** `docs/member-data-layer-spec.md` (new file, this document)
- **Migrations planned:**
  1. `add_profile_demographics` — gender + age_range enums + columns; narrow `authenticated` GRANT; SECURITY DEFINER demographics functions (Migration 1)
  2. `create_tags_and_event_tags` — tags + event_tags tables; ADD VALUE 'technology' and 'entrepreneurship' to event_category; seed 16 tags; backfill event_tags primary rows; install bidirectional sync trigger (Migration 2)
  3. `migrate_user_interests_to_tag_id` — add tag_id FK, backfill from text, swap unique constraint, keep text column for one release (Migration 3)
  4. `drop_user_interests_interest_text` — follow-up after application code migrated (post-Migration 3)
  5. `drop_events_category_enum` — follow-up after application code migrated; drop sync trigger, drop column, drop enum (Migration 4)
- **Tests added:** none (architect doesn't write tests)
- **Next agent:** product owner (review the 7 questions in §"Questions for the product owner") → planner (sequence backend-developer → tester → frontend-developer for the implementation phase)
- **Risks / open questions:** the 7 product-owner questions in the dedicated section. Two are operationally meaningful enough to block migration writing (Q1: include `technology`/`entrepreneurship` as primary-eligible; Q2: GRANT narrowing approach). Q3–Q7 can be resolved in parallel with backend-developer drafting Migrations 1–3.
