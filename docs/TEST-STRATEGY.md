# Test Strategy — The Social Seen
**Date:** 2026-04-11  
**Author:** /architect  
**Status:** Approved for implementation  

---

## 1. The Testing Pyramid — Where to Draw Each Line

This is a demo build. The goal is maximum confidence per test written, not 100% coverage.

```
        ┌────────────────────────────────────┐
        │          E2E (Playwright)          │  ← 0 tests today. Add 2 critical paths ONLY.
        │     booking flow · registration    │    Cost: high. Skip for initial demo sign-off.
        ├────────────────────────────────────┤
        │        Integration (Vitest)        │  ← 0 tests today. Add for RLS-enforced paths.
        │   real Supabase local · no mocks   │    Cost: medium. 1 batch of targeted tests.
        ├────────────────────────────────────┤
        │           Unit (Vitest)            │  ← 190 tests today. Primary layer. Keep going.
        │   mocked Supabase · pure logic     │    Cost: low. Fills all C/I gaps now.
        └────────────────────────────────────┘
```

### Unit tests — write these
**Use when:** The correctness of the function can be verified by inspecting its inputs, outputs, and which Supabase methods it called — without needing RLS.

**Applies to:** All Server Actions (auth guards, input validation, DB mutation logic), query functions (correct filters applied), pure utilities (splitBookings, dates).

**Mock boundary:** Mock `createServerClient`. Never mock Zod, never mock dates unless testing timezone behaviour.

**Pattern already established:** `mockAdminWithSequence` in `admin/actions.test.ts` — reuse it.

### Integration tests — write these for one specific scenario only
**Use when:** The test is verifying RLS policy enforcement, not just that the Server Action calls `.eq('user_id', uid)`. The distinction: RLS is a PostgreSQL-layer guarantee. A unit test that mocks Supabase only proves the application code is correct; it cannot prove the DB rejects a cross-user query.

**Applies to:** `cancelBooking` cross-user rejection, `submitReview` confirmed-booking requirement, admin-only table writes. These are the exact scenarios where a mock gives false confidence.

**Tooling:** Supabase CLI local dev (`supabase start`). Connect Vitest to local Supabase via real env vars in a separate `vitest.integration.config.ts`. **Do not mix with unit tests.** These run only in CI pre-merge, not on every `pnpm test`.

**Pragmatic limit for demo:** Skip the integration layer entirely until after co-founder sign-off. Flag the risk clearly. The unit tests cover the application-layer checks; the migration files contain the RLS policies. Both need human review before production.

### E2E tests — defer entirely
**Use when:** You need confidence that the full browser → Next.js → Supabase → browser round-trip works for a critical path.

**Decision:** Skip for demo sign-off. The co-founder is evaluating product, not test infrastructure. Add two Playwright tests post-demo: (1) sign-up → save interests → view events, (2) book event → view ticket.

---

## 2. Testing Patterns — Standardise These

All new unit tests must follow patterns already in the codebase. No new patterns should be introduced.

### Pattern A: `mockAdminWithSequence` (already exists — reuse everywhere)
Location: `src/app/(admin)/admin/__tests__/actions.test.ts:76`

```
Call 0  →  requireAdmin → profiles.role = 'admin'
Call 1  →  responses[0]
Call 2  →  responses[1]
...
```

For functions that make N from() calls after requireAdmin, pass N response objects. The last response repeats for any overflow.

**Use for:** All admin actions (cancelEvent, updateEvent, upsertEventInclusions, upsertEventHosts, exportEventAttendeesCSV, getMonthlyBookings, getRecentActivity, getAdminReviews).

### Pattern B: `authenticateUser` + manual `mockFrom` sequencing (already exists)
Location: `src/app/events/[slug]/__tests__/actions.test.ts`

For non-admin actions that make 2–3 sequential from() calls (fetch booking → fetch event → update), use a `callCount` closure to return different chains per call. This pattern is established — reuse it, don't invent a new abstraction.

### Pattern C: `@vitest-environment jsdom` + RTL (already exists)
Location: every `src/components/**/__tests__/*.test.tsx`

Pragma goes on line 1. Use `render()` + `screen` + `userEvent` for interactions. Do not use `fireEvent` — `userEvent` is more realistic.

**Use for:** EventsPageClient filter logic, EditProfileForm field interactions.

### Pattern D: Pure function test (no mocks needed)
For `splitBookings()`, `getMonthlyBookings` grouping logic: just call the function with constructed input and assert on output. No Supabase mock required.

### What NOT to do
- Do not introduce a shared `test-utils.ts` file of helpers. Copy the 15-line mock setup into each test file. Duplication is fine; shared test infrastructure creates coupling.
- Do not test that `revalidatePath` was called. It's always mocked, and testing mock calls adds noise.
- Do not mock `zod`. Test validation failures by passing bad input to the real action.

---

## 3. Prioritised Test Backlog — 4 Batches

### Batch T-1: Critical admin write guards (C-1 to C-3)
**Goal:** Verify `requireAdmin()` fires correctly on every untested write action. Auth bypass is the highest-risk gap.

Files to create: `src/app/(admin)/admin/__tests__/actions-write.test.ts`  
(Append to existing `actions.test.ts` alternatively — your call, but keep file under 600 lines.)

| # | Test | Function | What to assert |
|---|------|----------|----------------|
| T1-1 | `cancelEvent` — unauthenticated | `cancelEvent` | `requireAdmin()` throws → error bubbles |
| T1-2 | `cancelEvent` — non-admin member | `cancelEvent` | `requireAdmin()` throws for `role = 'member'` |
| T1-3 | `cancelEvent` — cancels successfully | `cancelEvent` | `is_cancelled: true` update called, success returned |
| T1-4 | `cancelEvent` — event not found | `cancelEvent` | returns `{ error: 'Event not found' }` |
| T1-5 | `upsertEventInclusions` — non-admin | `upsertEventInclusions` | throws for member role |
| T1-6 | `upsertEventInclusions` — deletes + inserts | `upsertEventInclusions` | delete called with event_id, insert called with mapped rows |
| T1-7 | `upsertEventHosts` — deletes + inserts | `upsertEventHosts` | delete called, insert called with `role_label: 'Host'` |

**Pattern:** `mockAdminWithSequence`. For auth guard tests, use the existing parametric loop already in `Admin auth guards` describe block — extend the function list.

---

### Batch T-2: CSV injection + query correctness (C-4, C-5, I-5)
**Goal:** Close the exportEventAttendeesCSV injection gap; add getReviewableEvents and gallery query tests.

Files to create:
- `src/app/(admin)/__tests__/csv-attendees.test.ts`
- `src/lib/supabase/queries/__tests__/reviews.test.ts`
- `src/lib/supabase/queries/__tests__/gallery.test.ts`

| # | Test | Function | What to assert |
|---|------|----------|----------------|
| T2-1 | Attendee CSV — formula injection in name | `exportEventAttendeesCSV` | `=CMD(` prefixed with `'` |
| T2-2 | Attendee CSV — formula injection in email | `exportEventAttendeesCSV` | `+attacker@...` prefixed with `'` |
| T2-3 | Attendee CSV — correct header | `exportEventAttendeesCSV` | `Name,Email,Booked At` on line 1 |
| T2-4 | Attendee CSV — non-admin rejected | `exportEventAttendeesCSV` | throws for member |
| T2-5 | `getReviewableEvents` — unauth returns `[]` | `getReviewableEvents` | early return on `user: null` |
| T2-6 | `getReviewableEvents` — filters out already-reviewed | `getReviewableEvents` | event in `reviewed_ids` set excluded from result |
| T2-7 | `getReviewableEvents` — returns past events only | `getReviewableEvents` | events with `date_time < now` included |
| T2-8 | `getAllGalleryPhotos` — error returns `[]` | `getAllGalleryPhotos` | error path returns empty array |
| T2-9 | `getGalleryEvents` — maps id/title/slug only | `getGalleryEvents` | strips `event_photos` join from result |

**Pattern for T2-1 to T2-4:** `mockAdminWithSequence` — call 0 returns `{ role: 'admin' }`, call 1 returns attendee rows.  
**Pattern for T2-5 to T2-7:** Use `createQueryBuilder` from `src/lib/supabase/queries/__tests__/events.test.ts` — copy the builder factory into the reviews test file.

---

### Batch T-3: `updateEvent`, dashboard queries, `splitBookings` (C-1, I-1, I-3, I-4, I-6)
**Goal:** Cover the last critical action gap and the two dashboard queries that power admin decision-making.

Files:
- Append to `src/app/(admin)/admin/__tests__/actions.test.ts` (or create `actions-update.test.ts`)
- Create `src/lib/utils/__tests__/bookings.test.ts`

| # | Test | Function | What to assert |
|---|------|----------|----------------|
| T3-1 | `updateEvent` — non-admin rejected | `updateEvent` | throws for member role |
| T3-2 | `updateEvent` — unauthenticated rejected | `updateEvent` | throws when no user |
| T3-3 | `updateEvent` — Zod: missing title | `updateEvent` | returns `{ error: 'Title must be at least 3 characters' }` |
| T3-4 | `updateEvent` — price stored as pence | `updateEvent` | update called with `price: 3500` when form has `price: '35'` |
| T3-5 | `getMonthlyBookings` — pre-fills 12 months | `getMonthlyBookings` | returned array has exactly 12 entries, each with `month` and `count` |
| T3-6 | `getMonthlyBookings` — non-admin rejected | `getMonthlyBookings` | throws for member |
| T3-7 | `getAdminReviews` — filter='visible' applies eq | `getAdminReviews` | `.eq('is_visible', true)` called |
| T3-8 | `getAdminReviews` — filter='hidden' applies eq | `getAdminReviews` | `.eq('is_visible', false)` called |
| T3-9 | `splitBookings` — confirmed future → upcoming | `splitBookings` | confirmed + future date_time in `upcoming` |
| T3-10 | `splitBookings` — confirmed past → past | `splitBookings` | confirmed + past date_time in `past` |
| T3-11 | `splitBookings` — no_show → past | `splitBookings` | no_show status in `past` regardless of date |
| T3-12 | `splitBookings` — waitlisted → waitlisted | `splitBookings` | waitlisted status always in `waitlisted` |
| T3-13 | `splitBookings` — cancelled excluded everywhere | `splitBookings` | cancelled status absent from all three lists |

**Pattern for T3-1 to T3-8:** `mockAdminWithSequence` / `mockMemberUser`.  
**Pattern for T3-9 to T3-13:** No mock needed. Construct `BookingWithEvent` objects with controlled `date_time` (use a date 10 years in the future for "upcoming", 10 years in the past for "past"). Call `splitBookings()` directly.

**Note on `updateEvent`:** The function signature is `updateEvent(eventId: string, formData: FormData)`. Use the existing `makeEventFormData()` helper from `actions.test.ts` — don't rewrite it.

---

### Batch T-4: UI interaction tests (I-7, I-8)
**Goal:** Cover the two most demo-visible interactive UI components — the events filter page and the edit profile form.

Files:
- Create `src/components/events/__tests__/EventsPageClient.test.tsx`
- Create `src/components/profile/__tests__/EditProfileForm.test.tsx`

**Vitest environment:** Both files need `// @vitest-environment jsdom` on line 1.

| # | Test | Component | What to assert |
|---|------|-----------|----------------|
| T4-1 | Shows all events when no filter active | `EventsPageClient` | all event titles visible |
| T4-2 | Category filter hides non-matching events | `EventsPageClient` | click "Dining", only dining events visible |
| T4-3 | Price filter "Free" hides paid events | `EventsPageClient` | click "Free", event with price > 0 not in document |
| T4-4 | Price filter "Paid" hides free events | `EventsPageClient` | click "Paid", event with price = 0 not in document |
| T4-5 | Empty state shown when no events match filter | `EventsPageClient` | filter to a category with no events, empty state text visible |
| T4-6 | `EditProfileForm` — renders existing values | `EditProfileForm` | name field shows user's current full_name |
| T4-7 | `EditProfileForm` — validation error shown | `EditProfileForm` | clear name, submit, see "Name is required" |

**Pattern for T4-1 to T4-5:** Render `EventsPageClient` with controlled `events` prop (2 dining events, 1 free drinks event, 1 paid cultural event). Use `userEvent.click()` to interact with filter buttons. Assert on `screen.getByText` / `screen.queryByText`.

**Pattern for T4-6 to T4-7:** Render `EditProfileForm` with a mock profile prop. For T4-7, mock the `updateProfile` server action via `vi.mock('@/app/(member)/profile/actions', ...)`.

**Skip:** Lightbox keyboard/swipe (I-10), NotificationForm (I-9) — these are lower confidence-per-effort for demo purposes. Flag for post-demo.

---

## 4. What to Skip

These are explicitly out of scope for the current phase:

| Skipped | Reason |
|---------|--------|
| 24 display-only components (AboutSection, StarRating, ReviewCard, etc.) | No business logic. Regressions are visually obvious. |
| `signOut` | One-liner. No decision logic. |
| `getAdminEvents`, `getAdminEventById`, `getEventBookings`, `getNotificationHistory` | Read-only, no side effects. |
| `ThemeProvider`, `SkeletonCard`, `cn()` | Infrastructure/CSS. |
| Integration tests (real Supabase) | Post-demo. Flag RLS reliance in each relevant test with a comment. |
| Playwright E2E | Post-demo. Two critical paths queued: sign-up flow, booking flow. |

---

## 5. Vitest Config — No Changes Needed

The existing `vitest.config.ts` with `environment: 'node'` is correct for Server Action tests. Component tests override with `// @vitest-environment jsdom` per-file pragma. This is already the pattern — no config changes required.

---

## 6. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Unit tests prove app-layer checks but not RLS enforcement | Medium | Add comment to each cross-user test: `// NOTE: This test mocks Supabase. RLS enforcement is in supabase/migrations/ — verify there.` |
| `updateEvent` shares 80% of code with `createEvent` — test duplication | Low | Extract `makeEventFormData` as shared helper; don't duplicate form setup |
| `getMonthlyBookings` month-grouping logic is date-sensitive | Medium | Mock `new Date()` via `vi.setSystemTime()` in Vitest to pin the current date before testing the 12-month array |
| `splitBookings` depends on `isPastEvent` which uses real `Date.now()` | Medium | Same fix: `vi.setSystemTime()` to pin current date to a known value before each test |

---

## HANDOVER
- **Agent:** architect
- **Task:** Test strategy design for coverage gaps C-1 to C-5 and I-1 to I-10
- **Files changed:** `docs/TEST-STRATEGY.md` created
- **Migrations planned:** none
- **Tests added:** none (architect doesn't write tests)
- **Next agent:** `/tester` — implement Batch T-1 first (admin write auth guards), then T-2 (CSV injection + query), then T-3 (updateEvent + dashboard + splitBookings), then T-4 (UI interactions)
- **Risks / open questions:**
  1. `vi.setSystemTime()` is required for `getMonthlyBookings` and `splitBookings` tests to be deterministic — confirm with tester that they use `afterEach(() => vi.useRealTimers())` to clean up
  2. `updateEvent` test needs access to `makeEventFormData` helper — either export it from `actions.test.ts` or copy it into the new test file
  3. Integration test layer (real Supabase + RLS) is explicitly deferred — the co-founder demo relies on trusting the migration files are correct. This is an accepted risk.
