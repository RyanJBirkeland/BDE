import { useCallback, useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'

interface ActionButtonsProps {
  task: SprintTask
  onLaunch: (t: SprintTask) => void
  onStop: (t: SprintTask) => void
  onRerun: (t: SprintTask) => void
  onDelete: (t: SprintTask) => void
  onViewLogs: (t: SprintTask) => void
  onEdit: (t: SprintTask) => void
  onUnblock?: (t: SprintTask) => void
  onRetry?: (t: SprintTask) => void
}

export function TaskDetailActionButtons({
  task,
  onLaunch,
  onStop,
  onRerun,
  onDelete,
  onViewLogs,
  onEdit,
  onUnblock,
  onRetry
}: ActionButtonsProps): React.JSX.Element {
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const isLoading = loadingAction !== null

  const handleAction = useCallback(
    async (actionName: string, handler: (t: SprintTask) => void | Promise<void>) => {
      setLoadingAction(actionName)
      try {
        await Promise.resolve(handler(task))
      } catch (error) {
        // Error is handled by parent (e.g., toast notification)
        // Just clear loading state
        console.error(`Action ${actionName} failed:`, error)
      } finally {
        setLoadingAction(null)
      }
    },
    [task]
  )
  switch (task.status) {
    case 'backlog':
      return (
        <>
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => handleAction('launch', onLaunch)}
            disabled={isLoading}
            aria-busy={loadingAction === 'launch'}
          >
            {loadingAction === 'launch' && <Loader2 size={12} className="spinner" />}
            Launch
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => handleAction('edit', onEdit)}
            disabled={isLoading}
            aria-busy={loadingAction === 'edit'}
          >
            {loadingAction === 'edit' && <Loader2 size={12} className="spinner" />}
            Edit
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--danger"
            onClick={() => handleAction('delete', onDelete)}
            disabled={isLoading}
            aria-busy={loadingAction === 'delete'}
          >
            {loadingAction === 'delete' && <Loader2 size={12} className="spinner" />}
            Delete
          </button>
        </>
      )
    case 'queued':
      return (
        <>
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => handleAction('launch', onLaunch)}
            disabled={isLoading}
            aria-busy={loadingAction === 'launch'}
          >
            {loadingAction === 'launch' && <Loader2 size={12} className="spinner" />}
            Launch
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => handleAction('edit', onEdit)}
            disabled={isLoading}
            aria-busy={loadingAction === 'edit'}
          >
            {loadingAction === 'edit' && <Loader2 size={12} className="spinner" />}
            Edit
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--danger"
            onClick={() => handleAction('delete', onDelete)}
            disabled={isLoading}
            aria-busy={loadingAction === 'delete'}
          >
            {loadingAction === 'delete' && <Loader2 size={12} className="spinner" />}
            Delete
          </button>
        </>
      )
    case 'blocked':
      return (
        <>
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => handleAction('unblock', onUnblock ?? onLaunch)}
            disabled={isLoading}
            aria-busy={loadingAction === 'unblock'}
          >
            {loadingAction === 'unblock' && <Loader2 size={12} className="spinner" />}
            Unblock
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => handleAction('edit', onEdit)}
            disabled={isLoading}
            aria-busy={loadingAction === 'edit'}
          >
            {loadingAction === 'edit' && <Loader2 size={12} className="spinner" />}
            Edit
          </button>
        </>
      )
    case 'active':
      return (
        <>
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => handleAction('viewLogs', onViewLogs)}
            disabled={isLoading}
            aria-busy={loadingAction === 'viewLogs'}
          >
            {loadingAction === 'viewLogs' && <Loader2 size={12} className="spinner" />}
            View Logs
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => handleAction('edit', onEdit)}
            disabled={isLoading}
            aria-busy={loadingAction === 'edit'}
          >
            {loadingAction === 'edit' && <Loader2 size={12} className="spinner" />}
            Edit
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--danger"
            onClick={() => handleAction('stop', onStop)}
            disabled={isLoading}
            aria-busy={loadingAction === 'stop'}
          >
            {loadingAction === 'stop' && <Loader2 size={12} className="spinner" />}
            Stop
          </button>
        </>
      )
    case 'done':
      return (
        <>
          {task.pr_url &&
            (() => {
              // Validate pr_url is a GitHub URL to prevent XSS
              try {
                const url = new URL(task.pr_url)
                if (url.hostname !== 'github.com') return null
                return (
                  <a
                    className="task-drawer__btn task-drawer__btn--primary"
                    href={task.pr_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View PR
                  </a>
                )
              } catch {
                return null
              }
            })()}
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => handleAction('clone', onRerun)}
            disabled={isLoading}
            aria-busy={loadingAction === 'clone'}
          >
            {loadingAction === 'clone' && <Loader2 size={12} className="spinner" />}
            Clone & Queue
          </button>
        </>
      )
    case 'failed':
    case 'error':
    case 'cancelled':
      return (
        <>
          {(task.status === 'failed' || task.status === 'error') && onRetry && (
            <button
              className="task-drawer__btn task-drawer__btn--primary"
              onClick={() => handleAction('retry', onRetry)}
              disabled={isLoading}
              aria-busy={loadingAction === 'retry'}
            >
              {loadingAction === 'retry' ? (
                <Loader2 size={12} className="spinner" />
              ) : (
                <RefreshCw size={12} />
              )}{' '}
              Retry
            </button>
          )}
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => handleAction('clone', onRerun)}
            disabled={isLoading}
            aria-busy={loadingAction === 'clone'}
          >
            {loadingAction === 'clone' && <Loader2 size={12} className="spinner" />}
            Clone & Queue
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => handleAction('edit', onEdit)}
            disabled={isLoading}
            aria-busy={loadingAction === 'edit'}
          >
            {loadingAction === 'edit' && <Loader2 size={12} className="spinner" />}
            Edit
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--danger"
            onClick={() => handleAction('delete', onDelete)}
            disabled={isLoading}
            aria-busy={loadingAction === 'delete'}
          >
            {loadingAction === 'delete' && <Loader2 size={12} className="spinner" />}
            Delete
          </button>
        </>
      )
    default:
      return <></>
  }
}
