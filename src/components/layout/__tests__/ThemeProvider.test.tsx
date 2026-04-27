// @vitest-environment jsdom
//
// Hydration regression guard for ThemeProvider's SSR-safe initializer.
// The previous bug routed `getInitialTheme()` through a window-conditional
// useState initializer — in jsdom (window defined, localStorage =
// "dark") the initial state was "dark"; in a real Node SSR pass
// (window undefined) it was "light". The two diverged and React's
// hydration reconciler bailed out of attaching downstream event
// handlers, breaking Link / button clicks app-wide. The fix anchors
// the initial useState to the constant "light" — the persisted
// preference is now read in a mount useEffect, AFTER hydration.
//
// This test pins that behaviour by rendering ThemeProvider with
// renderToString twice — once with empty localStorage / system
// preference (the SSR baseline) and once with localStorage seeded to
// "dark" plus matchMedia mocked dark. renderToString does NOT fire
// useEffect, so we capture only the initial render — which must be
// identical regardless of any client-side preference signal.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ThemeProvider, useTheme } from '../ThemeProvider'

function ThemeProbe() {
  const { theme } = useTheme()
  return (
    <span data-testid="theme-probe" data-theme={theme}>
      {theme}
    </span>
  )
}

function mockMatchMedia(matchesDark: boolean) {
  // jsdom does not implement matchMedia, so assign directly rather
  // than spy — there's no underlying function for vi.spyOn to wrap.
  const mql = {
    matches: matchesDark,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => mql),
  })
}

describe('ThemeProvider — SSR-safe initializer (hydration regression guard)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('first render is identical regardless of localStorage / system preference', () => {
    // Baseline render — no persisted theme, system reports light.
    // Stand-in for a real Node SSR pass where window is undefined and
    // getInitialTheme falls through to "light".
    mockMatchMedia(false)
    const baselineHtml = renderToString(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    // Now seed every client-side preference signal that the OLD
    // initializer would have read: localStorage AND matchMedia both
    // saying "dark". Under the bug this would have produced
    // data-theme="dark" — diverging from the SSR baseline above and
    // tripping React's hydration mismatch on the real app.
    window.localStorage.setItem('theme', 'dark')
    mockMatchMedia(true)
    const seededHtml = renderToString(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    // The contract: renderToString output is byte-for-byte identical
    // — neither localStorage nor matchMedia leaks into the initial
    // useState. The persisted preference is deferred to the mount
    // effect (covered by the manual smoke-test in the fix commit's
    // body); this test locks the initializer side.
    expect(seededHtml).toBe(baselineHtml)
    expect(seededHtml).toContain('data-theme="light"')
    expect(seededHtml).not.toContain('data-theme="dark"')
  })
})
