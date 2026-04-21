// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { OtpDigits } from '../OtpDigits'

// ── Test harness ───────────────────────────────────────────────────────────
// OtpDigits is a controlled component — tests use a tiny wrapper that
// holds the digit state so we can simulate real interaction.

function Harness({
  onComplete,
  initial = ['', '', '', '', '', ''],
  disabled = false,
  hasError = false,
}: {
  onComplete?: (code: string) => void
  initial?: string[]
  disabled?: boolean
  hasError?: boolean
}) {
  const [digits, setDigits] = useState(initial)
  return (
    <OtpDigits
      digits={digits}
      onChange={setDigits}
      onComplete={onComplete ?? (() => {})}
      disabled={disabled}
      hasError={hasError}
    />
  )
}

function getInputs(): HTMLInputElement[] {
  return screen.getAllByRole('textbox', {
    name: /digit \d of 6/i,
  }) as HTMLInputElement[]
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('OtpDigits', () => {
  it('renders 6 single-digit inputs by default', () => {
    render(<Harness />)
    const inputs = getInputs()
    expect(inputs.length).toBe(6)
    inputs.forEach((i) => {
      expect(i.maxLength).toBe(1)
      expect(i.getAttribute('inputmode')).toBe('numeric')
    })
  })

  it('auto-advances focus to the next cell on digit entry', () => {
    render(<Harness />)
    const inputs = getInputs()

    inputs[0].focus()
    fireEvent.change(inputs[0], { target: { value: '1' } })

    expect(document.activeElement).toBe(inputs[1])
  })

  it('strips non-digit characters on input', () => {
    render(<Harness initial={['1', '', '', '', '', '']} />)
    const inputs = getInputs()
    fireEvent.change(inputs[1], { target: { value: 'a' } })
    // The input value should be empty after the change because 'a' is not a digit
    expect(inputs[1].value).toBe('')
  })

  it('moves focus left and clears previous digit when Backspace pressed on empty cell', () => {
    render(<Harness initial={['1', '2', '', '', '', '']} />)
    const inputs = getInputs()

    inputs[2].focus()
    fireEvent.keyDown(inputs[2], { key: 'Backspace' })

    expect(document.activeElement).toBe(inputs[1])
    // The harness re-renders with the cleared state
    expect(getInputs()[1].value).toBe('')
  })

  it('does NOT move focus on Backspace when current cell has a digit', () => {
    render(<Harness initial={['1', '2', '3', '', '', '']} />)
    const inputs = getInputs()

    inputs[2].focus()
    fireEvent.keyDown(inputs[2], { key: 'Backspace' })

    // Focus stays where it was; native input handler clears the value
    expect(document.activeElement).toBe(inputs[2])
  })

  it('moves focus left and right with arrow keys', () => {
    render(<Harness initial={['1', '2', '3', '4', '5', '6']} />)
    const inputs = getInputs()

    inputs[3].focus()
    fireEvent.keyDown(inputs[3], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(inputs[2])

    fireEvent.keyDown(inputs[2], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(inputs[3])
  })

  it('fills all cells and fires onComplete when a 6-digit string is pasted', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const inputs = getInputs()

    fireEvent.paste(inputs[0], {
      clipboardData: { getData: () => '123456' },
    })

    // After re-render, all six inputs should hold the pasted digits
    const after = getInputs()
    expect(after.map((i) => i.value).join('')).toBe('123456')
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('strips non-digits from pasted text before filling', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const inputs = getInputs()

    fireEvent.paste(inputs[0], {
      clipboardData: { getData: () => '1-2 3.4 5/6' },
    })

    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('ignores pastes shorter than length', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const inputs = getInputs()

    fireEvent.paste(inputs[0], {
      clipboardData: { getData: () => '123' },
    })

    expect(onComplete).not.toHaveBeenCalled()
  })

  it('fires onComplete when the last digit is typed', () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} initial={['1', '2', '3', '4', '5', '']} />)
    const inputs = getInputs()

    fireEvent.change(inputs[5], { target: { value: '6' } })

    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('disables every cell when disabled prop is true', () => {
    render(<Harness disabled={true} />)
    const inputs = getInputs()
    inputs.forEach((i) => expect(i.disabled).toBe(true))
  })

  it('shows error styling when hasError prop is true', () => {
    render(<Harness hasError={true} />)
    const inputs = getInputs()
    expect(inputs[0].className).toContain('border-danger')
  })

  it('refocuses cell 1 when digits are reset from non-empty to empty', async () => {
    // Simulates the parent clearing digits after a verification error.
    function ResetHarness() {
      const [digits, setDigits] = useState(['1', '2', '3', '4', '5', '6'])
      return (
        <>
          <button
            data-testid="reset"
            onClick={() => setDigits(['', '', '', '', '', ''])}
          >
            reset
          </button>
          <OtpDigits
            digits={digits}
            onChange={setDigits}
            onComplete={() => {}}
          />
        </>
      )
    }

    render(<ResetHarness />)
    // Cell 6 is focused as if the user just typed digit 6.
    const inputs = getInputs()
    inputs[5].focus()
    expect(document.activeElement).toBe(inputs[5])

    // Trigger the reset.
    fireEvent.click(screen.getByTestId('reset'))

    // After the digits go from non-empty to empty, focus should jump to cell 1.
    await new Promise((r) => setTimeout(r, 0)) // flush the effect
    const after = getInputs()
    expect(document.activeElement).toBe(after[0])
  })

  it('does NOT refocus on initial mount when digits start empty', () => {
    // Mount with empty digits. None of the cells should auto-focus —
    // initial focus is whatever the document had before render. Tested
    // here by asserting no input has focus right after mount.
    render(<Harness />)
    const inputs = getInputs()
    inputs.forEach((i) => expect(document.activeElement).not.toBe(i))
  })
})
