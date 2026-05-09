# Known Flaky Tests

This file tracks tests that are known to flake intermittently. The `tester` agent reads this in its bootstrap and checks failures against this list before re-investigating.

When a test fails during a run and the failure matches an entry below, attribute it (mention the entry in your HANDOVER) and don't re-investigate. When a flake is fixed, remove its entry. When a new flake is discovered, add an entry.

## Format

Each entry has:
- **Test** — path to the test file plus the relevant test name(s)
- **Symptom** — what the failure looks like in CI/local output
- **Cause** — known or hypothesised root cause
- **Last seen** — most recent observation date
- **Tracking** — issue / PR link or "untracked"

## Entries

### Playwright auth + register flow
- **Test:** `e2e/auth.spec.ts` (and adjacent auth/registration flows)
- **Symptom:** 30-second navigation/form-submit timeout; same commit passes on retry across runs
- **Cause:** suspected — slow CI runner combined with default Playwright timeouts being too tight. Not a product bug.
- **Last seen:** 2026-04
- **Tracking:** untracked — fix is to bump `timeout` and `expect.timeout` in `playwright.config.ts`, and/or add per-test `test.retries(2)`

### Playwright venue-reveal flow
- **Test:** event-detail venue-reveal E2E flow
- **Symptom:** 30-second timeout; same commit can pass and fail across runs
- **Cause:** same family — slow CI + tight timeout
- **Last seen:** 2026-04
- **Tracking:** untracked — same fix as above
