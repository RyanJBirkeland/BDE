/**
 * PromptModal — native-feel prompt dialog that replaces window.prompt().
 * Renders a modal overlay with a message, text input, confirm, and cancel buttons.
 * Supports keyboard: Enter to confirm, Escape to cancel.
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from './Button'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface PromptModalProps {
  open: boolean
  title?: string
  message: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptModal({
  open,
  title,
  message,
  placeholder,
  defaultValue = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel
}: PromptModalProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      // Focus the input when the modal opens
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [open, defaultValue])

  const handleConfirm = useCallback(() => {
    if (value.trim()) {
      onConfirm(value)
    }
  }, [value, onConfirm])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        handleConfirm()
      }
    },
    [onCancel, handleConfirm]
  )

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="prompt-modal__overlay" onClick={onCancel} />
          <motion.div
            ref={dialogRef}
            className="prompt-modal glass-modal elevation-3"
            variants={VARIANTS.scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
            onKeyDown={handleKeyDown}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'prompt-modal-title' : undefined}
            aria-describedby="prompt-modal-message"
          >
            {title && (
              <div className="prompt-modal__title" id="prompt-modal-title">
                {title}
              </div>
            )}
            <div className="prompt-modal__message" id="prompt-modal-message">
              {message}
            </div>
            <input
              ref={inputRef}
              type="text"
              className="prompt-modal__input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              aria-label={message}
            />
            <div className="prompt-modal__actions">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                {cancelLabel}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleConfirm}
                disabled={!value.trim()}
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
 * usePrompt — stateful hook for managing PromptModal visibility.
 * Returns a `prompt` function and props to spread onto <PromptModal />.
 */
export function usePrompt(): {
  prompt: (opts: {
    message: string
    title?: string
    placeholder?: string
    defaultValue?: string
    confirmLabel?: string
  }) => Promise<string | null>
  promptProps: PromptModalProps
} {
  const resolveRef = useRef<((value: string | null) => void) | null>(null)
  const [state, setState] = usePromptState()

  const prompt = useCallback(
    (opts: {
      message: string
      title?: string
      placeholder?: string
      defaultValue?: string
      confirmLabel?: string
    }) => {
      return new Promise<string | null>((resolve) => {
        resolveRef.current = resolve
        setState({
          open: true,
          message: opts.message,
          title: opts.title,
          placeholder: opts.placeholder,
          defaultValue: opts.defaultValue,
          confirmLabel: opts.confirmLabel
        })
      })
    },
    [setState]
  )

  const handleConfirm = useCallback(
    (value: string) => {
      resolveRef.current?.(value)
      resolveRef.current = null
      setState((prev) => ({ ...prev, open: false }))
    },
    [setState]
  )

  const handleCancel = useCallback(() => {
    resolveRef.current?.(null)
    resolveRef.current = null
    setState((prev) => ({ ...prev, open: false }))
  }, [setState])

  return {
    prompt,
    promptProps: {
      open: state.open,
      message: state.message,
      title: state.title,
      placeholder: state.placeholder,
      defaultValue: state.defaultValue,
      confirmLabel: state.confirmLabel,
      onConfirm: handleConfirm,
      onCancel: handleCancel
    }
  }
}

// Internal: minimal state hook for usePrompt
import { useState as useStateInternal } from 'react'

interface PromptState {
  open: boolean
  message: string
  title?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
}

function usePromptState(): [PromptState, React.Dispatch<React.SetStateAction<PromptState>>] {
  return useStateInternal<PromptState>({ open: false, message: '' })
}
