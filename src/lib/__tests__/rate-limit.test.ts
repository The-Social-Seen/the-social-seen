import { describe, it, expect, beforeEach } from 'vitest'
import {
  __TEST_ONLY__resetRateLimits,
  peekAttempts,
  recordAttempt,
} from '../rate-limit'

describe('recordAttempt', () => {
  beforeEach(() => {
    __TEST_ONLY__resetRateLimits()
  })

  it('allows the first attempt and counts it', () => {
    const result = recordAttempt('user-a', { limit: 3, windowMs: 60_000 })
    expect(result).toMatchObject({ allowed: true, count: 1, limit: 3 })
  })

  it('allows up to `limit` attempts then blocks the next', () => {
    const opts = { limit: 3, windowMs: 60_000 }
    expect(recordAttempt('user-a', opts).allowed).toBe(true)
    expect(recordAttempt('user-a', opts).allowed).toBe(true)
    expect(recordAttempt('user-a', opts).allowed).toBe(true)
    const blocked = recordAttempt('user-a', opts)
    expect(blocked.allowed).toBe(false)
    expect(blocked.count).toBe(4)
  })

  it('keys are independent — exhausting one does not affect another', () => {
    const opts = { limit: 1, windowMs: 60_000 }
    expect(recordAttempt('user-a', opts).allowed).toBe(true)
    expect(recordAttempt('user-a', opts).allowed).toBe(false)
    expect(recordAttempt('user-b', opts).allowed).toBe(true)
  })

  it('still records the attempt when blocked (cap-burning protection)', () => {
    const opts = { limit: 1, windowMs: 60_000 }
    recordAttempt('user-a', opts) // allowed, count=1
    const second = recordAttempt('user-a', opts) // blocked, count=2
    const third = recordAttempt('user-a', opts) // still blocked, count=3
    expect(second.count).toBe(2)
    expect(third.count).toBe(3)
  })

  it('peekAttempts returns 0 for an unknown key without recording', () => {
    expect(peekAttempts('never-seen', { limit: 3, windowMs: 60_000 })).toBe(0)
    // Subsequent recordAttempt should still see count=1, proving peek
    // didn't accidentally bump the bucket.
    expect(recordAttempt('never-seen', { limit: 3, windowMs: 60_000 }).count).toBe(1)
  })

  it('peekAttempts reflects the live count after recordAttempt', () => {
    const opts = { limit: 3, windowMs: 60_000 }
    recordAttempt('user-a', opts)
    recordAttempt('user-a', opts)
    expect(peekAttempts('user-a', opts)).toBe(2)
  })

  it('peekAttempts drops expired entries before reporting', async () => {
    const opts = { limit: 3, windowMs: 50 }
    recordAttempt('user-a', opts)
    recordAttempt('user-a', opts)
    expect(peekAttempts('user-a', opts)).toBe(2)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(peekAttempts('user-a', opts)).toBe(0)
  })

  it('drops expired entries when a new attempt arrives', async () => {
    const opts = { limit: 1, windowMs: 50 }
    expect(recordAttempt('user-a', opts).allowed).toBe(true)
    expect(recordAttempt('user-a', opts).allowed).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 60))
    // Window has slid; old entry expired.
    const fresh = recordAttempt('user-a', opts)
    expect(fresh.allowed).toBe(true)
    expect(fresh.count).toBe(1)
  })
})
