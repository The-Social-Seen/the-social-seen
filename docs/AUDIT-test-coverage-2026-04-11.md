# Test Coverage Audit — The Social Seen
**Date:** 2026-04-11  
**Auditor:** /auditor skill  
**Scope:** Full codebase — Server Actions, query functions, utilities, components  

---

## TEST INFRASTRUCTURE

| Item | Detail |
|------|--------|
| Test runner | **Vitest** (`pnpm test` → `vitest run`) |
| Config | `vitest.config.ts` at project root |
| Total test files | **48** (all in `src/`) |
| Total test cases | **~190** `it()` calls across 48 files (estimate from grep) |
| Component testing | React Testing Library (inferred from test content) |
| E2E tests | **None** — no Playwright config, no e2e/ directory |
| Integration tests | **None** — all tests mock Supabase; no real DB calls |
| Test type used everywhere | Unit (mocked Supabase, mocked Next.js) |

---

## COVERAGE MAP — Server Actions

### `src/app/(auth)/actions.ts` — 5 exported functions
| Function | Tested | Type | Notes |
|----------|--------|------|-------|
| `signUp` | ✅ | Unit | Validation, duplicate email, empty identities, referral source |
| `signIn` | ✅ | Unit | Validation, wrong creds, admin redirect, explicit redirectTo |
| `signOut` | ❌ | — | No test — just calls `supabase.auth.signOut()` + redirect |
| `saveInterests` | ✅ | Unit | Empty array, unauth, delete+insert flow |
| `completeOnboarding` | ✅ | Unit | Unauth, sets onboarding_complete |

**Open-redirect tests:** Separate file `redirect-validation.test.ts` covers 10 attack vectors (https://, //, javascript:, http://, backslash prefix). ✅

### `src/app/events/[slug]/actions.ts` — 3 exported functions
| Function | Tested | Type | Notes |
|----------|--------|------|-------|
| `createBooking` | ✅ | Unit | Empty ID, unauth, confirmed, waitlisted, RPC errors |
| `cancelBooking` | ✅ | Unit | Empty ID, unauth, ownership check, status check, not found |
| `leaveWaitlist` | ✅ | Unit | Empty ID, unauth, ownership, status, recompute RPC called |

### `src/app/(member)/bookings/actions.ts` — 1 exported function
| Function | Tested | Type | Notes |
|----------|--------|------|-------|
| `submitReview` | ✅ | Unit | Validation, unauth, past event check, confirmed booking check, duplicate check |

### `src/app/(member)/profile/actions.ts` — 3 exported functions
| Function | Tested | Type | Notes |
|----------|--------|------|-------|
| `updateProfile` | ✅ | Unit | Validation, unauth, update flow, linkedin URL, null conversion |
| `updateAvatar` | ✅ | Unit | No file, >2MB, bad MIME type, unauth, upload+update |
| `updateInterests` | ✅ | Unit | Empty array, unauth, delete+insert |

### `src/app/(admin)/admin/actions.ts` — 20 exported functions
| Function | Tested | Type | Notes |
|----------|--------|------|-------|
| `getDashboardStats` | ✅ | Unit | KPI aggregation |
| `getMonthlyBookings` | ❌ | — | No test |
| `getRecentActivity` | ❌ | — | No test |
| `createEvent` | ✅ | Unit | Validation, slug, price conversion, auto-host assignment, DB error |
| `updateEvent` | ❌ | — | No test — identical risk surface to createEvent |
| `softDeleteEvent` | ✅ | Unit | Has confirmed bookings (block), no bookings (allow) |
| `toggleEventPublished` | ✅ | Unit | true→false, false→true, not found |
| `cancelEvent` | ❌ | — | No test |
| `getAdminEvents` | ❌ | — | No test |
| `getAdminEventById` | ❌ | — | No test |
| `upsertEventInclusions` | ❌ | — | No test — write operation on DB |
| `upsertEventHosts` | ❌ | — | No test — write operation on DB |
| `getEventBookings` | ❌ | — | No test |
| `promoteFromWaitlist` | ✅ | Unit | Promote, non-waitlisted, at capacity, not found |
| `exportEventAttendeesCSV` | ❌ | — | No test — CSV injection risk |
| `getAdminMembers` | ✅ | Unit | ILIKE escaping (%, _, mixed, empty search) — separate test file |
| `exportMembersCSV` | ✅ | Unit | CSV injection prevention — separate test file |
| `getAdminReviews` | ❌ | — | No test |
| `toggleReviewVisibility` | ✅ | Unit | true→false, false→true, not found |
| `sendNotification` | ✅ | Unit | Success insert, validation error |
| `getNotificationHistory` | ❌ | — | No test |

**Auth guards (requireAdmin):** Covered by generic parametric tests across all admin actions. ✅

---

## COVERAGE MAP — Query Functions

### `src/lib/supabase/queries/events.ts` — 5 exported functions
| Function | Tested | Type | Notes |
|----------|--------|------|-------|
| `getPublishedEvents` | ✅ | Unit | Returns list, empty on error |
| `getEventBySlug` | ✅ | Unit | Found, not found (PGRST116), booking count, review stats, spots_left |
| `getEventReviews` | ✅ | Unit | Returns reviews, empty on error |
| `getEventPhotos` | ✅ | Unit | Returns photos, empty on error |
| `getRelatedEvents` | ✅ | Unit | Returns related, empty on error, no results |
| `getUserBookingForEvent` | ✅ | Unit | Unauth, has booking, no booking, query error |

### `src/lib/supabase/queries/profile.ts` — 2 exported functions
| Function | Tested | Type | Notes |
|----------|--------|------|-------|
| `getProfile` | ✅ | Unit | Returns profile+interests, empty interests, PGRST116, unexpected error |
| `getMyBookings` | ✅ | Unit | Unwrapped event, single object event, empty, error |

### `src/lib/supabase/queries/reviews.ts` — 1 exported function
| Function | Tested | Type | Notes |
|----------|--------|------|-------|
| `getReviewableEvents` | ❌ | — | **No test** — complex join query with filter logic |

### `src/lib/supabase/queries/gallery.ts` — 2 exported functions
| Function | Tested | Type | Notes |
|----------|--------|------|-------|
| `getAllGalleryPhotos` | ❌ | — | **No test** |
| `getGalleryEvents` | ❌ | — | **No test** |

---

## COVERAGE MAP — Utility Functions

### `src/lib/utils/dates.ts`
| Status | Tests | Notes |
|--------|-------|-------|
| ✅ Tested | `dates.test.ts` | Europe/London formatting, isPastEvent, etc. |

### `src/lib/utils/currency.ts`
| Status | Tests | Notes |
|--------|-------|-------|
| ✅ Tested | `currency.test.ts` | GBP formatting, pence→pounds |

### `src/lib/utils/images.ts`
| Status | Tests | Notes |
|--------|-------|-------|
| ✅ Tested | `images.test.ts` | Supabase path vs external URL resolution |

### `src/lib/utils/slugify.ts`
| Status | Tests | Notes |
|--------|-------|-------|
| ✅ Tested | `slugify.test.ts` | Slug generation, uniqueSlug |

### `src/lib/utils/calendar.ts`
| Status | Tests | Notes |
|--------|-------|-------|
| ✅ Tested | `calendar.test.ts` | Calendar link generation |

### `src/lib/utils/bookings.ts` — `splitBookings()`
| Status | Tests | Notes |
|--------|-------|-------|
| ❌ No test | — | `splitBookings()` — splits bookings into upcoming/past/waitlisted |

### `src/lib/utils/cn.ts` — `cn()`
| Status | Tests | Notes |
|--------|-------|-------|
| ❌ No test | — | Thin wrapper over clsx+twMerge — low risk |

### `src/lib/supabase/admin.ts`, `client.ts`, `server.ts`, `middleware.ts`
| File | Status | Notes |
|------|--------|-------|
| `admin.ts` | ✅ Tested | server-only guard, env var checks, service role key usage |
| `client.ts` | ✅ Tested | anon-only check |
| `server.ts` | ✅ Tested | Cookie-based client creation |
| `middleware.ts` | ✅ Tested | Auth redirect, protected routes, session refresh |

---

## COVERAGE MAP — Components

### `src/components/admin/` — 12 components
| Component | Tested | Notes |
|-----------|--------|-------|
| `KPICard` | ✅ | Renders stats |
| `EventForm` | ✅ | Create/edit form fields |
| `PromoteButton` | ✅ | Calls promoteFromWaitlist |
| `AdminSidebar` | ❌ | Navigation |
| `BookingsChart` | ❌ | Recharts visualisation |
| `BookingsTable` | ❌ | Table + sort |
| `EventsTable` | ❌ | Table + actions |
| `InclusionsList` | ❌ | Sortable inclusion items |
| `MembersTable` | ❌ | Member listing |
| `NotificationForm` | ❌ | Sends notifications |
| `RecentActivity` | ❌ | Activity feed |
| `ReviewsTable` | ❌ | Review moderation table |

### `src/components/events/` — 6 components
| Component | Tested | Notes |
|-----------|--------|-------|
| `BookingModal` | ✅ | Full 2/3-step booking flow |
| `BookingSidebar` | ✅ | Desktop sidebar |
| `EventCard` | ✅ | Card rendering, sold-out, waitlist states |
| `EventDetailClient` | ✅ | Detail page client interactions |
| `MobileBookingBar` | ✅ | Sticky mobile bar |
| `EventsPageClient` | ❌ | Filter + sort interactions |

### `src/components/gallery/` — 2 components
| Component | Tested | Notes |
|-----------|--------|-------|
| `GalleryClient` | ✅ | Grid, filter, photo selection |
| `Lightbox` | ❌ | Keyboard navigation, swipe gestures |

### `src/components/landing/` — 6 components
| Component | Tested | Notes |
|-----------|--------|-------|
| `HeroSection` | ✅ | Renders headline, CTA |
| `CTASection` | ✅ | Join CTA renders |
| `SocialProofSection` | ✅ | Member count, stats |
| `AboutSection` | ❌ | Static content |
| `GalleryPreviewSection` | ❌ | Photo grid |
| `TestimonialsSection` | ❌ | Testimonial cards |
| `UpcomingEventsSection` | ❌ | Event preview list |

### `src/components/layout/` — 5 components
| Component | Tested | Notes |
|-----------|--------|-------|
| `Header` | ✅ | Auth state, nav links, route highlighting |
| `Footer` | ✅ | Links, newsletter |
| `AvatarDropdown` | ✅ | Dropdown menu items |
| `MobileMenu` | ✅ | Open/close, links |
| `ThemeProvider` | ❌ | Dark mode provider |

### `src/components/profile/` — 6 components
| Component | Tested | Notes |
|-----------|--------|-------|
| `BookingCard` | ✅ | Renders booking, cancel/leave buttons |
| `BookingsList` | ✅ | Upcoming/past/waitlisted tabs |
| `ProfileCompletionBanner` | ✅ | Conditional banner display |
| `EditProfileForm` | ❌ | Multi-field form, avatar upload |
| `ProfileHeader` | ❌ | Avatar display |
| `ProfilePageClient` | ❌ | Profile page interactions |

### `src/components/reviews/` — 4 components
| Component | Tested | Notes |
|-----------|--------|-------|
| `ReviewForm` | ✅ | Star selection, text, submit, validation |
| `InteractiveStarRating` | ❌ | Star click/hover interactions |
| `ReviewCard` | ❌ | Review display |
| `StarRating` | ❌ | Static star display |

### `src/components/shared/` — 1 component
| Component | Tested | Notes |
|-----------|--------|-------|
| `SkeletonCard` | ❌ | Loading skeleton — minimal risk |

---

## PRIORITISED GAP LIST

---

### 🔴 CRITICAL — Security/auth paths with zero test coverage

**C-1: `updateEvent` (admin action) — zero tests**  
- File: `src/app/(admin)/admin/actions.ts:317`  
- Risk: Same surface as `createEvent` (slug collision, price conversion, event form schema). No test verifies that the admin role check fires, that non-admins are rejected, or that the input is validated. An untested `updateEvent` with a missing auth guard would allow any authenticated user to modify events.  
- Missing: auth guard test, Zod validation test, price-in-pence test, slug uniqueness test.

**C-2: `upsertEventInclusions` / `upsertEventHosts` — zero tests**  
- Files: `src/app/(admin)/admin/actions.ts:524, 561`  
- Risk: Write operations that modify event content. Neither has a test verifying admin-only access. If `requireAdmin()` is ever accidentally removed or fails silently, any authenticated user can overwrite event inclusions/hosts.  
- Missing: admin-only guard test, upsert logic test.

**C-3: `cancelEvent` — zero tests**  
- File: `src/app/(admin)/admin/actions.ts:443`  
- Risk: Cancels an event and presumably affects all bookings. No test verifies it can't be called by non-admins or confirms the soft-delete / cascade behaviour.

**C-4: `exportEventAttendeesCSV` — zero tests**  
- File: `src/app/(admin)/admin/actions.ts:693`  
- Risk: Exports personally-identifiable data (attendee names, emails). The private `sanitizeCsvCell()` helper is tested via `exportMembersCSV`, but this separate export path is not tested. A code divergence could reintroduce CSV injection for attendee data.  
- Missing: CSV injection test for attendee export path.

**C-5: `getReviewableEvents` — zero tests**  
- File: `src/lib/supabase/queries/reviews.ts:19`  
- Risk: Contains compound filter logic (past events + confirmed booking + no existing review). Without a test, a subtle query bug could allow users to review future events or events they didn't attend. These are the exact invariants enforced in `submitReview` — the query layer must agree.

---

### 🟡 IMPORTANT — Core business logic gaps

**I-1: `updateEvent` business logic**  
- Same as C-1 — beyond the auth risk, the price conversion (pounds→pence), slug update, and form validation are business-critical and untested.

**I-2: `getAdminMembers` result shape**  
- ILIKE escaping is tested in a targeted file, but the actual data returned (columns, booking counts, sort order) is not verified. A schema change could break the members table silently.

**I-3: `getAdminReviews` — zero tests**  
- File: `src/app/(admin)/admin/actions.ts:841`  
- `filter` param (`all` | `visible` | `hidden`) logic untested. An off-by-one or wrong `.eq()` argument would show admins wrong data without failing.

**I-4: `getMonthlyBookings` / `getRecentActivity` / `getDashboardStats` — partial**  
- `getDashboardStats` has a test; `getMonthlyBookings` and `getRecentActivity` do not. Dashboard data powers admin decision-making.

**I-5: `getAllGalleryPhotos` / `getGalleryEvents` — zero tests**  
- Files: `src/lib/supabase/queries/gallery.ts`  
- Both filter on `is_published`, `is_cancelled`, `deleted_at`. Untested means a filter regression is invisible.

**I-6: `splitBookings()` utility — zero tests**  
- File: `src/lib/utils/bookings.ts:10`  
- Drives the member bookings page (upcoming/past/waitlisted split). The `isPastEvent` boundary condition and `no_show` status inclusion in "past" are not tested.

**I-7: `EventsPageClient` — zero tests**  
- File: `src/components/events/EventsPageClient.tsx`  
- Core user journey: filter by category, sort events. No test covers the interaction between filter state and displayed events.

**I-8: `EditProfileForm` — zero tests**  
- File: `src/components/profile/EditProfileForm.tsx`  
- Calls `updateProfile` and `updateAvatar`. No test verifies that the form submits correctly, validation errors appear, or the avatar preview updates.

**I-9: `NotificationForm` — zero tests**  
- File: `src/components/admin/NotificationForm.tsx`  
- Calls `sendNotification`. The action has tests but the UI form path (field validation display, submit state) does not.

**I-10: `Lightbox` — zero tests**  
- File: `src/components/gallery/Lightbox.tsx`  
- Keyboard navigation (arrow keys, Escape) and swipe gestures are demo-critical interactions with no tests.

---

### 🟢 IMPROVEMENT — Lower-risk gaps

**G-1: `signOut` — no test**  
- One-liner that calls `supabase.auth.signOut()` + `redirect('/')`. Low risk, but the redirect destination is untested.

**G-2: Admin read queries: `getAdminEvents`, `getAdminEventById`, `getEventBookings`, `getNotificationHistory`**  
- All are read-only queries with no side effects. Failure surfaces as empty tables in admin UI rather than data corruption. Worth adding, not urgent.

**G-3: `InteractiveStarRating`, `StarRating`, `ReviewCard`**  
- Pure display components. `ReviewForm` (which uses them) is tested. Individual unit tests would add marginal value.

**G-4: `AboutSection`, `GalleryPreviewSection`, `TestimonialsSection`, `UpcomingEventsSection`**  
- Static/presentational landing page components. Low regression risk.

**G-5: `ProfileHeader`, `ProfilePageClient`**  
- Profile page interactions (edit mode toggle, etc.). The underlying actions are tested; missing UI interaction tests.

**G-6: Admin table components: `BookingsTable`, `EventsTable`, `MembersTable`, `ReviewsTable`, `BookingsChart`, `RecentActivity`, `InclusionsList`, `AdminSidebar`**  
- All render data passed as props. Snapshot or smoke tests would catch regressions without requiring mock complexity.

**G-7: `ThemeProvider`, `SkeletonCard`, `cn()`**  
- Provider wrapper, loading state, utility wrapper. Very low risk.

**G-8: No E2E tests at all**  
- Booking flow (create → confirm → view ticket) and registration (3-step) are never exercised end-to-end. CLAUDE.md lists Playwright as "stretch after Batch 5" — still absent.

---

## SUMMARY TABLE

| Layer | Total | Tested | Untested | Coverage % |
|-------|-------|--------|----------|------------|
| Server Actions (functions) | 32 | 21 | 11 | ~66% |
| Query functions | 11 | 8 | 3 | ~73% |
| Utility functions | 7 | 5 | 2 | ~71% |
| Components | 46 | 22 | 24 | ~48% |
| Supabase client modules | 4 | 4 | 0 | 100% |
| **E2E** | n/a | 0 | — | **0%** |

---

## HANDOVER

- **Agent:** auditor
- **Task:** Test coverage audit — full codebase
- **Files changed:** `docs/AUDIT-test-coverage-2026-04-11.md` created
- **Migrations created:** none (audit only)
- **Tests added:** none (audit only)
- **Build passing:** not checked (audit only)
- **Next agent:** `/backend-developer` for C-1 through C-5 (security-critical gaps), then `/tester` for I-1 through I-10
- **Most urgent:** C-2 (`upsertEventInclusions`/`upsertEventHosts` — admin write with no auth guard test), C-1 (`updateEvent`), C-4 (`exportEventAttendeesCSV` CSV injection re-check)
