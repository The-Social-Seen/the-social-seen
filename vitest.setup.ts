/**
 * Global vitest setup. Runs once before any test file.
 *
 * Mocks Next.js's `server-only` package as a no-op. The real package
 * throws on import (it's a runtime guard for Server Component module
 * boundaries) which breaks vitest in node mode for any test file whose
 * import graph includes a server-only module.
 *
 * ⚠️ **Trade-off:** with this global mock, a Client Component test
 * that accidentally imports a server-only module (e.g. `@/lib/email/send`,
 * `@/lib/supabase/admin`) will compile and pass in vitest — the real
 * import-boundary guard only fires at Next.js build time. If you
 * suspect such a leak, run `pnpm build` to surface it.
 *
 * If you genuinely want a test to assert that a specific source file
 * imports `'server-only'` as a defence-in-depth check, use the
 * source-string pattern from src/lib/supabase/__tests__/admin.test.ts
 * (read the file as text and assert the import line is present).
 */
import { vi } from 'vitest'

vi.mock('server-only', () => ({}))
