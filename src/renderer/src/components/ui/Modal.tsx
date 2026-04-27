import { useCallback, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import './Modal.css'

export type ModalSize = 'sm' | 'md' | 'lg' | 'fullscreen'

interface ModalProps {
  open: boolean
  onClose: () => void
  /**
   * Title rendered in the header. Strings get the default heading style; pass a
   * ReactNode for custom layouts. Omitting both `title` and `aria-labelledby`
   * means the dialog has no accessible name — only do that when the body itself
   * carries an obvious label.
   */
  title?: ReactNode
  /** Override the auto-derived `aria-labelledby` (only useful when `title` is omitted). */
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  /** Semantic role. Default `dialog`; alerts/confirmations use `alertdialog`. */
  role?: 'dialog' | 'alertdialog'
  /** Size preset. `lg` = 1200×800 (the workbench); `fullscreen` = 95vw / 90vh. */
  size?: ModalSize
  /** Hide the X button in the header. Header still renders if `title` is set. */
  hideCloseButton?: boolean
  /** Disable backdrop-click dismissal. */
  closeOnBackdrop?: boolean
  /** Disable Escape-key dismissal. */
  closeOnEsc?: boolean
  /** Extra class on the dialog element (NOT the backdrop). */
  className?: string
  children: ReactNode
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'modal--sm',
  md: 'modal--md',
  lg: 'modal--lg',
  fullscreen: 'modal--fullscreen'
}

/**
 * Modal — single primitive for centered dialogs across the app.
 *
 * Behaviour:
 * - Renders via `createPortal` to `document.body` so it escapes panel
 *   `overflow: hidden` ancestors.
 * - Backdrop click and Escape both call `onClose` (each can be disabled).
 * - Focus is trapped inside the dialog; on close, focus returns to the
 *   element that was focused before the modal opened (handled by
 *   `useFocusTrap`).
 * - Animates in/out via framer-motion `scaleIn` variant; respects
 *   `prefers-reduced-motion`.
 *
 * For confirmations and prompts, prefer the `ConfirmModal` / `PromptModal`
 * wrappers — they compose Modal with the right body and footer.
 */
export function Modal({
  open,
  onClose,
  title,
  ariaLabelledBy,
  ariaDescribedBy,
  role = 'dialog',
  size = 'sm',
  hideCloseButton = false,
  closeOnBackdrop = true,
  closeOnEsc = true,
  className,
  children
}: ModalProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusTrap(dialogRef, open)

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (!closeOnBackdrop) return
      if (e.target === e.currentTarget) onClose()
    },
    [closeOnBackdrop, onClose]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    },
    [closeOnEsc, onClose]
  )

  // Auto-derive aria-labelledby when title is a string we can label.
  const labelledBy = ariaLabelledBy ?? (title != null ? titleId : undefined)

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="modal__backdrop"
            onClick={handleBackdropClick}
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
          />
          <motion.div
            ref={dialogRef}
            className={joinClassNames('modal', SIZE_CLASS[size], className)}
            role={role}
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-describedby={ariaDescribedBy}
            onKeyDown={handleKeyDown}
            variants={VARIANTS.scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
          >
            {(title != null || !hideCloseButton) && (
              <header className="modal__header">
                {title != null && (
                  <h2 id={titleId} className="modal__title">
                    {title}
                  </h2>
                )}
                {!hideCloseButton && (
                  <button
                    type="button"
                    className="modal__close"
                    onClick={onClose}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                )}
              </header>
            )}
            <div className="modal__body">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}

function joinClassNames(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ')
}
