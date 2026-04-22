/**
 * Drift guard — ensures `ALLOWED_IMAGE_HOSTS` in src/lib/utils/images.ts
 * stays in sync with `images.remotePatterns` in next.config.ts.
 *
 * If someone adds a host to one but forgets the other:
 * - next.config only → `resolveEventImage()` filters the URL out at runtime,
 *   falling back to a placeholder (no crash, but silent "broken image" UX).
 * - images.ts only → runtime allows it through, but `next/image` throws
 *   at render time.
 *
 * This test parses next.config.ts as text (we can't import it directly —
 * it's compiled by the Next toolchain) and compares against the runtime
 * allowlist. Deliberately lenient about format (hostname on its own line).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('image host allowlist drift', () => {
  it('ALLOWED_IMAGE_HOSTS in images.ts matches remotePatterns in next.config.ts', async () => {
    const configPath = resolve(process.cwd(), 'next.config.ts')
    const configText = readFileSync(configPath, 'utf-8')

    // Extract hostnames inside remotePatterns: `hostname: "<value>"`.
    // Covers the small number of entries we have without pulling in a TS parser.
    const remoteHostnames = Array.from(
      configText.matchAll(/hostname:\s*["']([^"']+)["']/g),
      (m) => m[1]
    ).sort()

    const imagesModule = await import('../images')
    // Re-export is intentionally internal; read via the public isAllowedImageHost
    // by probing each next.config hostname. If any is disallowed, they're
    // out of sync.
    for (const host of remoteHostnames) {
      // Wildcard entries (e.g. "*.supabase.co") don't map to a real hostname
      // we can probe — swap a plausible subdomain in for the probe.
      const probeHost = host.startsWith('*.')
        ? `foo${host.slice(1)}` // "*.supabase.co" → "foo.supabase.co"
        : host
      const allowed = imagesModule.isAllowedImageHost(`https://${probeHost}/x.jpg`)
      expect(allowed, `next.config.ts allows "${host}" but images.ts does not`).toBe(true)
    }

    // Inverse direction: read the literal ALLOWED_IMAGE_HOSTS text from
    // images.ts and assert each appears in next.config.ts.
    const imagesPath = resolve(process.cwd(), 'src/lib/utils/images.ts')
    const imagesText = readFileSync(imagesPath, 'utf-8')
    const allowlistMatch = imagesText.match(
      /ALLOWED_IMAGE_HOSTS[\s\S]*?=\s*\[([\s\S]*?)\]/
    )
    expect(allowlistMatch, 'Could not parse ALLOWED_IMAGE_HOSTS').toBeTruthy()

    const runtimeHosts = Array.from(
      (allowlistMatch?.[1] ?? '').matchAll(/["']([^"']+)["']/g),
      (m) => m[1]
    ).sort()

    expect(runtimeHosts, 'images.ts and next.config.ts disagree about allowed hosts').toEqual(
      remoteHostnames
    )
  })
})
