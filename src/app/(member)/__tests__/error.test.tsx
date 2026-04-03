// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import MemberError from '../error'

describe('MemberError', () => {
  const defaultProps = {
    error: new Error('test') as Error & { digest?: string },
    reset: vi.fn(),
  }

  it('renders without crashing', () => {
    const { container } = render(<MemberError {...defaultProps} />)
    expect(container.firstChild).toBeTruthy()
  })

  it('displays the heading text', () => {
    render(<MemberError {...defaultProps} />)
    expect(
      screen.getByRole('heading', { level: 1 }).textContent,
    ).toBe('Session issue')
  })

  it('has a "Try Again" button', () => {
    render(<MemberError {...defaultProps} />)
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeDefined()
  })

  it('calls reset exactly once when "Try Again" is clicked', () => {
    const reset = vi.fn()
    render(<MemberError error={new Error('test')} reset={reset} />)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('has a secondary nav link pointing to /login', () => {
    render(<MemberError {...defaultProps} />)
    const link = screen.getByRole('link', { name: /sign in again/i })
    expect(link.getAttribute('href')).toBe('/login')
  })

  it('does NOT show digest when absent', () => {
    render(<MemberError {...defaultProps} />)
    expect(screen.queryByText(/error ref/i)).toBeNull()
  })

  it('shows digest when present', () => {
    const errorWithDigest = Object.assign(new Error('test'), {
      digest: 'abc-123',
    })
    render(<MemberError error={errorWithDigest} reset={vi.fn()} />)
    expect(screen.getByText(/error ref:.*abc-123/i)).toBeDefined()
  })

  it('source file includes "use client" directive', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../error.tsx'),
      'utf-8',
    )
    expect(source).toContain("'use client'")
  })
})
