# AUDIT — Admin "Create new event" button regression

**Date:** 2026-04-27
**Auditor:** /auditor (read-only diagnosis pass)
**Scope:** Targeted — admin event-create flow only.
**Branch:** `main` @ `4d93517` (clean working tree, post F1b-schema + F2 hosted)

---

## TL;DR

The "Create new event" button is **not** the failing surface. The
**`/admin/events` listing page itself fails to render** because
`getAdminEvents()` was not updated alongside F1a/F1b — it returns
rows without the `primary_tag` JOIN that `EventsTable` was rewritten
to require in PR #63. The button lives on that page, so the admin
sees an error UI and never reaches the form.

The user's hypothesis (a stale `events.category` reference in the
create flow) is **not** the cause — the create path itself is clean.
This is the inverse: a missing **primary_tag** JOIN on the read path,
not a stale **category** reference on the write path.

---

## Reproducible failure mode

**Best match:** none of (a)–(d) cleanly. Closest characterisation:

> **(b′) — navigate to /admin/events itself; the listing page errors
> before the button is reachable.**

Specifically: the page is a Server Component that calls
`getAdminEvents()` and passes its result into the `EventsTable`
client component. `EventsTable` renders `event.primary_tag.label` at
two sites
([EventsTable.tsx:108](src/components/admin/EventsTable.tsx:108) desktop,
[EventsTable.tsx:205](src/components/admin/EventsTable.tsx:205) mobile).
Because `getAdminEvents` does a plain `.select('*')` on the
`event_with_stats` view — **without** the `event_tags!inner(…)` embed
that the member-facing queries use — `event.primary_tag` is
`undefined` at runtime, and the access throws:

> `TypeError: Cannot read properties of undefined (reading 'label')`

Rendering happens during server-side streaming of the Client
Component, so the error bubbles up to the closest `error.tsx`
boundary (or Next.js's default error UI). The "Create new event"
button is in the same JSX tree as the failing table, so it's never
shown.

If the admin navigates directly to `/admin/events/new` (typing the
URL or following a bookmark), the form **renders and submits
correctly** — see "Form path is clean" below.

---

## Root cause

[src/app/(admin)/admin/actions.ts:782-795](src/app/(admin)/admin/actions.ts:782)

```ts
export async function getAdminEvents() {
  const { supabase } = await requireAdmin()

  // Admin sees all events including drafts/cancelled via event_with_stats view
  // RLS allows admin to see all events (including unpublished)
  const { data, error } = await supabase
    .from('event_with_stats')
    .select('*')                                 // ← MISSING primary_tag embed
    .order('date_time', { ascending: false })

  if (error) throw new Error('Failed to fetch events')

  return (data ?? []) as EventWithStats[]        // ← cast is a lie post-F1b-app
}
```

Compare with the three member-facing reads in
[src/lib/supabase/queries/events.ts](src/lib/supabase/queries/events.ts) —
`getPublishedEvents`, `getPastEvents`, `getRelatedEvents` — all of
which do:

```ts
.from('event_with_stats')
.select(`*, ${PRIMARY_TAG_EMBED}`)               // event_tags!inner(is_primary, tags!inner(slug, label))
.eq('event_tags.is_primary', true)
…then call attachPrimaryTag(row) to lift it onto the row
```

PR #63 (F1b-app, commit 2cd9a52) flipped `EventsTable.tsx` from
`categoryLabel(event.category)` to `event.primary_tag.label` at both
chip render sites, but the matching admin query was overlooked. The
TypeScript cast `as EventWithStats[]` masked the gap — `EventWithStats`
declares `primary_tag` as non-nullable, but the runtime row from
`select('*')` has no such field.

PR #64 (F1b-schema) then dropped `events.category`. By itself that
would have been fine — the admin path no longer touches `category`
on read or write — but the stale `getAdminEvents` had been silently
broken since PR #63 landed. F1b-schema didn't *cause* the regression,
it just made the latent bug obvious by shipping at the same time the
admin demo'd the feature.

---

## Why typecheck + tests passed

- `pnpm tsc --noEmit` exits 0. The unsafe `as EventWithStats[]` cast
  on the function return is the type-system escape hatch — TS
  believes the rows have `primary_tag` because we told it they do.
- The EventsTable component test
  ([src/components/admin/__tests__/EventsTable.test.tsx:53](src/components/admin/__tests__/EventsTable.test.tsx:53))
  includes `primary_tag` in its fixture data, so it passes — but it
  validates the *component contract*, not the *query contract*. There
  is no integration test that exercises `getAdminEvents` against a
  real Supabase view, so the disconnect went undetected.
- The F1a/F1b regression guard
  ([src/lib/__tests__/event-category-migration-guard.test.ts](src/lib/__tests__/event-category-migration-guard.test.ts))
  scans for *leftover* `event.category` reads. Its `SCAN_DIRS` does
  not include `src/app/(admin)/`, and the bug is the absence of a
  JOIN, not a leftover string — it would not have caught this even
  if scope had been wider.

---

## Form path is clean (disproves the user's hypothesis)

Audited the create/update payload end-to-end against the post-F1b
schema. **No stale `category` references.**

1. **EventForm** ([src/components/admin/EventForm.tsx](src/components/admin/EventForm.tsx))
   submits via `<TagPicker>`, which renders a `<input
   name="primary_tag_slug">` radio group plus a `<input
   name="secondary_tag_slugs">` hidden CSV. No `name="category"`
   anywhere.
2. **`parseEventFormData`** ([actions.ts:135-177](src/app/(admin)/admin/actions.ts:135))
   reads `primary_tag_slug` and produces the typed object — no
   `category` key.
3. **`eventFormSchema`** ([actions.ts:75-112](src/app/(admin)/admin/actions.ts:75))
   validates `primary_tag_slug` against `PRIMARY_ELIGIBLE_TAG_SLUGS`.
   The `category` field was removed in PR #64 commit 1c7a234 along
   with the `legacyCategoryForSlug()` helper call.
4. **`createEvent`** ([actions.ts:297-356](src/app/(admin)/admin/actions.ts:297))
   inserts into `events` with the post-F1b column set — no
   `category:` key in the payload.
5. **`updateEvent`** ([actions.ts:358-425](src/app/(admin)/admin/actions.ts:358))
   — same shape, no `category`.
6. **`duplicateEvent`** ([actions.ts:438-558](src/app/(admin)/admin/actions.ts:438))
   — also clean. The previous `category: source.category` line was
   removed in PR #64.
7. **`saveEventTags`** ([actions.ts:600-692](src/app/(admin)/admin/actions.ts:600))
   writes the `event_tags` rows directly — the bidirectional trigger
   that used to also keep `events.category` in sync is gone (dropped
   by Migration 20260506000001), and `saveEventTags` never wrote to
   `events.category` to begin with.

`git grep -n "category"` against the admin event surface returns
**only**:
- Comments referring to historical context (e.g. "was
  `categoryLabel(event.category)`").
- The string "main category" in user-facing helper text on
  TagPicker / EventForm — semantic English, not a column reference.
- The `Category` column header on the desktop table and the
  `Category` `<dt>` label on the mobile card — display labels, not
  column reads.

If a user types a URL like `/admin/events/new` directly, the page
renders, the form submits, the event is created, and the redirect to
`/admin/events/<uuid>` lands successfully. The flow is **intact** —
it just isn't navigable from the broken listing.

---

## Other admin surfaces — collateral check

Walked every admin Server Action in
[src/app/(admin)/admin/actions.ts](src/app/(admin)/admin/actions.ts)
that returns rows containing event data:

| Path / Action | Reads `event_with_stats`? | Reads `primary_tag`? | Status |
|---|---|---|---|
| `getAdminEvents` → `/admin/events` (list) | yes, `select('*')` no embed | **EventsTable accesses it** | **🔴 broken** |
| `getDashboardStats` → `/admin` | events for `count` only, no rows returned | no | ✓ fine |
| `getRecentActivity` → `/admin` | bookings with `event:events!…(title)` | no | ✓ fine |
| `getAdminEventById` → `/admin/events/[id]` | `events` table directly, `select('*')` | EventForm doesn't read `primary_tag` from event row (uses separate `getEventTagsForEvent`) | ✓ fine |
| `getEventBookings` → `/admin/events/[id]/bookings` | bookings only, no event row needed | no | ✓ fine |
| `getAdminMembers` → `/admin/members` | profiles, no events | no | ✓ fine |
| `getAdminReviews` → `/admin/reviews` | reviews with `event:events!…(id, slug, title)` | no | ✓ fine |
| `getNotificationHistory` → `/admin/notifications` | notifications, no events | no | ✓ fine |
| `getFailedNotifications` | notifications, no events | no | ✓ fine |
| `getDeletedAccounts` | profiles, no events | no | ✓ fine |

**Only `getAdminEvents` is affected.** Members, reviews,
notifications, dashboard, the `[id]` edit page and the `[id]/bookings`
page are all unaffected.

---

## Next steps

🔴 **Critical — fix before any further admin demo work.**

This is a **backend (data-layer) bug**. The fix belongs with
**/backend-developer**. The change is small and well-scoped:

1. Update `getAdminEvents` in
   [src/app/(admin)/admin/actions.ts:782-795](src/app/(admin)/admin/actions.ts:782)
   to embed `event_tags!inner(is_primary, tags!inner(slug, label))`,
   filter `event_tags.is_primary = true`, and lift `primary_tag`
   onto each row before returning.
2. The exact pattern to mirror is already in
   [src/lib/supabase/queries/events.ts](src/lib/supabase/queries/events.ts) —
   reuse `PRIMARY_TAG_EMBED` and `attachPrimaryTag()` from there
   (consider exporting them so the admin action can `import` rather
   than duplicate).
3. Add an integration test that calls `getAdminEvents` against a
   stubbed Supabase response shaped like the real
   `event_with_stats + JOIN` payload, asserting `primary_tag` is
   present on each returned row. This closes the test-coverage gap
   that let the regression land in PR #63.
4. Optional follow-up: extend the regression guard's `SCAN_DIRS` to
   include `src/app/(admin)/` so a future stale-reference scan
   catches admin-side oversights too. (Not required for this fix,
   but cheap insurance.)

No schema change needed. No frontend change needed (`EventsTable`
already expects `primary_tag`).

---

## HANDOVER

- **Agent:** auditor
- **Task:** Targeted audit — "Create new event" button regression diagnosis
- **Files changed:** [docs/AUDIT.md](docs/AUDIT.md) created
- **Migrations created:** none (audit only)
- **Tests added:** none (audit only)
- **Build passing:** `pnpm tsc --noEmit` exits 0 (typecheck masks the bug — see "Why typecheck + tests passed")
- **Next agent:** **/backend-developer** — single-file fix in `src/app/(admin)/admin/actions.ts`. Tell them: "Mirror the `PRIMARY_TAG_EMBED` + `attachPrimaryTag` pattern from `src/lib/supabase/queries/events.ts` into `getAdminEvents`. Add an integration test that asserts `primary_tag` is on every row returned. EventsTable already expects this shape; no UI change."
- **Risks / open questions:**
  - The `as EventWithStats[]` cast in `getAdminEvents` is what hid the bug from the type system. Consider whether the fix should also tighten this (e.g. parse-time validation or a stricter return type that surfaces the JOIN dependency in TypeScript). Not required, but worth flagging to the planner.
  - The F1a/F1b regression guard does not currently scan `src/app/(admin)/`. A future stale-reference fault here would not be caught. Cheap to widen — could be folded into the same fix PR or split off as a follow-up.
