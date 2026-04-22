'use client'

/**
 * Accessible confirmation dialog wrapping Radix Dialog.
 *
 * Use this in place of `window.confirm()` for any destructive or
 * non-trivial action. Radix handles focus trap, Escape-to-dismiss,
 * scroll lock, portal rendering, and aria-labelling — free WCAG wins
 * versus both native `confirm()` (not styleable, some browsers block)
 * and home-rolled `<div role="dialog">` (no focus trap, Escape handling
 * or focus-return).
 *
 * Variants:
 *   - Simple yes/no (most call sites): pass `title`, `description`, and
 *     confirm / cancel labels. Optional `tone="danger"` for red confirm.
 *   - Typed confirmation: pass `typedConfirmation` with a `phrase` the
 *     user must type exactly before the confirm button enables. Mirrors
 *     the pattern the old delete-account dialog used by hand.
 *
 * This component is deliberately opinionated about copy and styling so
 * every dialog looks and behaves the same.
 */

import { useState, useTransition } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  /**
   * Called when the user confirms. Wrapped in `startTransition` — the
   * component displays the pending state on the confirm button and
   * prevents double-submit. Return a promise so we know when to close.
   */
  onConfirm: () => Promise<void> | void
  /**
   * Optional typed-confirmation gate. Confirm button stays disabled
   * until the user types the exact phrase.
   *
   * The typed value is NOT trimmed before comparison — trailing
   * whitespace counts as a mismatch. That's deliberate: this variant
   * is only used for destructive actions (delete account, etc.) where
   * stricter matching is safer than more forgiving matching.
   */
  typedConfirmation?: {
    phrase: string
    inputLabel: React.ReactNode
    inputPlaceholder?: string
  }
  /**
   * Extra slot rendered between the description and the action buttons.
   * Use for error messages, form fields, or additional context.
   */
  children?: React.ReactNode
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  typedConfirmation,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const [isPending, startTransition] = useTransition()

  const confirmEnabled =
    !isPending &&
    (!typedConfirmation || typed === typedConfirmation.phrase)

  function handleConfirm() {
    startTransition(async () => {
      await onConfirm()
    })
  }

  function handleOpenChange(next: boolean) {
    if (!next && isPending) {
      // Block close attempts mid-confirm so users can't dismiss an
      // action they've started. Radix respects a no-op handler.
      return
    }
    if (!next) setTyped('')
    onOpenChange(next)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-bg-card p-6 shadow-xl',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <Dialog.Title className="font-serif text-xl font-bold text-text-primary">
              {title}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-lg p-1 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Close dialog"
              disabled={isPending}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <Dialog.Description asChild>
            <div className="space-y-3 text-sm text-text-primary/80">
              {description}
            </div>
          </Dialog.Description>

          {typedConfirmation && (
            <div className="mt-4">
              <label
                htmlFor="confirm-dialog-typed"
                className="block text-sm font-medium text-text-primary"
              >
                {typedConfirmation.inputLabel}
              </label>
              <input
                id="confirm-dialog-typed"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                placeholder={typedConfirmation.inputPlaceholder}
                className="mt-1 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </div>
          )}

          {children && <div className="mt-4">{children}</div>}

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close
              className={cn(
                'rounded-full border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-secondary disabled:opacity-50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
              )}
              disabled={isPending}
            >
              {cancelLabel}
            </Dialog.Close>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!confirmEnabled}
              className={cn(
                'rounded-full px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
                tone === 'danger'
                  ? 'bg-danger hover:bg-danger/90'
                  : 'bg-gold hover:bg-gold-hover',
              )}
            >
              {isPending ? `${confirmLabel}\u2026` : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
