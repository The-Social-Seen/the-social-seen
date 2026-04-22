// @vitest-environment jsdom
/**
 * Automated WCAG smoke checks for the most-visited client components.
 *
 * Runs axe-core against the rendered DOM and asserts zero violations for
 * the rules we care about at launch (WCAG 2.1 A + AA). This catches a
 * regression class (e.g. a future PR that re-introduces nested `<main>`,
 * removes a label, or ships an icon-only button without aria-label) that
 * static grep can't consistently surface.
 *
 * Scope is deliberately narrow — the components here are the ones where
 * a failure affects the most users per week. Full-page E2E axe coverage
 * belongs in Playwright (stretch goal — see CLAUDE.md).
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { axe } from 'vitest-axe'
// vitest-axe@0.1.0 ships an empty extend-expect.js shim and its `.d.ts`
// exports the matcher under an alias (`toHaveNoViolations as t`) that tsc
// treats as type-only. Pull the runtime function via the CommonJS require
// to dodge both issues; cast to the matcher shape `expect.extend` expects.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const matchers = require('vitest-axe/matchers') as {
  toHaveNoViolations: (...args: unknown[]) => {
    pass: boolean
    message: () => string
  }
}
expect.extend({ toHaveNoViolations: matchers.toHaveNoViolations })

// Tell TS about the matcher we just registered. vitest-axe's own type
// augmentation targets jest-axe's surface, not vitest's.
declare module 'vitest' {
  interface Assertion {
    toHaveNoViolations(): void
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void
  }
}

// ── Common mocks ─────────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/events',
}))

vi.mock('next/image', () => ({
  default: ({ alt, src, ...rest }: { alt: string; src: string }) => {
    const { fill: _f, priority: _p, sizes: _s, ...dom } = rest as Record<
      string,
      unknown
    >
    void _f
    void _p
    void _s
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt} src={src} {...(dom as Record<string, unknown>)} />
  },
}))

vi.mock('@/components/layout/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}))

vi.mock('@/components/layout/AvatarDropdown', () => ({
  AvatarDropdown: () => <div data-testid="avatar-dropdown" />,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
    }),
  }),
}))

// framer-motion to plain DOM (other tests do the same)
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, prop) =>
        ({
          children,
          ...props
        }: React.PropsWithChildren<Record<string, unknown>>) => {
          const { variants: _v, initial: _i, animate: _a, exit: _e, whileInView: _w, viewport: _vp, transition: _tr, custom: _c, ...dom } = props as Record<string, unknown>
          void _v; void _i; void _a; void _e; void _w; void _vp; void _tr; void _c
          return React.createElement(prop as string, dom, children)
        },
    },
  ),
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useInView: () => true,
}))

import React from 'react'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import ContactForm from '@/app/contact/ContactForm'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

describe('a11y smoke — WCAG 2.1 A + AA', () => {
  it('Header renders without axe violations', async () => {
    const { container } = render(<Header />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('Footer renders without axe violations', async () => {
    const { container } = render(<Footer />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('ContactForm renders without axe violations', async () => {
    const { container } = render(<ContactForm />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('ConfirmDialog (simple variant) renders without axe violations', async () => {
    const { baseElement } = render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete widget?"
        description={<p>This cannot be undone.</p>}
        confirmLabel="Delete"
        onConfirm={() => {}}
      />,
    )
    // Dialog content is rendered in a portal — axe must scan the whole
    // document body, not just the mount container.
    const results = await axe(baseElement)
    expect(results).toHaveNoViolations()
  })

  it('ConfirmDialog (typed-confirmation variant) renders without axe violations', async () => {
    const { baseElement } = render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete your account?"
        description={<p>This closes your account permanently.</p>}
        confirmLabel="Delete my account"
        tone="danger"
        typedConfirmation={{
          phrase: 'delete my account',
          inputLabel: 'Type "delete my account" to confirm:',
          inputPlaceholder: 'delete my account',
        }}
        onConfirm={() => {}}
      />,
    )
    const results = await axe(baseElement)
    expect(results).toHaveNoViolations()
  })
})
