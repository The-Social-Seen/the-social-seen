/**
 * Drift guard — ensures `next.config.ts` `images.remotePatterns` and
 * `isAllowedImageHost()` in `src/lib/utils/images.ts` agree on which
 * protocols are allowed for image URLs.
 *
 * 2026-04-28: the previous host-allowlist drift check is gone — both
 * sides are now permissive for any HTTPS source (single-admin trust
 * model; see commit bc77eff). What remains shared between the two
 * files is the protocol-level boundary: HTTPS in, HTTP out. If a
 * future contributor narrows OR widens one side without the other
 * (e.g. flips images.ts to accept `http:` but leaves `next.config.ts`
 * https-only), seeded URLs would silently render as placeholders or
 * crash next/image at render time. This test catches that.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isAllowedImageHost } from '../images'

describe('image host allowlist drift', () => {
  it('next.config.ts and isAllowedImageHost agree on which protocols are allowed', () => {
    // Every entry in next.config.ts `remotePatterns` must use https.
    // Parsed as text because next.config.ts is compiled by the Next
    // toolchain and isn't directly importable in a unit test.
    const configPath = resolve(process.cwd(), 'next.config.ts')
    const configText = readFileSync(configPath, 'utf-8')

    const protocols = Array.from(
      configText.matchAll(/protocol:\s*["']([^"']+)["']/g),
      (m) => m[1],
    )
    expect(
      protocols.length,
      'expected at least one remotePatterns entry in next.config.ts',
    ).toBeGreaterThan(0)
    for (const proto of protocols) {
      expect(
        proto,
        `next.config.ts remotePatterns must be https-only; saw "${proto}"`,
      ).toBe('https')
    }

    // isAllowedImageHost must agree: HTTPS allowed, HTTP rejected.
    // Use a hostname that is not specially-cased anywhere — the contract
    // under test is the protocol gate, not any host pattern.
    expect(isAllowedImageHost('https://x.example.com/y')).toBe(true)
    expect(isAllowedImageHost('http://x.example.com/y')).toBe(false)
  })
})
