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

> **Revision note (2026-04-26):** the original 16-tag list was generic
> taxonomy that didn't survive contact with reality. The product owner
> mapped all 33 past events and the next 12 months of forward-planned
> events to candidate categories; the result is the 15 primary-eligible
> tags below, plus 8 interest-only tags preserved from the existing
> `INTEREST_OPTIONS` list. This rewrite supersedes the earlier draft.

**Decision:** A 23-row canonical taxonomy in `public.tags` — **15
primary-eligible** (admin can use as an event's primary tag) and **8
interest-only** (members can select as an interest but no event can use as
primary).

The reconciliation work:

| Source list | Members |
|---|---|
| `event_category` enum (legacy, to be dropped per Decision 5) | 9 values |
| `INTEREST_OPTIONS` (legacy free text in `src/lib/constants.ts`) | 14 values |
| **Canonical tags — primary-eligible** | **15 values** |
| **Canonical tags — interest-only** | **8 values** |
| **Total tags row count** | **23** |

The new list comes from a 33-event audit. The product owner walked every
shipped event and every forward-planned event into one of the 15
primary-eligible tags; categories that didn't earn a single event were
dropped, categories that span multiple distinct vibes were split.

**Canonical seed list — primary-eligible (15):**

| slug | label | sort_order | is_primary_eligible | Notes |
|---|---|---|---|---|
| `drinks-bars` | Drinks & Bars | 10 | yes | The platform's most-shipped category — 9 past + 1 future event. Replaces the old `drinks` enum value. |
| `dining-supper-clubs` | Dining & Supper Clubs | 20 | yes | 5 past + 2 future. Replaces `dining`. |
| `activities-social-games` | Activities & Social Games | 30 | yes | 4 past + 1 future. New tag — pulls in axe throwing, mini golf, Flight Club, Fairgame: events the old taxonomy mis-classified as `sport` or `drinks`. |
| `nightlife-dancing` | Nightlife & Dancing | 40 | yes | 3 past + 2 future. New tag. Distinct vibe from drinks-bars (late-night, dance-floor, often themed). |
| `live-music-gigs` | Live Music & Gigs | 50 | yes | 1 past so far. Sharper than the old `music` enum (which lumped concerts with club nights). |
| `theatre-comedy` | Theatre & Comedy | 60 | yes | 2 past + 1 future. New tag. Carved out of the over-broad `cultural` bucket. |
| `galleries-museums` | Galleries & Museums | 70 | yes | 1 past. New tag. Also carved out of `cultural`. |
| `festivals-seasonal` | Festivals & Seasonal | 80 | yes | 2 past + 4 future. **High-volume forward category** — Polo in the Park, Diwali, Winter Wonderland etc. Cluster the seasonal calendar here. |
| `sport-fitness` | Sport & Fitness | 90 | yes | 2 past + 1 future. Replaces the old `sport` enum but with a narrower scope (genuine sport/fitness, not "any active activity"). |
| `outdoor-picnics` | Outdoor & Picnics | 100 | yes | 1 past + 2 future. New tag. Picnics, garden parties, daytime open-air events. |
| `weekends-travel` | Weekends & Travel | 110 | yes | 2 past + 2 future. New tag. Multi-day getaways (Cotswolds, Snowdonia, St Moritz, Lake District). Often multi-tagged with `sport-fitness`. |
| `themed-socials` | Themed Socials | 120 | yes | 2 past + 2 future. New tag — Black Tie, Valentine's Singles, costume parties. Distinct from generic drinks/dining. |
| `charity-volunteering` | Charity & Volunteering | 130 | yes | 2 past. New tag — preserves the Crisis volunteering and 80s/90s charity night as a first-class category. |
| `wellness-mindfulness` | Wellness & Mindfulness | 140 | yes | 0 past + 0 future. **Forward-looking** — placeholder for the wellness programme the product owner intends to seed. Replaces `wellness`. |
| `workshops-masterclasses` | Workshops & Masterclasses | 150 | yes | 0 past + 2 future (wine tastings). Replaces `workshops`. Also the home for tech-meetups and founder circles (see "interest-only" below). |

**Canonical seed list — interest-only (8):**

These rows live in the same `tags` table so member interests can FK into a
single source of truth, but they are NOT in `PRIMARY_ELIGIBLE_TAG_SLUGS`
(see Type-system surface). Admins cannot select them as an event's primary
tag. They preserve member-selected signal that doesn't (yet) match a
shipping event category.

Sort orders begin at 200 to leave room for primary-eligible insertions.

| slug | label | sort_order | is_primary_eligible | Notes |
|---|---|---|---|---|
| `interest-technology` | Technology | 200 | no | Demoted from primary-eligible after audit. Tech-meetup events go under `workshops-masterclasses` as primary; this stays as an interest signal so members get the right invite mix. |
| `interest-entrepreneurship` | Entrepreneurship | 210 | no | Same as Technology — founder-circle events run under `workshops-masterclasses` primary. |
| `interest-networking` | Networking | 220 | no | Zero networking events have ever shipped (despite the legacy `networking` enum value). Tag dropped from primary list, but kept here so the existing user-interest data isn't silently destroyed. |
| `interest-photography` | Photography | 230 | no | Future photography walks would run under `workshops-masterclasses`. Stays as interest signal. |
| `interest-travel` | Travel | 240 | no | **Deliberately distinct from `weekends-travel`.** "Travel" the interest = "I like travel-flavoured everything"; "Weekends & Travel" the primary tag = "this specific event is a multi-day getaway." Single-label "Travel" stays so members can keep the granularity. |
| `interest-books-literature` | Books & Literature | 250 | no | Future supper-club/book-club events would run under `dining-supper-clubs` or `workshops-masterclasses` primary. |
| `interest-sustainable-living` | Sustainable Living | 260 | no | Aspirational interest; no current event peer. |
| `interest-film-cinema` | Film & Cinema | 270 | no | Future events would run under `theatre-comedy` or as themed-socials primary. |

**`interest-` prefix on slugs:** disambiguates from primary tags. A future
admin who reads `tags.slug` as `interest-photography` immediately knows the
shape (interest signal, not an event category). When/if any of these get
promoted to primary-eligible, the migration is: insert a new tag row with
the un-prefixed slug (e.g. `photography`), repoint user_interests rows from
the old slug to the new, set `is_active = false` on the old.

**Items dropped from the previous draft (16 → 15 primary-eligible) and why:**

| Dropped | Replaced by | Reason |
|---|---|---|
| `activity` | `activities-social-games` (renamed/sharpened) | Meaningless label; zero of 33 past events used the enum value. Confirmed dead. |
| `cultural` | `theatre-comedy`, `galleries-museums`, `festivals-seasonal`, `outdoor-picnics`, `charity-volunteering`, `weekends-travel` | Too broad. The 8 past `cultural` events spanned six distinct real vibes. The split below preserves every single one with a sharper home. |
| `sport` (single, broad) | `sport-fitness` (narrowed) | The original `sport` enum mixed spectator events (Polo in the Park) with active outdoor (hiking) with games (axe throwing). Now: spectator → `festivals-seasonal`; hiking → `weekends-travel` + `sport-fitness`; games → `activities-social-games`. |
| `technology` (as primary) | `workshops-masterclasses` (for events) + `interest-technology` (for member signal) | Tech-meetup events fit cleanly under workshops; promoting `technology` as a primary tag would create a parallel home for the same events. Tag stays in DB as interest-only. |
| `entrepreneurship` (as primary) | Same as `technology` | Same logic. |
| `networking` | `interest-networking` (interest-only) | Zero events of this category have ever run. Removing from primary list reflects reality; keeping as interest preserves member signal. |
| `photography` (as primary) | `workshops-masterclasses` (for events) + `interest-photography` | Same pattern — events fit elsewhere; interest preserved. |

**Validation: distribution against actual events**

Product-owner-supplied counts (33 past + 12 forward-planned = 45 mapped events):

| Tag | Past | Future | Total |
|---|---:|---:|---:|
| Drinks & Bars | 9 | 1 | 10 |
| Dining & Supper Clubs | 5 | 2 | 7 |
| Activities & Social Games | 4 | 1 | 5 |
| Nightlife & Dancing | 3 | 2 | 5 |
| Festivals & Seasonal | 2 | 4 | 6 |
| Theatre & Comedy | 2 | 1 | 3 |
| Outdoor & Picnics | 1 | 2 | 3 |
| Weekends & Travel | 2 | 2 | 4 |
| Sport & Fitness | 2 | 1 | 3 |
| Charity & Volunteering | 2 | 0 | 2 |
| Themed Socials | 2 | 2 | 4 |
| Live Music & Gigs | 1 | 0 | 1 |
| Galleries & Museums | 1 | 0 | 1 |
| Wellness & Mindfulness | 0 | 0 | 0 (forward-looking) |
| Workshops & Masterclasses | 0 | 2 | 2 |

(Counts are by **primary** tag. Roughly half the future events get
secondary tags too — see "Multi-tagging" note below.)

**Multi-tagging earns its keep.** The 33-event audit produced ~22 events
that benefit from secondary tags — Halloween at Cubanista is `nightlife-
dancing` primary plus `festivals-seasonal` and `themed-socials`
secondaries; Hiking in Snowdonia is `weekends-travel` primary plus
`sport-fitness` secondary. Without secondaries, the canonical taxonomy
wouldn't fit the real event mix without forcing arbitrary single-tag
choices. The `event_tags` join table supports this from day one (per
§Decision 6's partial unique index, which is `WHERE is_primary = true` —
secondaries can have any count).

**Note on `is_primary_eligible`:** this is a **business rule encoded as a
constant in `src/lib/constants.ts`**, not a column on the `tags` table.
Adding it as a column would couple the taxonomy table to the events use
case (member interest pickers also need to enumerate the table — they
don't care about primary-eligibility). The constant
`PRIMARY_ELIGIBLE_TAG_SLUGS` (Type-system surface) is what the admin
event-creation form reads; the DB enforces "exactly one primary per
event" via Decision 6. If future use expands (e.g. user-facing tag
picker filters by "events bookable in this tag"), the column is one
ALTER away.

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

**Caveat for the backend developer (revised 2026-04-26):** the original
draft assumed the new tag slugs would match the existing `event_category`
enum values 1:1 (e.g. tag `drinks` ↔ enum `'drinks'`). After the Decision 4
rewrite, that assumption no longer holds — the 15 new primary slugs
(`drinks-bars`, `dining-supper-clubs`, `nightlife-dancing`, …) are entirely
new vocabulary. The 9-value `event_category` enum stays as-is (we are NOT
adding new values), and the bidirectional trigger needs a **static
slug→enum lookup** baked into the trigger functions.

The mapping is **lossy** (15 → 9, many-to-one), and that is acceptable
because:

- The dual-write window is transient (Migration 4 drops `events.category`
  entirely).
- During the window, `events.category` is a "best-effort legacy display
  value." It exists so old read paths (filters page, JSON-LD `keywords`,
  list-page filter dropdown) keep working until the application code
  migrates to read tags directly.
- Many-to-one collapse means changing the primary tag to a different slug
  that maps to the same legacy enum value is a no-op for `events.category`
  (e.g. flipping primary from `theatre-comedy` to `galleries-museums` keeps
  category at `cultural`). This is fine — the legacy column is never the
  source of truth post-Migration 2.

The slug→enum mapping table is given concretely in the SQL fragments
section (see "Bidirectional sync trigger"). Backend-developer note: if a
future tag is added with `is_primary_eligible = true` and no entry in the
mapping function, the trigger should raise an explicit error (`'no enum
mapping for slug %'`) — fail loud rather than silently writing a
stale/wrong category. After Migration 4 ships, this concern evaporates.

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
  partial unique index for primary uniqueness. Seed `tags` with the
  23-row canonical list (15 primary-eligible + 8 interest-only — see
  Decision 4). Backfill `event_tags` with primary + secondary rows per
  existing event using the per-event manual lookup (see Event-tags
  backfill SQL fragment), reflecting the product owner's audit of all 33
  past events. Install the bidirectional sync trigger between
  `events.category` and primary `event_tags`, including the static
  slug→enum mapping function (see Decision 5 caveat + SQL fragments). RLS
  policies + GRANTs as Decision 7.
- **No new enum values added.** The `event_category` enum stays at its
  current 9 values. The taxonomy revision (15 new primary slugs, none
  matching the old enum) means there's no benefit to adding enum values
  that are about to be dropped in Migration 4. The slug→enum mapping in
  the trigger collapses 15 → 9 (lossy but transient).
- **Safety:**
  - Creating `tags` and `event_tags` is additive — zero impact on any
    existing query.
  - Backfilling `event_tags` is **multi-tag per event**: ~22 of 33 past
    events get a primary plus 1–2 secondaries. The partial unique index
    `WHERE is_primary = true` enforces exactly-one-primary while allowing
    any number of secondary rows per event_id (verified — see Risk
    register entry on multi-tag backfill).
  - The backfill uses a per-event UUID-keyed CASE statement for the 22
    audited events, plus a default-mapping CASE for the remaining 11
    drinks/dining events that didn't need re-classification. With ~50
    events, this runs in well under a second; at 50K events the
    UUID-keyed CASE would still be fine but the default-mapping path
    would dominate (the per-event overrides are a one-time backfill
    artefact, not a steady-state mechanism).
  - The partial unique index is created **after** the backfill, so the
    backfill's "exactly one primary per event" property is verifiable
    against the index creation. If the backfill accidentally produced
    two primary rows for one event_id, the index creation fails loudly.
  - The bidirectional trigger needs to be **idempotent and re-entry-safe** —
    if updating `events.category` fires the events-side trigger which
    writes to `event_tags` which fires the event_tags-side trigger which
    writes back to `events.category`, you have an infinite loop. The
    backend-developer must implement a `pg_trigger_depth()` check or set a
    session-local guard variable to break the cycle.
  - The trigger's slug→enum lookup function must include every primary-
    eligible slug. If a primary slug has no mapping, the trigger raises.
    See SQL fragments for the full mapping table.
  - Default values: `event_tags.is_primary` defaults to `false`. The
    backfill explicitly sets `is_primary = true` only for the primary
    row per event; secondary rows leave it at the default.
  - RLS enabled before any INSERT (Postgres allows INSERTs during
    migrations as the `postgres` role which bypasses RLS, so the seed
    inserts work; but the policies are in place before any session
    operates on the tables).
- **Application-side coupling:** none required immediately — the
  bidirectional trigger means existing `events.category` queries continue
  to work (with the lossy-collapse caveat from Decision 5). The
  frontend-developer adds a tag picker (with secondary-tag support) to
  the admin event form in a separate batch; until then, admins still set
  `category` via the current dropdown and the trigger updates only the
  primary `event_tags` row (secondaries cannot be edited via the legacy
  form — that's accepted because secondaries on new events will be
  added through the new admin UI).
- **Rollback:** drop the trigger first, drop the slug→enum mapping
  function, drop `event_tags`, drop `tags`. No enum changes to reverse.
  Realistically still "forward fix" rather than revert, but the absence
  of enum modifications makes this much cleaner than the original
  draft's plan.

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

- **Intent:** Drop the bidirectional sync triggers
  (`trg_sync_primary_tag_from_category` and
  `trg_sync_category_from_primary_tag`). Drop the trigger functions
  (`_sync_primary_tag_from_category`, `_sync_category_from_primary_tag`)
  and the slug→enum mapping function (`_tag_slug_to_legacy_category`).
  Drop the `category` column on `events`. Drop the `event_category` enum.
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

> **Revision note (2026-04-26):** rewritten to match the new 23-tag
> taxonomy (Decision 4 revision). Every existing INTEREST_OPTIONS value
> is preserved — six remap to a primary-eligible tag (sharing the home
> with future events), eight remap to a dedicated `interest-…` slug
> (signal preserved, no event peer required).

The 14 existing values in `INTEREST_OPTIONS` (`src/lib/constants.ts`)
break into two groups under the new taxonomy:

**Group A — remap to a primary-eligible tag** (6 of 14)

These interest values describe a member preference for a category that
the platform actively runs events under. Pointing the `tag_id` at the
primary-eligible tag means a member who selected this interest will
naturally surface in any future "members interested in X events" query
that the recommendation engine builds.

| Source `interest` text | → Canonical tag slug | is_primary_eligible | Reason |
|---|---|---|---|
| `Wine & Cocktails` | `drinks-bars` | yes | The interest is a flavour of the broader category. Member who picked "Wine & Cocktails" will see drinks-bars events highlighted. |
| `Fine Dining` | `dining-supper-clubs` | yes | Same logic — interest is a flavour of the category. |
| `Art & Culture` | `galleries-museums` | yes | The closest single primary tag from the old broad `cultural`. (Members who selected "Art & Culture" might also want theatre-comedy; they can re-pick later if needed — this is a one-time best-effort remap.) |
| `Yoga & Wellness` | `wellness-mindfulness` | yes | Direct semantic match. |
| `Running & Sport` | `sport-fitness` | yes | Same — exact category match. |
| `Jazz & Music` | `live-music-gigs` | yes | "Jazz & Music" interest gets the live-music-gigs primary; if "Jazz" specifically becomes a tag later, members can re-pick. |

**Group B — remap to interest-only tag** (8 of 14)

These are member-selected signals that don't currently align to a primary
event category. The dedicated `interest-…` slugs preserve every signal
without polluting the admin event-creation tag picker.

| Source `interest` text | → Canonical tag slug | is_primary_eligible | Reason |
|---|---|---|---|
| `Technology` | `interest-technology` | no | Demoted from the original primary list per the audit. Tech-meetup events will run under `workshops-masterclasses` primary; members tagged with the interest get the right invite mix. |
| `Entrepreneurship` | `interest-entrepreneurship` | no | Same as Technology. |
| `Networking` | `interest-networking` | no | Tag dropped from primary list (zero events ever ran). Existing user_interests rows preserved here so member signal isn't silently lost. |
| `Photography` | `interest-photography` | no | Future photography walks/workshops would run under `workshops-masterclasses` primary. |
| `Travel` | `interest-travel` | no | **Deliberately distinct from `weekends-travel`.** The interest is broader (travel-flavoured everything); the primary tag is narrow (multi-day getaway events). Single-label "Travel" stays so members keep the granularity. |
| `Books & Literature` | `interest-books-literature` | no | No event peer; interest preserved. |
| `Sustainable Living` | `interest-sustainable-living` | no | No event peer; interest preserved. |
| `Film & Cinema` | `interest-film-cinema` | no | Future events would run under `theatre-comedy` or themed-socials primary. |

**No drops, no merges of source values.** All 14 INTEREST_OPTIONS values
are preserved in the migrated `user_interests` rows. Six get the upgrade
to a primary-eligible tag (richer downstream queries), eight stay as
dedicated interest-only signals.

**Defensive case — values not in the 14:**
The current schema has UNIQUE(user_id, interest) but no CHECK constraint
restricting `interest` to the 14 INTEREST_OPTIONS values — the
constants-list enforcement is application-side. In practice all rows in
the seed and live data come from the form (constrained), but the
migration must defend against an off-list value (e.g. a stale row from
a pre-tightening release). The CASE expression below maps unknown values
to NULL; the verification step (existing in §SQL fragments — Migration
3) raises if any NULLs remain. Backend-developer handles each surfaced
unknown by **either** (a) adding a new mapping to the migration, **or**
(b) explicitly deleting the orphan row with a comment in the migration
header explaining what was deleted and why. Don't silently drop.

**SQL fragment for the backfill** (illustrative — backend-developer
implements; the actual migration uses a transaction and the full
verification block from §SQL fragments → user_interests schema change):

```sql
UPDATE public.user_interests ui
SET tag_id = t.id
FROM public.tags t
WHERE t.slug = CASE ui.interest
  -- Group A: primary-eligible remaps
  WHEN 'Wine & Cocktails'   THEN 'drinks-bars'
  WHEN 'Fine Dining'        THEN 'dining-supper-clubs'
  WHEN 'Art & Culture'      THEN 'galleries-museums'
  WHEN 'Yoga & Wellness'    THEN 'wellness-mindfulness'
  WHEN 'Running & Sport'    THEN 'sport-fitness'
  WHEN 'Jazz & Music'       THEN 'live-music-gigs'
  -- Group B: interest-only remaps (note the 'interest-' prefix on slugs)
  WHEN 'Technology'         THEN 'interest-technology'
  WHEN 'Entrepreneurship'   THEN 'interest-entrepreneurship'
  WHEN 'Networking'         THEN 'interest-networking'
  WHEN 'Photography'        THEN 'interest-photography'
  WHEN 'Travel'             THEN 'interest-travel'
  WHEN 'Books & Literature' THEN 'interest-books-literature'
  WHEN 'Sustainable Living' THEN 'interest-sustainable-living'
  WHEN 'Film & Cinema'      THEN 'interest-film-cinema'
  -- Off-list values: leave tag_id NULL; verification step raises
  ELSE NULL
END;

-- Verification — must return 0. If non-zero, surface the unmapped values:
--   SELECT interest, count(*) FROM public.user_interests
--    WHERE tag_id IS NULL GROUP BY interest;
SELECT count(*) FROM public.user_interests WHERE tag_id IS NULL;
```

**Alternative implementation — temporary lookup table.** For larger
fact-tables or for audit-trail reasons, the backend-developer may prefer
to materialise the mapping as a temporary table joined into the UPDATE,
rather than embedding the CASE expression. With 14 mappings the CASE is
readable; if more remappings are added in future migrations, switching
to a temp table becomes worthwhile.

**Member UX note — out of scope for the architect, flagged for the
UX-designer/product owner:** any member who selected `Art & Culture`,
`Jazz & Music`, or `Wine & Cocktails` gets remapped to a single more-
specific primary tag. The remap is best-effort — a member who is into
"culture" generally (theatre + galleries + festivals) gets only
`galleries-museums` after the migration. A one-time post-migration
prompt ("we updated our interest list — pick any extras you'd like to
follow") would close that gap, but it's a frontend-developer task, not
a data-layer one. See Q9 in §"Questions for the product owner".

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

23 rows: 15 primary-eligible (sort 10–150) followed by 8 interest-only
(sort 200–270). The `is_primary_eligible` business rule is **not** stored
in this table — it lives as the `PRIMARY_ELIGIBLE_TAG_SLUGS` constant in
`src/lib/constants.ts` (see Type-system surface). The DB only stores the
canonical taxonomy.

```sql
INSERT INTO public.tags (slug, label, sort_order, is_active) VALUES
  -- ── Primary-eligible (15) ─────────────────────────────────────────
  ('drinks-bars',                 'Drinks & Bars',              10,  true),
  ('dining-supper-clubs',         'Dining & Supper Clubs',      20,  true),
  ('activities-social-games',     'Activities & Social Games',  30,  true),
  ('nightlife-dancing',           'Nightlife & Dancing',        40,  true),
  ('live-music-gigs',             'Live Music & Gigs',          50,  true),
  ('theatre-comedy',              'Theatre & Comedy',           60,  true),
  ('galleries-museums',           'Galleries & Museums',        70,  true),
  ('festivals-seasonal',          'Festivals & Seasonal',       80,  true),
  ('sport-fitness',               'Sport & Fitness',            90,  true),
  ('outdoor-picnics',             'Outdoor & Picnics',         100,  true),
  ('weekends-travel',             'Weekends & Travel',         110,  true),
  ('themed-socials',              'Themed Socials',            120,  true),
  ('charity-volunteering',        'Charity & Volunteering',    130,  true),
  ('wellness-mindfulness',        'Wellness & Mindfulness',    140,  true),
  ('workshops-masterclasses',     'Workshops & Masterclasses', 150,  true),
  -- ── Interest-only (8) ─────────────────────────────────────────────
  -- Slugs prefixed with 'interest-' to disambiguate from primary tags.
  ('interest-technology',         'Technology',                200,  true),
  ('interest-entrepreneurship',   'Entrepreneurship',          210,  true),
  ('interest-networking',         'Networking',                220,  true),
  ('interest-photography',        'Photography',               230,  true),
  ('interest-travel',             'Travel',                    240,  true),
  ('interest-books-literature',   'Books & Literature',        250,  true),
  ('interest-sustainable-living', 'Sustainable Living',        260,  true),
  ('interest-film-cinema',        'Film & Cinema',             270,  true)
ON CONFLICT (slug) DO NOTHING;
```

### Event-tags backfill (Migration 2)

The product owner's audit produced a per-event mapping for 22 of the 33
seed events (every cultural/sport/music event plus four drinks/dining
events that were misclassified). The remaining 11 events use a default
mapping based on their current `events.category` value. ~22 events get
secondary tags in addition to their primary.

The backfill has three steps:

1. **Primary tags — per-event override** for the 22 audited events.
2. **Primary tags — default fallback** for the 11 events without an
   explicit override (drinks → drinks-bars; dining → dining-supper-clubs;
   wellness/workshops/networking/activity → respective replacements;
   any future event added to the seed before Migration 2 ships gets the
   default).
3. **Secondary tags — per-event INSERT** for the events the audit gave
   1–2 secondaries.

The full per-event override comes from the product-owner-supplied
mapping. Event UUIDs follow the seed's `e1000000-0000-0000-0000-
0000000000NN` pattern — the UUID for "Event NN" is constructable from
the two-digit number.

```sql
-- ── Step 1: Primary tags for the 22 audited events ─────────────────
INSERT INTO public.event_tags (event_id, tag_id, is_primary)
SELECT
  v.event_id::uuid,
  t.id,
  true
FROM (VALUES
  -- Cultural reclassifications (8)
  ('e1000000-0000-0000-0000-000000000008', 'weekends-travel'),       -- Cotswolds Weekend
  ('e1000000-0000-0000-0000-000000000012', 'festivals-seasonal'),    -- Fireworks Night, Totteridge
  ('e1000000-0000-0000-0000-000000000013', 'theatre-comedy'),        -- Comedy & Dinner in Angel
  ('e1000000-0000-0000-0000-000000000014', 'galleries-museums'),     -- Tate Late
  ('e1000000-0000-0000-0000-000000000016', 'charity-volunteering'),  -- Christmas Eve Volunteering with Crisis
  ('e1000000-0000-0000-0000-000000000023', 'theatre-comedy'),        -- Queen of Wands at Union Theatre
  ('e1000000-0000-0000-0000-000000000026', 'outdoor-picnics'),       -- Picnic in Regent's Park
  ('e1000000-0000-0000-0000-000000000030', 'festivals-seasonal'),    -- Winter Wonderland
  -- Sport reclassifications (7)
  ('e1000000-0000-0000-0000-000000000003', 'activities-social-games'), -- Axe Throwing & Drinks
  ('e1000000-0000-0000-0000-000000000007', 'activities-social-games'), -- Flight Club + Little Scarlett Door
  ('e1000000-0000-0000-0000-000000000010', 'weekends-travel'),         -- Hiking in Snowdonia
  ('e1000000-0000-0000-0000-000000000020', 'weekends-travel'),         -- Skiing in St Moritz
  ('e1000000-0000-0000-0000-000000000022', 'activities-social-games'), -- Mini Golf & Drinks
  ('e1000000-0000-0000-0000-000000000024', 'weekends-travel'),         -- Hiking in the Lake District
  ('e1000000-0000-0000-0000-000000000025', 'festivals-seasonal'),      -- Polo in the Park
  -- Music reclassifications (3)
  ('e1000000-0000-0000-0000-000000000021', 'live-music-gigs'),         -- Oliver Heldens at O2 Brixton
  ('e1000000-0000-0000-0000-000000000028', 'nightlife-dancing'),       -- Halloween at Cubanista
  ('e1000000-0000-0000-0000-000000000029', 'charity-volunteering'),    -- Charity 80s/90s Night
  -- Drinks/dining reclassifications (4)
  ('e1000000-0000-0000-0000-000000000001', 'activities-social-games'), -- Fairgame & Pizza
  ('e1000000-0000-0000-0000-000000000011', 'themed-socials'),          -- Black Tie Evening, Pall Mall
  ('e1000000-0000-0000-0000-000000000015', 'nightlife-dancing'),       -- Christmas Party at Tonteria
  ('e1000000-0000-0000-0000-000000000018', 'themed-socials')           -- Valentine's Singles Evening
) AS v(event_id, slug)
JOIN public.tags t ON t.slug = v.slug
WHERE EXISTS (
  SELECT 1 FROM public.events e
  WHERE e.id = v.event_id::uuid AND e.deleted_at IS NULL
)
ON CONFLICT (event_id, tag_id) DO NOTHING;

-- ── Step 2: Primary tags via default mapping (the 11 unaudited events) ─
-- For any event NOT covered by Step 1, map old enum value to new slug.
INSERT INTO public.event_tags (event_id, tag_id, is_primary)
SELECT
  e.id,
  t.id,
  true
FROM public.events e
JOIN public.tags t ON t.slug = CASE e.category::text
  WHEN 'drinks'     THEN 'drinks-bars'
  WHEN 'dining'     THEN 'dining-supper-clubs'
  WHEN 'wellness'   THEN 'wellness-mindfulness'
  WHEN 'workshops'  THEN 'workshops-masterclasses'
  WHEN 'networking' THEN 'workshops-masterclasses'  -- networking demoted to interest-only; closest event home
  WHEN 'activity'   THEN 'activities-social-games'
  WHEN 'sport'      THEN 'sport-fitness'   -- defensive; all current sport rows are in Step 1
  WHEN 'cultural'   THEN 'galleries-museums'  -- defensive; all current cultural rows are in Step 1
  WHEN 'music'      THEN 'live-music-gigs'  -- defensive; all current music rows are in Step 1
END
WHERE e.deleted_at IS NULL
  -- Skip events already given a primary in Step 1
  AND NOT EXISTS (
    SELECT 1 FROM public.event_tags et
    WHERE et.event_id = e.id AND et.is_primary = true
  )
ON CONFLICT (event_id, tag_id) DO NOTHING;

-- ── Step 3: Secondary tags ──────────────────────────────────────────
-- Per-event secondary inserts. is_primary defaults to false (column default).
INSERT INTO public.event_tags (event_id, tag_id, is_primary)
SELECT
  v.event_id::uuid,
  t.id,
  false
FROM (VALUES
  -- Event 01 (Fairgame & Pizza) → drinks-bars + dining-supper-clubs
  ('e1000000-0000-0000-0000-000000000001', 'drinks-bars'),
  ('e1000000-0000-0000-0000-000000000001', 'dining-supper-clubs'),
  -- Event 03 (Axe Throwing) → drinks-bars
  ('e1000000-0000-0000-0000-000000000003', 'drinks-bars'),
  -- Event 07 (Flight Club) → drinks-bars
  ('e1000000-0000-0000-0000-000000000007', 'drinks-bars'),
  -- Event 10 (Hiking Snowdonia) → sport-fitness
  ('e1000000-0000-0000-0000-000000000010', 'sport-fitness'),
  -- Event 11 (Black Tie Pall Mall) → dining-supper-clubs
  ('e1000000-0000-0000-0000-000000000011', 'dining-supper-clubs'),
  -- Event 13 (Comedy & Dinner Angel) → dining-supper-clubs
  ('e1000000-0000-0000-0000-000000000013', 'dining-supper-clubs'),
  -- Event 15 (Christmas Party Tonteria) → festivals-seasonal + drinks-bars
  ('e1000000-0000-0000-0000-000000000015', 'festivals-seasonal'),
  ('e1000000-0000-0000-0000-000000000015', 'drinks-bars'),
  -- Event 18 (Valentine's Singles) → drinks-bars
  ('e1000000-0000-0000-0000-000000000018', 'drinks-bars'),
  -- Event 20 (Skiing St Moritz) → sport-fitness
  ('e1000000-0000-0000-0000-000000000020', 'sport-fitness'),
  -- Event 22 (Mini Golf & Drinks) → drinks-bars
  ('e1000000-0000-0000-0000-000000000022', 'drinks-bars'),
  -- Event 24 (Hiking Lake District) → sport-fitness
  ('e1000000-0000-0000-0000-000000000024', 'sport-fitness'),
  -- Event 25 (Polo in the Park) → outdoor-picnics
  ('e1000000-0000-0000-0000-000000000025', 'outdoor-picnics'),
  -- Event 28 (Halloween Cubanista) → festivals-seasonal + themed-socials
  ('e1000000-0000-0000-0000-000000000028', 'festivals-seasonal'),
  ('e1000000-0000-0000-0000-000000000028', 'themed-socials'),
  -- Event 29 (Charity 80s/90s Night) → nightlife-dancing
  ('e1000000-0000-0000-0000-000000000029', 'nightlife-dancing')
) AS v(event_id, slug)
JOIN public.tags t ON t.slug = v.slug
WHERE EXISTS (
  SELECT 1 FROM public.events e
  WHERE e.id = v.event_id::uuid AND e.deleted_at IS NULL
)
ON CONFLICT (event_id, tag_id) DO NOTHING;

-- ── Step 4: Verify exactly one primary per event ────────────────────
DO $$
DECLARE
  missing_count int;
  duplicate_count int;
BEGIN
  -- Every event has at least one primary
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

  -- No event has more than one primary (the partial unique index will
  -- catch this too when created, but explicit verification gives a
  -- clearer error message during backfill).
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT event_id FROM public.event_tags WHERE is_primary = true
    GROUP BY event_id HAVING count(*) > 1
  ) AS dupes;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Backfill produced % events with multiple primary tags', duplicate_count;
  END IF;
END $$;
```

**Counts after backfill:** 33 primary `event_tags` rows + ~16 secondary
rows = ~49 total rows.

**Per-event override approach vs single-CASE:** the override list is
embedded as a `VALUES` clause for clarity (each event maps to one
slug; the join to `tags` resolves the slug to a UUID). An alternative
single-CASE on `event_id` would work but be harder to review. The
backfill is one-shot — performance isn't a concern.

**Future events added between spec sign-off and migration deploy:** if
the product owner adds new seed events that aren't in the override
list, they fall through to Step 2's default mapping. If those events
need a more specific primary, the override list above must be updated
before the migration runs.

### Bidirectional sync trigger (Migration 2)

The mechanics are documented in §Decision 5. After the Decision 4 rewrite,
the new primary-tag slugs no longer match `event_category` enum values
1:1, so the trigger needs a **static slug→enum mapping function** that
collapses 15 primary slugs into the 9 existing enum values. The mapping is
lossy (many-to-one) but acceptable because `events.category` is doomed in
Migration 4 — its purpose during the dual-write window is "best-effort
legacy display value" only.

#### Slug → enum mapping function

```sql
-- Static mapping: new primary tag slug → existing event_category enum.
-- Lossy (15 → 9). Used only during the dual-write window (Migrations 2–3);
-- becomes dead code after Migration 4 drops events.category.
CREATE OR REPLACE FUNCTION public._tag_slug_to_legacy_category(p_slug text)
RETURNS public.event_category
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN CASE p_slug
    WHEN 'drinks-bars'              THEN 'drinks'::event_category
    WHEN 'dining-supper-clubs'      THEN 'dining'::event_category
    WHEN 'activities-social-games'  THEN 'activity'::event_category
    WHEN 'nightlife-dancing'        THEN 'drinks'::event_category   -- closest existing enum
    WHEN 'live-music-gigs'          THEN 'music'::event_category
    WHEN 'theatre-comedy'           THEN 'cultural'::event_category
    WHEN 'galleries-museums'        THEN 'cultural'::event_category
    WHEN 'festivals-seasonal'       THEN 'cultural'::event_category
    WHEN 'sport-fitness'            THEN 'sport'::event_category
    WHEN 'outdoor-picnics'          THEN 'activity'::event_category
    WHEN 'weekends-travel'          THEN 'activity'::event_category
    WHEN 'themed-socials'           THEN 'drinks'::event_category   -- themed parties are typically drinks-led
    WHEN 'charity-volunteering'     THEN 'cultural'::event_category
    WHEN 'wellness-mindfulness'     THEN 'wellness'::event_category
    WHEN 'workshops-masterclasses'  THEN 'workshops'::event_category
    -- Interest-only slugs (interest-…) should never be set as primary,
    -- but defensively raise rather than coerce to a wrong enum value.
    ELSE NULL
  END;
END;
$$;
```

If the function returns NULL (i.e. the primary slug isn't in the mapping),
the event_tags-side trigger should raise rather than write a NULL category.

Note: the reverse direction (enum → slug) doesn't need a static map. The
events-side trigger picks **one canonical primary slug per enum value**
(e.g. `drinks` → `drinks-bars`); admins who want a different primary
(e.g. `nightlife-dancing` for a drinks event that's really a club night)
must set it via the new tag picker. The legacy `category` dropdown is
therefore a "coarse-grained set the rough type" tool, not a precise
re-tag tool — acceptable for the transient legacy admin path.

#### Trigger functions (pseudocode — backend-developer implements)

```sql
-- Side A: events.category UPDATE → write through to primary event_tags row.
-- Fires on UPDATE OF category.
CREATE OR REPLACE FUNCTION public._sync_primary_tag_from_category()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_canonical_slug text;
  v_tag_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;  -- cycle guard
  END IF;
  IF NEW.category = OLD.category THEN
    RETURN NEW;  -- no-op
  END IF;

  -- Pick the canonical primary slug for the new enum value.
  v_canonical_slug := CASE NEW.category::text
    WHEN 'drinks'     THEN 'drinks-bars'
    WHEN 'dining'     THEN 'dining-supper-clubs'
    WHEN 'wellness'   THEN 'wellness-mindfulness'
    WHEN 'workshops'  THEN 'workshops-masterclasses'
    WHEN 'networking' THEN 'workshops-masterclasses'  -- networking demoted; closest event home
    WHEN 'activity'   THEN 'activities-social-games'
    WHEN 'sport'      THEN 'sport-fitness'
    WHEN 'cultural'   THEN 'galleries-museums'  -- one canonical pick — admin can re-tag if wrong
    WHEN 'music'      THEN 'live-music-gigs'
  END;
  IF v_canonical_slug IS NULL THEN
    RAISE EXCEPTION 'unknown legacy category value: %', NEW.category;
  END IF;

  SELECT id INTO v_tag_id FROM public.tags WHERE slug = v_canonical_slug;
  -- Replace existing primary tag for this event.
  UPDATE public.event_tags
     SET tag_id = v_tag_id
   WHERE event_id = NEW.id AND is_primary = true;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_primary_tag_from_category
  AFTER UPDATE OF category ON public.events
  FOR EACH ROW EXECUTE FUNCTION public._sync_primary_tag_from_category();

-- Side B: event_tags primary INSERT/UPDATE → write back to events.category.
-- Fires on INSERT or UPDATE WHERE is_primary = true.
CREATE OR REPLACE FUNCTION public._sync_category_from_primary_tag()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_slug text;
  v_legacy_cat public.event_category;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;  -- cycle guard
  END IF;
  IF NEW.is_primary IS NOT TRUE THEN
    RETURN NEW;  -- only primary changes propagate
  END IF;

  SELECT slug INTO v_slug FROM public.tags WHERE id = NEW.tag_id;
  v_legacy_cat := public._tag_slug_to_legacy_category(v_slug);
  IF v_legacy_cat IS NULL THEN
    RAISE EXCEPTION 'no legacy enum mapping for primary tag slug: %', v_slug;
  END IF;

  UPDATE public.events
     SET category = v_legacy_cat
   WHERE id = NEW.event_id AND category IS DISTINCT FROM v_legacy_cat;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_category_from_primary_tag
  AFTER INSERT OR UPDATE ON public.event_tags
  FOR EACH ROW EXECUTE FUNCTION public._sync_category_from_primary_tag();
```

Both triggers fire AFTER the row change is applied to the row; both
short-circuit on `pg_trigger_depth() > 1` to break the cycle. The
`IS DISTINCT FROM` guard on Side B prevents a no-op write (and therefore
prevents needless trigger re-entry).

**Migration 4 cleanup:** `DROP TRIGGER … ON public.events`, `DROP TRIGGER
… ON public.event_tags`, `DROP FUNCTION public._sync_*`, `DROP FUNCTION
public._tag_slug_to_legacy_category`. Then drop `events.category` and
the `event_category` enum.

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

A constant for `is_primary_eligible` lives in `src/lib/constants.ts`. The
admin event-creation form reads this to populate the primary-tag picker;
the member interest picker reads the full `tags` table (active rows
only):

```ts
export const PRIMARY_ELIGIBLE_TAG_SLUGS = new Set<string>([
  'drinks-bars',
  'dining-supper-clubs',
  'activities-social-games',
  'nightlife-dancing',
  'live-music-gigs',
  'theatre-comedy',
  'galleries-museums',
  'festivals-seasonal',
  'sport-fitness',
  'outdoor-picnics',
  'weekends-travel',
  'themed-socials',
  'charity-volunteering',
  'wellness-mindfulness',
  'workshops-masterclasses',
])
// 8 interest-only slugs — interest-technology, interest-entrepreneurship,
// interest-networking, interest-photography, interest-travel,
// interest-books-literature, interest-sustainable-living, interest-film-cinema —
// are deliberately omitted. They live in the tags table but aren't
// selectable as an event's primary tag.
```

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| `authenticated` GRANT narrowing breaks an unrelated query | Medium | Backend-developer enumerates the full current column set before REVOKE; tester runs the existing profile/auth suite against the new GRANT. |
| Bidirectional sync trigger causes infinite loops | Medium | `pg_trigger_depth()` guard on both sides; tester writes a Vitest case that updates both sides and asserts no recursion. |
| Backfill of `user_interests.tag_id` leaves NULLs | Low | Migration verification step (DO $$ … RAISE EXCEPTION) fails the migration, surfacing unmapped rows immediately. The CASE expression covers all 14 INTEREST_OPTIONS values; off-list values (defensive) trigger the verification failure. |
| Multi-tag backfill produces multiple primary rows for one event | Low | Backfill verification step (Step 4 in Event-tags backfill SQL) explicitly counts events with >1 primary and raises before the partial unique index is created. The unique index then provides a permanent storage-layer guarantee. |
| Slug→enum mapping lossy collapse causes admin confusion | Low–Medium | Documented in Decision 5 caveat. Lossy by design (15 → 9, transient state); admin UI should show the new tag picker as primary, with the legacy category dropdown clearly marked "legacy — coarse-grained" or hidden entirely once the new picker ships. Disappears when Migration 4 drops `events.category`. |
| New primary-eligible tag added in future without slug→enum mapping update | Medium | Trigger raises explicit error: `'no legacy enum mapping for primary tag slug: …'`. Backend-developer must update `_tag_slug_to_legacy_category()` whenever `PRIMARY_ELIGIBLE_TAG_SLUGS` is extended (until Migration 4 ships). Tester adds a check that every entry in the constant has a non-NULL function return. |
| Per-event override list drifts as new seed events are added pre-deploy | Low | The override list (Step 1 of Event-tags backfill) is event-UUID-keyed. Any new seed event added between spec sign-off and migration deploy falls through to Step 2's default mapping. Backend-developer reviews the event list at migration write time and extends the override if needed. |
| Member discovers other-member demographics via REST | High before Migration 1; mitigated by Option A | Decision 7 Option A narrows `authenticated` GRANT in the same migration that adds the columns. |
| Privacy policy update lags the column visibility | Low (operational) | Frontend-developer ships the privacy text update in the same release as the demographics banner. Don't deploy the banner without the privacy change. |
| Gender/age forms feel intrusive — sign-up drop-off | Out of data-layer scope | UX-designer + product-owner own the banner copy. Spec recommends the post-signup banner over signup form (per PHASE-3-BACKLOG.md). |
| Two-stage drop of `events.category` (Migration 2 trigger → Migration 4 drop) leaves dual writes longer than expected | Low | Acceptable. The bidirectional trigger is cheap; if Migration 4 slips, the lossy slug→enum collapse persists but `events.category` reads remain coherent. |
| `event_tags` SELECT policy subquery hot-path performance regression on `/events` listing | Low | The `idx_events_published` partial index covers the join's filter. Tester adds an EXPLAIN check on the events listing query post-migration. |
| Members lose interest specificity after `Art & Culture`/`Jazz & Music`/`Wine & Cocktails` remap | Low (UX) | Each of these maps to a single primary tag (Decision 9 Group A). A post-migration "we updated our interest list" prompt closes the gap. Frontend-developer task; flagged in §"Questions for the product owner" (Q9). |

---

## Questions for the product owner

These are decisions where the data-layer architect can recommend a default,
but the call genuinely belongs to the product owner. **The earlier Q1
(promote `technology`/`entrepreneurship` to primary-eligible) is now
resolved by the Decision 4 revision — both demoted to interest-only.**

1. **Decision 7 Option A vs Option B for `authenticated` GRANT narrowing.**
   Spec default: Option A (narrow the GRANT in the same migration). Option
   B (rely on application-layer gating) is the path the codebase uses
   today for `phone_number`, with a known follow-up risk flagged in the
   Phase 3 backlog. Option A is more migration work but eliminates the
   risk class entirely. Product owner call: are we comfortable that
   demographic data is sensitive enough to warrant the stricter gate?

2. **Whether to expose member-set demographics in the member's own profile
   edit form, or **only** via the post-signup banner.** Spec assumes the
   profile edit form (and "Your data & privacy" download) gets the new
   fields, so members can edit later. Product owner call: are these
   fields visible-and-editable forever, or one-time-set with no edit UI?
   Spec's recommendation: visible-and-editable, because members
   genuinely change identity claims, and immutability would surprise
   people who chose `prefer_not_to_say` and later want to update. The
   admin-only visibility argument is about who *reads* the data, not
   who *writes* it.

3. **Retention rule for demographics on account deletion.** The existing
   account-deletion flow (`privacy-actions.ts`) anonymises the profile
   and hard-deletes after 30 days. The two new columns are PII and
   should be anonymised along with everything else. Spec assumes the
   backend-developer extends the existing deletion sequence to NULL out
   `gender` and `age_range` (or the SECURITY DEFINER admin function
   simply returns NULL for soft-deleted profiles). Product owner sign-off:
   confirm the same retention as other PII.

4. **Tag retirement vs deletion.** `is_active = false` is the soft-retire
   path; there's no hard-delete UI proposed here. Product owner call: do
   admins ever need a "permanently delete this tag" path, or is "make
   it inactive and forget it" sufficient? Spec assumes the latter.

5. **Member-facing interest picker — 23 tags is more than the current 14.**
   The registration Step 2 today shows 14 options as a chip grid.
   Post-migration, the canonical `tags` table contains 23 rows (15
   primary + 8 interest-only). The interest picker should show ALL of
   them so members can express preferences for primary-eligible
   categories AND interest-only signals. **Default recommendation:** show
   all 23 active tags (sorted by `sort_order`) — the chip grid scales
   fine, and members benefit from finer granularity. Product owner: confirm
   showing all 23, or want a curated subset?

6. **Migration 4 timing.** Spec recommends "after one stable release of
   Migration 3." Product owner: any preference for cadence — bundle all
   four in one PR for the data team to review together, or stage them
   across two PRs (Migrations 1+2+3 → release → Migration 4 in a
   follow-up)? **Note:** with the new 15-slug primary set diverging
   from the 9-value enum, the dual-write window relies on the lossy
   slug→enum mapping function. There's mild appeal to shortening the
   window (i.e. ship Migration 4 sooner) — but only after the
   application code has fully migrated to read tags directly.

7. **Per-event override list completeness.** The Migration 2 backfill
   embeds 22 event-UUID overrides (every cultural/sport/music event
   plus four mis-classified drinks/dining events). The remaining 11
   events fall through to a default mapping (drinks→drinks-bars,
   dining→dining-supper-clubs, etc.). Product owner: confirm that the
   audit produced exactly the 22 overrides listed, and that the 11
   default-mapped events are correctly classified (i.e. all 7
   default-mapped drinks events really do belong as `drinks-bars`
   primary; all 4 default-mapped dining events really do belong as
   `dining-supper-clubs`). If any of those 11 should also be
   reclassified, add them to the override list before the migration
   ships.

8. **Forward-planned event mapping.** The Decision 4 distribution table
   includes 12 forward-planned events. The backfill SQL only touches
   currently-seeded rows (events that exist in `public.events` at
   migration time). For forward-planned events that haven't been
   inserted yet, the admin will use the new tag picker when they
   create the event. Product owner: confirm we don't need to pre-seed
   placeholder rows — admins create future events as normal once the
   admin form has the new picker.

9. **Post-migration "your interests have been updated" prompt for
   members.** The Decision 9 remap is best-effort:
   - 6 of 14 interest values get remapped to primary-eligible tags (a
     loss of granularity for members who picked "Art & Culture" — they
     now point at `galleries-museums` only, not at theatre-comedy too).
   - 8 of 14 stay as interest-only (no UX change).
   A one-time post-migration prompt — "we've sharpened our interest
   categories; here are your current picks, want to add more?" — would
   close the gap for the affected members. Product owner call:
   - **Option A:** ship the prompt with the migration (more frontend
     work, better member experience).
   - **Option B:** don't prompt; rely on the next time the member edits
     their profile to surface the new options.
   - **Option C:** don't prompt and don't surface — accept the
     remap-loss as the migration cost.
   Spec recommendation: Option A. Cost ~half a frontend-developer day;
   benefit is members feel cared for during the change. Belongs to
   UX-designer + frontend-developer.

10. **Wellness & Mindfulness has zero past or future events.** It exists
    in the seed list per the product owner's "forward-looking" call.
    Confirm we want it active (`is_active = true`) on Day 1, or should
    it ship `is_active = false` until the first event is scheduled?
    Spec default: active — it gives admins a tag to attach to draft
    events as the wellness programme spins up. No member-facing harm
    from an empty-results-for-now category.

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
- **Task:** Member-data layer schema spec — gender + age_range on profiles, canonical 23-tag taxonomy (15 primary-eligible + 8 interest-only) replacing dual `events.category` + `user_interests.interest` vocabulary. Revised 2026-04-26 to ground the seed list in a 33-event audit + 12 forward-planned events.
- **Files changed:** `docs/member-data-layer-spec.md` (revised — Decisions 4 + 5 caveat + 8 Migration 2 intent + 9 + SQL fragments tag seed/event-tags backfill/bidirectional trigger + Type-system surface + Risk register + Questions for the product owner + this HANDOVER)
- **Migrations planned:**
  1. `add_profile_demographics` — gender + age_range enums + columns; narrow `authenticated` GRANT; SECURITY DEFINER demographics functions (Migration 1)
  2. `create_tags_and_event_tags` — tags + event_tags tables; **no enum ADD VALUE** (revised — slug→enum is now lossy and transient); seed 23 tags (15 primary + 8 interest-only); backfill event_tags using product-owner per-event override map (22 events) + default fallback (11 events) + ~16 secondary-tag rows; install bidirectional sync trigger with static slug→enum mapping function (Migration 2)
  3. `migrate_user_interests_to_tag_id` — add tag_id FK, backfill from text via the 14-value reconciliation map (6 to primary-eligible slugs, 8 to interest-only slugs), swap unique constraint, keep text column for one release (Migration 3)
  4. `drop_user_interests_interest_text` — follow-up after application code migrated (post-Migration 3)
  5. `drop_events_category_enum` — follow-up after application code migrated; drop sync trigger + slug→enum mapping function, drop column, drop enum (Migration 4)
- **Tests added:** none (architect doesn't write tests)
- **Next agent:** product owner (review the 10 questions in §"Questions for the product owner") → planner (sequence backend-developer → tester → frontend-developer for the implementation phase)
- **Risks / open questions:** the 10 product-owner questions in the dedicated section. The earlier Q1 (technology/entrepreneurship promotion) is resolved by the Decision 4 rewrite. Q1 (was Q2 — GRANT narrowing approach) remains the only migration-blocking question; Q2–Q10 can be resolved in parallel with backend-developer drafting Migrations 1–3. New Q9 (post-migration member prompt for interest re-pick) is a UX/frontend follow-up, not data-layer work.
