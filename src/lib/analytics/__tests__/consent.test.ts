// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  onConsentChange,
  readConsent,
  writeConsent,
} from '../consent'

describe('consent helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('readConsent returns null on first visit', () => {
    expect(readConsent()).toBeNull()
  })

  it('writeConsent persists and readConsent returns it', () => {
    writeConsent('granted')
    expect(readConsent()).toBe('granted')

    writeConsent('denied')
    expect(readConsent()).toBe('denied')
  })

  it('readConsent ignores unexpected stored values (treats as no decision)', () => {
    window.localStorage.setItem('tss_analytics_consent', 'nonsense')
    expect(readConsent()).toBeNull()
  })

  it('writeConsent dispatches a consent-change event with the new state', () => {
    const listener = vi.fn()
    const unsubscribe = onConsentChange(listener)

    writeConsent('granted')
    expect(listener).toHaveBeenCalledWith('granted')

    writeConsent('denied')
    expect(listener).toHaveBeenCalledWith('denied')

    unsubscribe()
    writeConsent('granted')
    expect(listener).toHaveBeenCalledTimes(2) // no more after unsubscribe
  })

  it('readConsent survives localStorage throwing (private mode sim)', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('private mode')
      })
    expect(readConsent()).toBeNull()
    spy.mockRestore()
  })

  it('writeConsent swallows localStorage errors without throwing', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('private mode')
      })
    // Should not throw — the event still fires so live listeners react.
    expect(() => writeConsent('granted')).not.toThrow()
    spy.mockRestore()
  })
})
