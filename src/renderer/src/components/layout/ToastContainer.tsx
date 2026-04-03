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

  return (
    <div
      className={`toast ${modifier} ${hasAction ? 'toast--has-action' : ''}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      onClick={onDismiss}
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

  return (
    <div
      className="toast-container"
      role="region"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Notifications"
    >
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
            <ToastItem toast={t} onDismiss={() => removeToast(t.id)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
