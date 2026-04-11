# Batch 8 — Admin Dashboard

## Context

All member-facing features are built (Batches 1–7). Now build the admin dashboard that the co-founder will use to manage events, members, and reviews. This is where The Social Seen transitions from "nice website" to "real platform".

**IMPORTANT:** All admin routes require admin role. Enforce in layout.tsx (server-side redirect) AND in every Server Action (verify `profiles.role = 'admin'`). Never trust client-side role checks alone.

---

## Tasks

### Task 1: Admin Layout (`src/app/(admin)/admin/layout.tsx`)

- Server Component that checks auth + admin role → redirect to /events if not admin
- Left sidebar navigation (desktop): Overview, Events, Members, Reviews, Notifications
- Active item: charcoal bg with white text
- Sidebar shows admin avatar + name at bottom ("Sophia Laurent, Co-Founder")
- Mobile: sidebar collapses to bottom tab bar or hamburger
- Content area: light cream background, generous padding

### Task 2: Dashboard Overview (`src/app/(admin)/admin/page.tsx`)

Server Component fetching aggregate data.

**4 KPI cards across top:**
1. Total Members — count of profiles where deleted_at is null, with "↗ 12%" mock trend
2. Upcoming Events — count of published events where date_time > now()
3. Revenue This Month — sum of prices × confirmed bookings for events this month, formatted as "£2,450"
4. Avg Rating — average of all event_reviews ratings, formatted as "4.7" with star icon

Each card: white bg, rounded-xl, icon top-left (in gold), number large (Playfair Display), label below, trend badge top-right.

**Monthly Bookings chart:**
- Bar chart showing bookings per month for last 12 months
- Use a lightweight chart library (recharts or chart.js via shadcn charts)
- Gold bars on cream background
- Month labels on x-axis

**Recent Activity feed:**
- 5 most recent activities
- Each item: gold dot, text, relative timestamp ("2 hours ago")
- Pull real data from Supabase, ordered by created_at desc

### Task 3: Event Management (`src/app/(admin)/admin/events/page.tsx`)

**Event list:**
- Table with columns: Event, Date, Category, Price, Booked/Capacity, Status, Actions
- Sort by date (upcoming first)
- Status: Published (green badge), Draft (grey badge), Past (muted)
- Actions: Edit, View bookings, Delete (soft)
- "Create Event" gold CTA at top

**Create/Edit Event form (`src/app/(admin)/admin/events/[id]/page.tsx`):**
- Title, slug (auto-generated from title, editable)
- Description, Category dropdown, Date + time pickers
- Venue: name, address
- Price (£, 0 for free), Capacity (number input, leave empty for unlimited)
- Image URL, Event inclusions (dynamic list), Assign host(s), "Published" toggle
- Save via Server Action → upsert to events table

**Event bookings view (`src/app/(admin)/admin/events/[id]/bookings/page.tsx`):**
- List of bookings for this event
- Columns: Name, Email, Status, Booked At, Special Requirements
- Filter by status
- Waitlisted members: "Promote" button → changes status to confirmed
- Export attendee list as CSV

### Task 4: Member Management (`src/app/(admin)/admin/members/page.tsx`)

- Searchable table: Name, Email, Job Title, Company, Industry, Events Attended, Joined
- Search filters by name, email, industry
- "Export CSV" button
- Sort by: newest first, most active, alphabetical

### Task 5: Review Moderation (`src/app/(admin)/admin/reviews/page.tsx`)

- Table: Reviewer, Event, Rating (stars), Review Text, Date, Visible, Actions
- Filter by: All, Visible, Hidden
- Actions: Toggle visibility (hide/show)

### Task 6: Notifications Page (`src/app/(admin)/admin/notifications/page.tsx`)

**For the demo, this is mostly UI — sending is mocked.**
- "Send Notification" form with To dropdown, Subject, Body
- "Send" button → logs to console + inserts into notifications table + shows success toast
- Notification history list

---

## Verification Checklist

```
[ ] pnpm tsc --noEmit — zero errors
[ ] pnpm build — succeeds
[ ] Admin layout: sidebar nav works, active states correct
[ ] Admin layout: non-admin users redirected to /events
[ ] Dashboard: all 4 KPI cards show real data
[ ] Dashboard: monthly bookings chart renders with seed data
[ ] Event CRUD: can create and edit events
[ ] Event bookings: shows attendees, can promote from waitlist
[ ] Members: searchable list, CSV export works
[ ] Reviews: visibility toggle works
[ ] All Server Actions verify admin role
[ ] Committed to branch: feat/admin-dashboard
```
