// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  buildEventShareUrl,
  buildShareText,
  buildWhatsappShareUrl,
  nativeShareOrCopy,
} from '../share'

describe('buildEventShareUrl', () => {
  const originalLocation = window.location

  afterEach(() => {
    // Restore after each override. jsdom's window.location is configurable.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('returns an absolute URL using window.location.origin', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, origin: 'https://thesocialseen.com' },
    })
    expect(buildEventShareUrl('wine-wisdom')).toBe(
      'https://thesocialseen.com/events/wine-wisdom',
    )
  })
})

describe('buildShareText', () => {
  it('returns the canonical share copy for a title', () => {
    expect(buildShareText('Wine & Wisdom')).toBe('Join me at Wine & Wisdom')
  })

  it('is used by buildWhatsappShareUrl so the two stay in sync', () => {
    const url = buildWhatsappShareUrl('Tapas Night', 'https://example.com/t')
    const decoded = decodeURIComponent(url.replace('https://wa.me/?text=', ''))
    expect(decoded.startsWith(buildShareText('Tapas Night'))).toBe(true)
  })
})

describe('buildWhatsappShareUrl', () => {
  it('builds a wa.me URL with percent-encoded message', () => {
    const url = buildWhatsappShareUrl(
      'Wine & Wisdom',
      'https://example.com/events/wine',
    )
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    const decoded = decodeURIComponent(url.replace('https://wa.me/?text=', ''))
    expect(decoded).toBe('Join me at Wine & Wisdom: https://example.com/events/wine')
  })

  it('encodes special characters safely', () => {
    const url = buildWhatsappShareUrl(
      'Tapas & Tequila',
      'https://example.com/events/tapas',
    )
    expect(url).toContain('%20')
    expect(url).toContain('%26')
    expect(url).not.toContain(' ')
  })
})

describe('nativeShareOrCopy', () => {
  const originalShare = (navigator as { share?: unknown }).share
  const originalClipboard = navigator.clipboard

  beforeEach(() => {
    // Fresh spies per test.
  })

  afterEach(() => {
    // Restore navigator.share
    if (originalShare === undefined) {
      delete (navigator as { share?: unknown }).share
    } else {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: originalShare,
      })
    }
    // Restore clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    })
  })

  it('returns "shared" when navigator.share succeeds', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: shareMock,
    })

    const outcome = await nativeShareOrCopy({
      title: 'Wine',
      url: 'https://example.com/events/wine',
    })

    expect(outcome).toBe('shared')
    expect(shareMock).toHaveBeenCalledWith({
      title: 'Wine',
      text: undefined,
      url: 'https://example.com/events/wine',
    })
  })

  it('returns "cancelled" when the user dismisses the native share', async () => {
    const abort = new DOMException('user cancelled', 'AbortError')
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockRejectedValue(abort),
    })

    const outcome = await nativeShareOrCopy({
      title: 'Wine',
      url: 'https://example.com/events/wine',
    })
    expect(outcome).toBe('cancelled')
  })

  it('falls back to clipboard when navigator.share is missing', async () => {
    delete (navigator as { share?: unknown }).share
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const outcome = await nativeShareOrCopy({
      title: 'Wine',
      url: 'https://example.com/events/wine',
    })

    expect(outcome).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://example.com/events/wine')
  })

  it('falls back to clipboard when navigator.share throws a non-abort error', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('not allowed')),
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const outcome = await nativeShareOrCopy({
      title: 'Wine',
      url: 'https://example.com/events/wine',
    })
    expect(outcome).toBe('copied')
  })

  it('returns "unsupported" when neither API is available', async () => {
    delete (navigator as { share?: unknown }).share
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })

    const outcome = await nativeShareOrCopy({
      title: 'Wine',
      url: 'https://example.com/events/wine',
    })
    expect(outcome).toBe('unsupported')
  })
})
