# Batch 9 — Polish & Dark Mode

## Context

All features are built (Batches 1–8). The platform is functional. Now make it feel premium.

**IMPORTANT:** Do not add new features. Do not change database schema. This batch is CSS, animations, responsive fixes, meta tags, and performance only.

---

## Tasks

### Task 1: Dark Mode
- Implement with `data-theme="dark"` attribute on `<html>`
- Toggle stored in localStorage, respects `prefers-color-scheme` on first visit
- Dark mode palette from CLAUDE.md: bg #121214, surface #1C1C1E, border #2C2C2E, text #F5F5F5, muted #8E8E93
- Gold remains #C9A96E
- Test EVERY page in dark mode

### Task 2: Page Transitions
- Fade-in on page mount (200ms, ease-out)
- Use framer-motion AnimatePresence

### Task 3: Micro-interactions
- Button hover/press states, card hover lift, modal enter/exit animations
- Form input focus: gold ring, error shake
- Star rating cascade fill, confetti on booking confirmation (gold + cream particles, 2 seconds)

### Task 4: Responsive QA
- Test at 375px, 390px, 768px, 1024px, 1280px, 1536px
- Fix header, cards, sidebar stacking, admin layout, gallery masonry, booking modal, tables

### Task 5: SEO & Meta Tags
- Unique title + description on every page
- Dynamic OG tags on event detail pages
- Favicon (gold "S" on charcoal), apple touch icon
- JSON-LD structured data for events

### Task 6: Performance
- next/image with proper sizing everywhere
- Lazy loading below-fold images
- font-display: swap
- Check bundle sizes, flag pages over 200KB

### Task 7: Error & Empty States Audit
- Custom 404 page (on-brand)
- All pages handle no-data gracefully
- Skeleton screens everywhere (no spinners)

---

## Verification Checklist

```
[ ] pnpm tsc --noEmit — zero errors
[ ] pnpm build — succeeds, no page over 200KB JS
[ ] Dark mode: every page tested, gold pops on dark
[ ] Responsive: tested at all breakpoints, no overflow
[ ] SEO: unique title + description on every page
[ ] Favicon: gold S on charcoal
[ ] 404 page: on-brand
[ ] Loading: skeleton screens, no spinners
[ ] Lighthouse: Performance > 90, Accessibility > 95
[ ] Committed to branch: feat/polish
```
