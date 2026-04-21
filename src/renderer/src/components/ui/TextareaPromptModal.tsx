/**
 * TextareaPromptModal — native-feel textarea prompt dialog.
 * Like PromptModal but with a textarea for multi-line input.
 * Supports keyboard: Cmd+Enter to confirm, Escape to cancel.
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from './Button'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface TextareaPromptModalProps {
  open: boolean
  title?: string | undefined
  message: string
  placeholder?: string | undefined
  defaultValue?: string | undefined
  confirmLabel?: string | undefined
  cancelLabel?: string | undefined
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function TextareaPromptModal({
  open,
  title,
  message,
  placeholder,
  defaultValue = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel
}: TextareaPromptModalProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(defaultValue)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  // eslint-disable-next-line react-hooks/refs -- sync ref for escape key handler
  valueRef.current = value
  useFocusTrap(dialogRef, open)

  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      // Focus the textarea when the modal opens
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      })
    }
  }, [open, defaultValue])

  const handleConfirm = useCallback(() => {
    // Read from the textarea DOM element to avoid stale closure issues
    const current = textareaRef.current?.value ?? valueRef.current
    if (current.trim()) {
      onConfirm(current)
    }
  }, [onConfirm])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
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
            aria-labelledby={title ? 'textarea-prompt-modal-title' : undefined}
            aria-describedby="textarea-prompt-modal-message"
          >
            {title && (
              <div className="prompt-modal__title" id="textarea-prompt-modal-title">
                {title}
              </div>
            )}
            <div className="prompt-modal__message" id="textarea-prompt-modal-message">
              {message}
            </div>
            <textarea
              ref={textareaRef}
              className="prompt-modal__textarea"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              aria-labelledby="textarea-prompt-modal-message"
              rows={6}
            />
            <div className="prompt-modal__hint">Press Cmd+Enter to confirm, Escape to cancel</div>
            <div className="prompt-modal__actions">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                {cancelLabel}
              </Button>
              <Button variant="primary" size="sm" onClick={handleConfirm} disabled={!value.trim()}>
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
 * useTextareaPrompt — stateful hook for managing TextareaPromptModal visibility.
 * Returns a `prompt` function and props to spread onto <TextareaPromptModal />.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTextareaPrompt(): {
  prompt: (opts: {
    message: string
    title?: string | undefined
    placeholder?: string | undefined
    defaultValue?: string | undefined
    confirmLabel?: string | undefined
  }) => Promise<string | null>
  promptProps: TextareaPromptModalProps
} {
  const resolveRef = useRef<((value: string | null) => void) | null>(null)
  const [state, setState] = usePromptState()

  const prompt = useCallback(
    (opts: {
      message: string
      title?: string | undefined
      placeholder?: string | undefined
      defaultValue?: string | undefined
      confirmLabel?: string | undefined
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

// Internal: minimal state hook for useTextareaPrompt
import { useState as useStateInternal } from 'react'

interface PromptState {
  open: boolean
  message: string
  title?: string | undefined
  placeholder?: string | undefined
  defaultValue?: string | undefined
  confirmLabel?: string | undefined
}

function usePromptState(): [PromptState, React.Dispatch<React.SetStateAction<PromptState>>] {
  return useStateInternal<PromptState>({ open: false, message: '' })
}
