import { useToastStore, type Toast } from '../../stores/toasts'

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const modifier =
    toast.type === 'success'
      ? 'toast--success'
      : toast.type === 'error'
        ? 'toast--error'
        : 'toast--info'

  const hasAction = toast.onUndo || toast.onAction

  return (
    <div className={`toast ${modifier} ${hasAction ? 'toast--has-action' : ''}`} onClick={onDismiss}>
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

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
      ))}
    </div>
  )
}
