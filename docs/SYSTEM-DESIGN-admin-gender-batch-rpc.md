# SYSTEM-DESIGN — Admin batch read of member gender (event attendees list)

**Status:** Spec for implementation. Architect output only — no application code
or migration is written here. `backend-developer` implements from this;
`tester` asserts the criteria in §7; `ux-designer` owns copy/label decisions
beyond the placement call made in §6 (this doc owns data + layout-fit only).

**Branch:** `feat/admin-gender-and-surname-validation` (already checked out —
do not create a new branch).

**Scope:** Surface each attendee's `profiles.gender` (admin-only PII) on the
admin event-bookings list (`getEventBookings` → `BookingsTable.tsx`) in BULK,
mirroring the phone-number batch-read pattern shipped in migration
`20260602000001_admin_get_user_phones_batch.sql`. `age_range` is deliberately
carried through the RPC (see §1.3) but NOT wired into the UI in this pass —
that is an explicit, separate follow-up.

**Cross-references (do not duplicate):**
- `supabase/migrations/20260503000001_add_profile_demographics.sql` — creates
  `gender`/`age_range` columns, narrows the `authenticated` GRANT, and defines
  the single-row `admin_get_demographics(uuid)` (zero production callers today).
- `supabase/migrations/20260503000002_narrow_phone_number_grant.sql` — the
  `admin_get_user_phone(uuid)` pattern this design's naming leans on.
- `supabase/migrations/20260602000001_admin_get_user_phones_batch.sql` — the
  batch pattern this design mirrors one-for-one (name shape, admin gate,
  `search_path`, GRANT, soft-delete filter, rollback shape).
- `docs/SYSTEM-DESIGN-member-phone-admin-read.md` — prior art for exactly this
  kind of batch-PII-read design; same author intent, same review bar.
- `src/app/(admin)/admin/actions.ts` — `fetchPhoneMap()` (~lines 78–113) and
  `getEventBookings()` (~lines 1622–1678), the wiring this design slots into.
- `src/components/admin/BookingsTable.tsx` — the consuming UI, `profile`
  field typed at line 51 (desktop table 208–312, mobile cards 314–440).

---

## 0. TL;DR

Add one new migration, `supabase/migrations/20260812000001_admin_get_user_demographics_batch.sql`,
defining `public.admin_get_user_demographics(target_user_ids uuid[])` —
`RETURNS TABLE (user_id uuid, gender public.gender, age_range public.age_range)`,
SECURITY DEFINER, plpgsql, `SET search_path = public` (matching, not
strengthening, its three siblings), admin-gated via the same
`RAISE EXCEPTION 'forbidden'` idiom, `GRANT EXECUTE ... TO authenticated`,
filters `deleted_at IS NULL`. Leave the existing single-row
`admin_get_demographics(uuid)` untouched (§2). Wire it into `getEventBookings`
via a new `fetchDemographicsMap()` helper that mirrors `fetchPhoneMap()`
line-for-line, called and merged right next to the existing phone call
(~line 1662). Add `gender: string | null` to `BookingsTable.tsx`'s `profile`
prop type and render it as a short label inline with the existing Mobile
field (not a new column) — see §6 for the exact label mapping and placement
rationale.

---

## 1. The new batch RPC

### 1.1 Naming decision

**Chosen name:** `public.admin_get_user_demographics(target_user_ids uuid[])`

The two admin-PII naming lineages in this codebase are currently NOT
symmetric with each other:

| Concept | Single-row (existing) | Batch (existing/new) |
|---|---|---|
| Phone | `admin_get_user_phone(uuid)` | `admin_get_user_phones(uuid[])` |
| Demographics | `admin_get_demographics(uuid)` | *(new)* |

`admin_get_demographics` (2026-05-03) omits the `_user_` infix that
`admin_get_user_phone` has; that asymmetry predates this task and is out of
scope to fix (it would mean dropping/recreating a function the static
migration-text tests in `migration-w1-demographics.test.ts` assert the exact
name of, for zero behavioural benefit — see §2).

For the NEW function, I'm matching the **more recently established, twice-
shipped, twice-tested, currently-consumed** convention — `admin_get_user_*`
— rather than inventing a third shape (`admin_get_demographics_batch`,
`admin_get_demographics_bulk`, etc.). Reasons:
1. `admin_get_user_phones` is the only batch-PII precedent that has actually
   shipped, been code-reviewed, and been consumed by a Server Action. It is
   the stronger signal of "how this project wants batch-PII RPCs to look"
   than the currently-dead `admin_get_demographics`.
2. `admin_get_user_demographics` reads unambiguously as "get [these] users'
   demographics" — no `_batch`/`_bulk` suffix needed, consistent with how
   `admin_get_user_phones` signals "batch" purely via the plural + array
   parameter, not a suffix.
3. It leaves a clean path to eventually rename `admin_get_demographics` →
   `admin_get_user_demographics_single` or similar IF a future consumer
   appears — not this PR's problem (see §2).

Rejected: `admin_get_demographics_batch(...)` — introduces a naming
convention (`_batch` suffix) that does not exist anywhere else in this
codebase's SECURITY DEFINER function set, for no benefit over pluralisation.

### 1.2 Return shape

`RETURNS TABLE (user_id uuid, gender public.gender, age_range public.age_range)`

This mirrors `admin_get_demographics(uuid)`'s return shape (`gender,
age_range`) one-for-one, exactly the same way `admin_get_user_phones`
mirrors `admin_get_user_phone`'s single-column return shape. `age_range`
comes along for free at zero extra migration cost, even though this task's
UI wiring (§5, §6) only consumes `gender`. Rationale: if `age_range` is
needed later (a plausible near-term ask given it's the sibling column, same
banner, same lawful-basis note in 20260503000001), no second migration is
needed — only a JS-side change to `fetchDemographicsMap()`'s return type and
a new `BookingsTable` field. This is a "pay it forward once" call by the
architect, not scope creep in the SQL: the RPC costs nothing extra to define
correctly the first time.

### 1.3 Exact SQL

```sql
-- ── SECURITY DEFINER: admin_get_user_demographics(target_user_ids uuid[]) ──
--
-- Batch sibling of admin_get_demographics(uuid) (20260503000001), named to
-- match the more recently established admin_get_user_phone(s) lineage
-- (20260503000002 / 20260602000001) — see migration header for the naming
-- rationale. Mirrors admin_get_user_phones(uuid[]) one-for-one: plpgsql,
-- explicit admin role check on the caller's auth.uid(), RAISE EXCEPTION
-- 'forbidden' for non-admins (same message string), deleted_at IS NULL
-- filter, alias `p.` to disambiguate OUT-parameter names from table columns.

CREATE OR REPLACE FUNCTION public.admin_get_user_demographics(target_user_ids uuid[])
RETURNS TABLE (user_id uuid, gender public.gender, age_range public.age_range)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT p.id, p.gender, p.age_range
  FROM public.profiles p
  WHERE p.id = ANY(target_user_ids)
    AND p.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_demographics(uuid[]) TO authenticated;
```

Note the `SELECT p.id, p.gender, p.age_range` — `p.id` is returned to
populate the `user_id` OUT parameter (identical idiom to
`admin_get_user_phones`'s `SELECT p.id, p.phone_number`; Postgres binds
positionally into the `RETURNS TABLE` list, not by name, so `p.id` correctly
lands in the `user_id` slot).

### 1.4 `search_path` decision

`SET search_path = public` — exactly matches all three siblings
(`get_my_demographics`, `admin_get_demographics`, `admin_get_user_phone`,
`admin_get_user_phones`). Per MEMORY.md ("SECURITY DEFINER search_path
hardening"), the stricter `public, pg_catalog` form used by the reaper
function is a deliberate future retrofit PR that moves ALL SECURITY DEFINER
functions together. Introducing the stricter form on only this one function
here would fragment the pattern exactly as
`20260602000001_admin_get_user_phones_batch.sql`'s own header warns against
doing. Do not deviate.

### 1.5 Migration filename

`supabase/migrations/20260812000001_admin_get_user_demographics_batch.sql`
(next in sequence after `20260808000003_admin_reinstate_cancelled_booking_rpcs.sql`;
today's date per session context is 2026-08-12).

### 1.6 Migration header requirements

The migration file's header comment block must include, mirroring
`20260602000001`'s structure:
- **Why now** — same N+1 rationale as phones: the admin event-bookings list
  needs bulk gender for every attendee; the only existing primitive
  (`admin_get_demographics`) is single-row and would create an N+1 round-trip
  storm.
- **Pattern source** — cites `admin_get_user_phones` explicitly as the
  mirrored precedent (not `admin_get_demographics`, which is the same-shape
  sibling but the wrong naming lineage per §1.1).
- **Anon-visibility decision** — see §4 below (verbatim text to use).
- **search_path decision** — verbatim justification from §1.4.
- **Soft-delete filter** — same note as phones: a booking can reference a
  soft-deleted profile; the function returns no row for it, callers must
  build a `Map` with a `?? null` fallback and never zip-by-index.
- **Safety / blast radius** — catalog-only operation (CREATE OR REPLACE +
  GRANT), no table rewrite, no row scan, no DROP/TRUNCATE/DELETE.
- **Rollback** — `DROP FUNCTION IF EXISTS public.admin_get_user_demographics(uuid[]);`
  No data loss; `admin_get_demographics` (single-row) remains as the
  fallback read path.
- **Prod apply step flag** — the standard MEMORY.md reminder that CI only
  applies to local Supabase; a human must run
  `supabase db push --include-all --linked` after merge.

---

## 2. Disposition of the old single-user `admin_get_demographics(uuid)`

**Decision: leave it alone. Do not drop, do not mark deprecated in SQL
comments beyond a one-line pointer to the new batch function.**

Evidence gathered before deciding:
- `grep` across `src/` confirms `admin_get_demographics` has **zero**
  production callers — no Server Action, no component, no query helper
  invokes `supabase.rpc('admin_get_demographics', ...)` anywhere.
- Two test files reference the string `admin_get_demographics`:
  - `src/lib/supabase/__tests__/migration-w1-demographics.test.ts` — reads
    the **migration file's raw SQL text** (via `readFileSync` on
    `20260503000001_add_profile_demographics.sql`, a fixed path) and asserts
    regex shapes (SECURITY DEFINER present, parameter named
    `target_user_id`, RAISE EXCEPTION present). These are static text
    assertions against an already-applied, unedited migration file — they do
    NOT call the live RPC (the DB-integration equivalents are `it.skip(...)`
    with `// TODO(W4-docker)` markers, not live). Leaving the function
    defined and un-migrated keeps these tests green with zero changes
    required.
  - `src/app/(admin)/admin/__tests__/actions-get-members.test.ts` — mentions
    `admin_get_demographics` only in an error-message string / comment
    listing the family of DEFINER helpers available for admin PII reads. Not
    a functional dependency.
- Direct precedent: when `admin_get_user_phones` (batch) shipped in
  `20260602000001`, the single-row `admin_get_user_phone` was explicitly
  **kept**, per that migration's own rollback note: *"the singular
  `admin_get_user_phone` remains."* Dropping the single-row sibling was
  never on the table for phone; there is no reason to treat gender/
  demographics differently.

**Why not drop:** dropping a function with zero callers is technically safe,
but (a) it's a needless DDL operation and PR-review surface for a
zero-benefit change, (b) it risks invalidating the static migration-text
tests' fixed-path assumptions if a future engineer conflates "drop the live
function" with "edit the historical migration file" (the latter is
forbidden — CLAUDE.md: never delete/modify applied migration files), and
(c) `admin_get_demographics` remains a legitimate, correctly-gated
single-row read primitive that a future single-attendee detail view (e.g. an
admin "member detail" drawer) could reach for instead of pulling in the
batch function for one row. Keeping both mirrors the phone pair exactly.

**Action for `backend-developer`:** none required on
`admin_get_demographics` itself. Optionally add a one-line comment to the
NEW migration's header noting "single-row equivalent:
`admin_get_demographics(uuid)`, 20260503000001, unchanged" for discoverability —
not required, but cheap.

---

## 3. GRANT statements

Exactly one GRANT, mirroring the batch phone RPC's grant exactly (same
target role, same idempotent form):

```sql
GRANT EXECUTE ON FUNCTION public.admin_get_user_demographics(uuid[]) TO authenticated;
```

No changes to any table-level GRANT (`profiles.gender`/`profiles.age_range`
were already omitted from the `authenticated` allow-list in
`20260503000001` — see that migration's §3 GRANT block, lines 121–157 —
and remain so). No `anon` grant, on either the function or any column — the
in-body admin gate is the only authorisation boundary, exactly as for the
phone RPCs; the GRANT to `authenticated` merely allows *invocation*, not
data access (non-admin authenticated callers get `RAISE EXCEPTION
'forbidden'`, never rows).

---

## 4. Anon-visibility header comment (verbatim text for the migration)

Per CLAUDE.md's rule ("New column on `public.profiles`? Make an explicit
anon-visibility decision"): **this migration adds a FUNCTION, not a column.**
`gender` and `age_range` already exist and their anon-visibility was already
decided — admin-only, explicitly excluded from both the `anon` and
`authenticated` GRANT allow-lists — in migration `20260503000001` (see that
file's own "Anon-visibility decision" header, lines 24–27) and reaffirmed
untouched by `20260503000002`. This migration changes nothing about either
GRANT allow-list; it only adds one new admin-gated SECURITY DEFINER
function. Use this exact comment block in the new migration:

```sql
-- ── Anon-visibility decision ───────────────────────────────────────────────
-- NO CHANGE to any table GRANT. This migration adds a FUNCTION, not a new
-- column — `gender` and `age_range` already exist on public.profiles and
-- their anon-visibility was already decided (admin-only; excluded from both
-- the `anon` and `authenticated` column allow-lists) in migration
-- 20260503000001. That decision is unchanged here. The ONLY new exposure is
-- this admin-gated SECURITY DEFINER function; anon and non-admin
-- `authenticated` callers receive 'forbidden', never data — same posture as
-- admin_get_user_phones (20260602000001).
```

---

## 5. `getEventBookings` wiring contract (`src/app/(admin)/admin/actions.ts`)

### 5.1 New helper: `fetchDemographicsMap()`

Add immediately after `fetchPhoneMap()` (which ends at line 113, right
before `requireAdmin()` at line 115). Same shape, same de-dupe, same
`?? null` fallback discipline, same single-round-trip guarantee:

```ts
/**
 * Batch-fetches member gender (admin-only PII) via the
 * `admin_get_user_demographics()` SECURITY DEFINER RPC and returns a
 * Map<user_id, gender>.
 *
 * `gender` was excluded from the `authenticated` SELECT GRANT on
 * `public.profiles` from the moment the column was introduced
 * (20260503000001), so it can NOT be read through a `.select()` — the RPC's
 * in-body admin gate is the authorisation boundary. Callers pass the
 * user-scoped client from `requireAdmin()` (the RPC carries its own gate; no
 * service-role needed) and merge the result by id with a `?? null` fallback
 * — never assume every input id yields a row (soft-deleted or
 * gender-unset members are absent / null). Exactly ONE RPC round-trip; ids
 * are de-duped first.
 *
 * The RPC also returns `age_range`, which is deliberately NOT surfaced here
 * — no consumer needs it yet (SYSTEM-DESIGN-admin-gender-batch-rpc.md §1.2).
 * Extending this map to a richer value type is a same-shape follow-up.
 */
async function fetchDemographicsMap(
  supabase: Awaited<ReturnType<typeof requireAdmin>>['supabase'],
  userIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (userIds.length === 0) return map

  const unique = [...new Set(userIds)]
  const { data, error } = await supabase.rpc('admin_get_user_demographics', {
    target_user_ids: unique,
  })

  if (error) {
    throw new Error(`Failed to fetch member demographics: ${error.message}`)
  }

  for (const row of (data ?? []) as Array<{
    user_id: string
    gender: string | null
    age_range: string | null
  }>) {
    map.set(row.user_id, row.gender ?? null)
  }

  return map
}
```

### 5.2 Call site — `getEventBookings` (~lines 1622–1678)

Insert the call and merge immediately adjacent to the existing phone call,
so the diff reads as "the same pattern, twice" — minimal cognitive load for
review:

```ts
  // One batch RPC for every distinct attendee's phone — no N+1.
  const profileIds = rows
    .map((b) => extractField<{ id: string }>(b.profile, 'id'))
    .filter((id): id is string => typeof id === 'string')
  const phoneMap = await fetchPhoneMap(supabase, profileIds)
  const genderMap = await fetchDemographicsMap(supabase, profileIds)   // NEW

  return rows.map((b) => {
    const profile = extractJoin<{
      id: string
      full_name: string
      email: string
      avatar_url: string | null
    }>(b.profile)
    return {
      ...b,
      profile: profile
        ? {
            ...profile,
            phone_number: phoneMap.get(profile.id) ?? null,
            gender: genderMap.get(profile.id) ?? null,        // NEW
          }
        : null,
    }
  })
```

`profileIds` is computed once and reused for both maps — no second pass
over `rows`, no second de-dupe (each helper de-dupes internally, matching
existing `fetchPhoneMap` behaviour, so this is safe and consistent even
though technically redundant per-call; do not "optimise" this into a shared
de-duped array without also touching `fetchPhoneMap`'s existing contract —
out of scope for this change).

### 5.3 Type change — `AdminEventBooking` (`src/types/index.ts` ~line 396–399)

```ts
  profile: Pick<
    Profile,
    'id' | 'full_name' | 'email' | 'avatar_url' | 'phone_number'
  > | null
```

becomes:

```ts
  profile: Pick<
    Profile,
    'id' | 'full_name' | 'email' | 'avatar_url' | 'phone_number' | 'gender'
  > | null
```

This requires `Profile` (the base type, defined earlier in the same file)
to already have a `gender` field with a matching type — confirm during
implementation whether `Profile.gender` exists and is typed as the
`public.gender` enum's string-literal union (`'female' | 'male' |
'non_binary' | 'prefer_not_to_say'`) or a bare `string | null`. If
`Profile.gender` does not yet exist on the base type, `backend-developer`
must add it there first (following the same doc-comment convention as the
`phone_number` field at line ~365, i.e. explicitly noting it's PII merged
via RPC, never selected). Do NOT loosen `AdminEventBooking.profile.gender`
to `string | null` if `Profile.gender` is a narrower enum union — keep the
`Pick<>` faithful to the base type.

**Do not scope-creep this into `getAdminMembers`, `exportEventAttendeesCSV`,
or the other two `fetchPhoneMap` call sites** (lines ~2114, ~2203) in this
change. This spec is scoped to the event-bookings list only, per the task.
Those are separate, same-shaped follow-ups if/when gender is needed there
too — flag to the planner rather than doing opportunistically here, since
each surface has its own layout-fit question (§6 applies specifically to
`BookingsTable.tsx`'s known-tight mobile width; the members table and CSV
export have different constraints that haven't been reviewed).

---

## 6. Frontend field + placement — `BookingsTable.tsx`

### 6.1 Type change (line 51)

```ts
  profile: { id: string; full_name: string; email: string; avatar_url: string | null; phone_number: string | null } | null
```

becomes:

```ts
  profile: { id: string; full_name: string; email: string; avatar_url: string | null; phone_number: string | null; gender: string | null } | null
```

Extend the doc comment immediately above (lines 48–50) with a matching
sentence for gender, mirroring the existing phone comment's wording:

```ts
  // gender is admin-only PII merged server-side via the
  // admin_get_user_demographics() RPC (never part of the .select()); null
  // when the member never completed the demographics banner or their
  // profile was soft-deleted.
```

### 6.2 Placement decision

**Do not add a new table column.** Evidence from the current layout
(read in full before deciding):

- **Desktop table** (lines 208–312) already has 8 columns, two of which
  (`Mobile`, `Waitlist #`) are hidden below `lg:` (`hidden lg:table-cell` at
  lines 214 and 218) — i.e. the table is already tight enough at `md`–`lg`
  widths that two columns are deliberately dropped. Adding a 9th always-
  visible column would push out either `Payment` or `Booked`, both of which
  are operationally more load-bearing than gender for an admin scanning a
  bookings list. Adding it as ANOTHER `hidden lg:table-cell` column is
  viable but fragments gender across two different visual treatments
  (desktop column vs. mobile card field) for no layout benefit — the
  simpler move is co-locating it with phone in both views (see below).
- **Mobile cards** (lines 314–440) use a `<dl>` body (lines 377–408) with
  `Mobile`, `Payment` (conditional), `Booked`, `Waitlist #` (conditional) as
  label/value pairs — this is the layout the task's 375px constraint bites
  hardest on, and it already comfortably fits 2–4 rows per card. One more
  `<dt>`/`<dd>` pair fits without crowding.

**Recommendation: render gender as a value fragment appended next to
`phone_number` inside the existing Mobile field**, not a new `<dt>` row and
not a new desktop column. Concretely:

- **Desktop table**, inside the existing `hidden lg:table-cell` Mobile `<td>`
  (lines 263–268): render gender as a small muted suffix next to
  `MobilePhoneValue`, e.g. a `<span className="text-xs text-text-tertiary ml-1">(F)</span>`
  pattern — short-code form (see §6.3), only rendered when
  `profile?.gender` is non-null (never render a placeholder dash for gender
  specifically — absence should be silent, not add visual noise, since most
  rows may have skipped the demographics banner).
- **Mobile card**, inside the existing Mobile `<dd>` (lines 379–387): same
  short-code suffix appended after `MobilePhoneValue`.

This keeps the column/row count identical in both layouts — zero risk of
breaking the existing `hidden lg:table-cell` responsive contract or the
`<dl>` row rhythm, and keeps the diff small (append-only inside two existing
JSX blocks, not new blocks).

**Do NOT hide gender behind the same `hidden lg:table-cell` breakpoint as
the Mobile phone value if the two are visually combined** — since it's
literally sharing the same table cell as phone, it automatically inherits
phone's existing responsive visibility with zero extra CSS. This is a
free consequence of "attach to phone" rather than "new independent field."

### 6.3 Label form: short code vs. full label

**Decision: short code**, not the full label ("Non-binary", "Prefer not to
say"), given the placement chosen above (inline suffix next to phone, not
its own row with room for a full word):

| `gender` enum value | Rendered short code |
|---|---|
| `female` | `F` |
| `male` | `M` |
| `non_binary` | `NB` |
| `prefer_not_to_say` | `—` (or omit entirely — see below) |
| `null` | *(render nothing — no placeholder)* |

For `prefer_not_to_say`, I recommend rendering nothing (same as `null`)
rather than a code, since the two cases carry the same actionable meaning
for the admin's event-mix use case ("no usable data point") and a `—` next
to a phone number reads as a data-quality error rather than an intentional
member choice. This is a labelling/copy call at the boundary of architect
scope — `ux-designer` should confirm the exact code letters and the
`prefer_not_to_say` treatment (blank vs. `—` vs. some other glyph) before
`frontend-developer` implements; I'm flagging the layout-fit constraint
(short code only, inline placement) as the hard architectural boundary, not
the exact letters.

**Full labels ("Female", "Male", "Non-binary") should NOT be used inline** —
at 375px, `MobilePhoneValue` already renders a formatted UK mobile number
(11–13 characters) plus its own reveal/redact affordance; appending
" (Non-binary)" would wrap or truncate on many real device widths. If a
future admin surface wants full labels (e.g. a CSV export column, which has
no width constraint), that's a separate decision for that surface — flag to
`ux-designer`/`backend-developer` rather than assumed here.

---

## 7. Security test cases for `tester`

All cases below should be authored as the DB-integration layer already
established in `migration-w1-demographics.test.ts` (currently `it.skip(...)`
with `// TODO(W4-docker)` markers pending a local Supabase stack) — mirror
that file's existing skip/marker convention for consistency, plus static
migration-text assertions that run without Docker today (mirroring the
existing `admin_get_demographics`/`admin_get_user_phone` regex assertions in
the same file, lines ~189–291).

**Static (run without Docker, today):**
1. Migration text contains `SECURITY DEFINER` and `SET search_path = public`
   for `admin_get_user_demographics`.
2. Migration text's admin-gate block matches the exact `RAISE EXCEPTION
   'forbidden'` idiom (regex-shape assertion, same style as the existing
   `admin_get_user_phone`/`admin_get_demographics` checks).
3. Migration text's function parameter is named `target_user_ids` (plural,
   `uuid[]`) — guards against an accidental single-uuid signature drifting
   in during a future edit.
4. Migration text's `GRANT EXECUTE` targets `authenticated`, not `anon` and
   not `PUBLIC`.
5. Cross-cutting audit (mirroring the existing `select('*')` scan in the
   same file): confirm no `src/` file selects `gender` or `age_range`
   directly via `.from('profiles').select(...)` on the user-scoped client
   (only the admin client / the new RPC may touch these columns).

**DB-integration (skip-marked until Docker/local Supabase available, per
existing file convention):**
6. **Unauthenticated caller** — calling `admin_get_user_demographics` with
   no session (anon key, no `auth.uid()`) raises `forbidden` (not silently
   returns zero rows — `auth.uid()` is NULL, but the `NOT EXISTS` check
   still evaluates to true for a NULL id since no profile row has `id =
   NULL`, so the RAISE fires; confirm this exact behaviour, since it
   differs from `get_my_phone()`'s NULL-tolerant self-read pattern).
7. **Non-admin authenticated caller** — a member with `role != 'admin'`
   calling with a valid target array raises `forbidden`, even for their own
   `user_id` in the array (self-inclusion does not bypass the gate — this
   RPC is admin-only, unlike `get_my_demographics()`).
8. **Admin caller, real attendee list** — an admin calling with 3–5 real
   attendee ids for an event returns one row per matched, non-deleted
   profile, correct `gender`/`age_range` values, no row for ids not present
   in `profiles`.
9. **Empty array input** — `target_user_ids = ARRAY[]::uuid[]` returns zero
   rows without erroring (both for admin and non-admin callers — non-admin
   should STILL raise `forbidden` even with an empty array, since the gate
   check happens before the array is consulted; confirm the gate fires
   before, not after, evaluating an empty result set).
10. **IDs not present in `profiles`** (e.g. a random UUID with no matching
    row, or a genuinely soft-deleted profile's id) — returns no row for that
    id specifically, while still returning rows for the OTHER valid ids in
    the same call (partial-match behaviour, matching `admin_get_user_phones`
    precedent).
11. **Mixed valid/soft-deleted ids in one call** — confirms the
    `deleted_at IS NULL` filter excludes soft-deleted profiles row-by-row,
    not by failing the whole call.
12. **JS-wiring test** (mocks, same layer-3 style as the existing phone
    tests) — `getEventBookings` merges `gender` onto each booking's
    `profile` object correctly when `fetchDemographicsMap` returns a
    partial map (some attendee ids missing → `null`, not `undefined` or a
    thrown error).

