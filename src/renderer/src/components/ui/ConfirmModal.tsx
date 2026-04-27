/**
 * ConfirmModal — native-feel confirmation dialog that replaces window.confirm().
 * Renders a modal overlay with a message, confirm, and cancel buttons.
 * Supports keyboard: Enter to confirm, Escape to cancel.
 */
import { useEffect, useRef, useCallback, useId } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

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
  const confirmRef = useRef<HTMLButtonElement>(null)
  const messageId = useId()

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => confirmRef.current?.focus())
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      role="alertdialog"
      size="sm"
      hideCloseButton
      ariaDescribedBy={messageId}
    >
      <p className="confirm-modal__message" id={messageId}>
        {message}
      </p>
      <div className="modal__footer">
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
    </Modal>
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
