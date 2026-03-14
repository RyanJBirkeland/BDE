import { useToastStore, type Toast } from '../../stores/toasts'

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const modifier =
    toast.type === 'success'
      ? 'toast--success'
      : toast.type === 'error'
        ? 'toast--error'
        : 'toast--info'

  return (
    <button className={`toast ${modifier}`} onClick={onDismiss}>
      {toast.message}
    </button>
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
