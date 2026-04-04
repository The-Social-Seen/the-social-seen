import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Scans .tsx files in src/components/ and src/app/ for hardcoded hex colour
 * values. Files that are allowed to contain hex values (globals.css, files
 * with the "Google brand colours" comment) are excluded.
 */

function collectTsxFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectTsxFiles(fullPath))
    } else if (entry.name.endsWith('.tsx')) {
      results.push(fullPath)
    }
  }
  return results
}

describe('Design token compliance', () => {
  it('no hardcoded hex colours in component and app .tsx files', () => {
    const srcRoot = path.resolve(__dirname, '..')
    const dirs = [
      path.join(srcRoot, 'components'),
      path.join(srcRoot, 'app'),
    ]

    const files = dirs.flatMap((d) => collectTsxFiles(d))

    // Matches standalone hex patterns like #FFF, #1C1C1E, #C9A96E1A
    // Excludes url(#...) SVG references and CSS custom property fallbacks
    const hexPattern = /(?<!url\()#[0-9a-fA-F]{3,8}\b/g

    const violations: { file: string; line: number; match: string }[] = []

    for (const file of files) {
      // Skip globals.css (not .tsx anyway, but just in case of naming)
      if (file.endsWith('globals.css')) continue

      const content = fs.readFileSync(file, 'utf-8')

      // Skip files containing the "Google brand colours" exemption comment
      if (content.includes('Google brand colours')) continue

      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const matches = lines[i].matchAll(hexPattern)
        for (const m of matches) {
          violations.push({
            file: path.relative(srcRoot, file),
            line: i + 1,
            match: m[0],
          })
        }
      }
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line}  ${v.match}`)
        .join('\n')
      expect.fail(
        `Found ${violations.length} hardcoded hex colour(s):\n${report}\n\nUse design token CSS variables instead.`,
      )
    }
  })
})
