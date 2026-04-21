/**
 * ConfirmModal — native-feel confirmation dialog that replaces window.confirm().
 * Renders a modal overlay with a message, confirm, and cancel buttons.
 * Supports keyboard: Enter to confirm, Escape to cancel.
 */
import { useEffect, useRef, useCallback, useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from './Button'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface ConfirmModalProps {
  open: boolean
  title?: string | undefined
  message: string
  confirmLabel?: string | undefined
  cancelLabel?: string | undefined
  variant?: 'danger' | 'default' | undefined
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel
}: ConfirmModalProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const messageId = useId()
  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (open) {
      // Focus the confirm button when the modal opens
      requestAnimationFrame(() => confirmRef.current?.focus())
    }
  }, [open])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    },
    [onCancel]
  )

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="confirm-modal__overlay" onClick={onCancel} />
          <motion.div
            ref={dialogRef}
            className="confirm-modal glass-modal elevation-3"
            variants={VARIANTS.scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
            onKeyDown={handleKeyDown}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={messageId}
          >
            {title && (
              <div className="confirm-modal__title" id={titleId}>
                {title}
              </div>
            )}
            <div className="confirm-modal__message" id={messageId}>
              {message}
            </div>
            <div className="confirm-modal__actions">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                {cancelLabel}
              </Button>
              <Button
                ref={confirmRef}
                variant={variant === 'danger' ? 'danger' : 'primary'}
                size="sm"
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/**
 * useConfirm — stateful hook for managing ConfirmModal visibility.
 * Returns a `confirm` function and props to spread onto <ConfirmModal />.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): {
  confirm: (opts: {
    message: string
    title?: string | undefined
    confirmLabel?: string | undefined
    variant?: 'danger' | 'default' | undefined
  }) => Promise<boolean>
  confirmProps: ConfirmModalProps
} {
  const resolveRef = useRef<((value: boolean) => void) | null>(null)
  const [state, setState] = useConfirmState()

  const confirm = useCallback(
    (opts: {
      message: string
      title?: string | undefined
      confirmLabel?: string | undefined
      variant?: 'danger' | 'default' | undefined
    }) => {
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve
        setState({
          open: true,
          message: opts.message,
          title: opts.title,
          confirmLabel: opts.confirmLabel,
          variant: opts.variant
        })
      })
    },
    [setState]
  )

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true)
    resolveRef.current = null
    setState((prev) => ({ ...prev, open: false }))
  }, [setState])

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false)
    resolveRef.current = null
    setState((prev) => ({ ...prev, open: false }))
  }, [setState])

  return {
    confirm,
    confirmProps: {
      open: state.open,
      message: state.message,
      title: state.title,
      confirmLabel: state.confirmLabel,
      variant: state.variant,
      onConfirm: handleConfirm,
      onCancel: handleCancel
    }
  }
}

// Internal: minimal state hook for useConfirm
import { useState } from 'react'

interface ConfirmState {
  open: boolean
  message: string
  title?: string | undefined
  confirmLabel?: string | undefined
  variant?: 'danger' | 'default' | undefined
}

function useConfirmState(): [ConfirmState, React.Dispatch<React.SetStateAction<ConfirmState>>] {
  return useState<ConfirmState>({ open: false, message: '' })
}
