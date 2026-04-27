import './ToastContainer.css'
import { motion, AnimatePresence } from 'framer-motion'
import { useToastStore, type Toast } from '../../stores/toasts'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'

function ToastItem({
  toast,
  onDismiss
}: {
  toast: Toast
  onDismiss: () => void
}): React.JSX.Element {
  const modifier =
    toast.type === 'success'
      ? 'toast--success'
      : toast.type === 'error'
        ? 'toast--error'
        : 'toast--info'

  const hasAction = toast.onUndo || toast.onAction

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
      e.preventDefault()
      onDismiss()
    }
  }

  return (
    <div
      className={`toast ${modifier} ${hasAction ? 'toast--has-action' : ''}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      onClick={onDismiss}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <span className="toast__message">{toast.message}</span>
      {toast.onUndo && (
        <button
          className="toast__action-btn"
          onClick={(e) => {
            e.stopPropagation()
            toast.onUndo?.()
            onDismiss()
          }}
        >
          Undo
        </button>
      )}
      {toast.onAction && toast.action && (
        <button
          className="toast__action-btn"
          onClick={(e) => {
            e.stopPropagation()
            toast.onAction?.()
            onDismiss()
          }}
        >
          {toast.action}
        </button>
      )}
    </div>
  )
}

export function ToastContainer(): React.JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)
  const reduced = useReducedMotion()

  if (toasts.length === 0) return null

  // Critical notifications (errors) go in an aria-live=assertive region so
  // screen readers interrupt current narration. Routine notifications stay
  // polite so they don't talk over the user. Combining both in a single
  // polite region let assertive role="alert" toasts get queued behind active
  // narration in some screen readers.
  const errorToasts = toasts.filter((t) => t.type === 'error')
  const routineToasts = toasts.filter((t) => t.type !== 'error')

  return (
    <div className="toast-container" aria-label="Notifications">
      <ToastLiveRegion
        toasts={errorToasts}
        liveness="assertive"
        regionLabel="Error notifications"
        reduced={reduced}
        onDismiss={removeToast}
      />
      <ToastLiveRegion
        toasts={routineToasts}
        liveness="polite"
        regionLabel="Status notifications"
        reduced={reduced}
        onDismiss={removeToast}
      />
    </div>
  )
}

function ToastLiveRegion({
  toasts,
  liveness,
  regionLabel,
  reduced,
  onDismiss
}: {
  toasts: Toast[]
  liveness: 'polite' | 'assertive'
  regionLabel: string
  reduced: boolean | null
  onDismiss: (id: string) => void
}): React.JSX.Element {
  return (
    <div role="region" aria-live={liveness} aria-atomic="true" aria-label={regionLabel}>
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            variants={VARIANTS.slideUp}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
          >
            <ToastItem toast={t} onDismiss={() => onDismiss(t.id)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
