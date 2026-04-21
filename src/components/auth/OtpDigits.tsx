'use client'

import {
  useRef,
  type KeyboardEvent,
  type ClipboardEvent,
  type ChangeEvent,
} from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * Six-cell OTP code entry. Each cell is a single-digit `<input>`; the
 * component owns focus management (auto-advance on type, backspace to
 * previous, arrow keys, paste-to-fill). The parent stays purely
 * declarative: it owns the `digits[]` state and gets notified via
 * `onChange` whenever any cell changes, plus a separate `onComplete`
 * callback when the user finishes entering all six digits (either by
 * typing the last one or by pasting).
 *
 * `length` is fixed at 6 for our verification flow but is parameterised
 * so this can be reused for any future short-code input.
 */
interface OtpDigitsProps {
  digits: string[]
  onChange: (next: string[]) => void
  onComplete: (code: string) => void
  disabled?: boolean
  hasError?: boolean
  length?: number
}

export function OtpDigits({
  digits,
  onChange,
  onComplete,
  disabled = false,
  hasError = false,
  length = 6,
}: OtpDigitsProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])

  function handleDigitChange(e: ChangeEvent<HTMLInputElement>, index: number) {
    const raw = e.target.value
    // Accept only the latest numeric character typed.
    const digit = raw.replace(/\D/g, '').slice(-1)

    const next = [...digits]
    next[index] = digit
    onChange(next)

    if (digit && index < length - 1) {
      inputsRef.current[index + 1]?.focus()
    }

    // Auto-complete when all digits are filled.
    const joined = next.join('')
    if (joined.length === length && /^\d+$/.test(joined)) {
      onComplete(joined)
    }
  }

  function handleDigitKeyDown(
    e: KeyboardEvent<HTMLInputElement>,
    index: number,
  ) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault()
      const next = [...digits]
      next[index - 1] = ''
      onChange(next)
      inputsRef.current[index - 1]?.focus()
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      inputsRef.current[index - 1]?.focus()
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault()
      inputsRef.current[index + 1]?.focus()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '')
    if (text.length < length) return
    e.preventDefault()
    const pasted = text.slice(0, length).split('')
    onChange(pasted)
    inputsRef.current[length - 1]?.focus()
    onComplete(pasted.join(''))
  }

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            inputsRef.current[i] = el
          }}
          type="text"
          inputMode="numeric"
          pattern="\d*"
          maxLength={1}
          value={d}
          onChange={(e) => handleDigitChange(e, i)}
          onKeyDown={(e) => handleDigitKeyDown(e, i)}
          onPaste={i === 0 ? handlePaste : undefined}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          className={cn(
            'h-12 w-10 rounded-xl border bg-bg-card text-center font-sans text-xl font-semibold text-text-primary outline-none transition-all sm:h-14 sm:w-12 sm:text-2xl',
            'focus:border-border-focus focus:ring-2 focus:ring-gold/20',
            hasError ? 'border-danger ring-2 ring-danger/10' : 'border-border',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        />
      ))}
    </div>
  )
}
