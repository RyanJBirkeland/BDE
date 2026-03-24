import { useState, useCallback } from 'react'
import { HeartPulse, RotateCcw, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { toast } from '../../stores/toasts'
import { TASK_STATUS } from '../../../../shared/constants'
import type { SprintTask } from '../../../../shared/types'

type HealthCheckDrawerProps = {
  open: boolean
  tasks: SprintTask[]
  onClose: () => void
  onDismiss: (taskId: string) => void
}

function minutesAgo(isoDate: string | null): number {
  if (!isoDate) return 0
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 60_000)
}

export function HealthCheckDrawer({ open, tasks, onClose, onDismiss }: HealthCheckDrawerProps) {
  const [rescuing, setRescuing] = useState<string | null>(null)

  const handleRescue = useCallback(async (task: SprintTask) => {
    setRescuing(task.id)
    try {
      await window.api.sprint.update(task.id, { status: TASK_STATUS.QUEUED, agent_run_id: null })
      toast.success(`"${task.title}" reset to queued`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to rescue task')
    } finally {
      setRescuing(null)
    }
  }, [])

  return (
    <>
      {open && <div className="health-drawer__overlay" onClick={onClose} />}
      <div className={`health-drawer ${open ? 'health-drawer--open' : ''}`}>
        <div className="health-drawer__header">
          <div className="health-drawer__header-left">
            <HeartPulse size={14} />
            <span className="health-drawer__title">Stuck Tasks</span>
            <Badge variant="warning" size="sm">{tasks.length}</Badge>
          </div>
          <Button variant="icon" size="sm" onClick={onClose} title="Close" aria-label="Close">
            &#x2715;
          </Button>
        </div>

        <div className="health-drawer__body">
          {tasks.length === 0 ? (
            <div className="health-drawer__empty">No stuck tasks detected.</div>
          ) : (
            tasks.map((task) => {
              const mins = minutesAgo(task.started_at)
              return (
                <div key={task.id} className="health-row">
                  <div className="health-row__info">
                    <span className="health-row__title">{task.title}</span>
                    <span className="health-row__meta">
                      Active for {mins} min &middot; agent appears to have stopped
                    </span>
                  </div>
                  <div className="health-row__actions">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={rescuing === task.id}
                      onClick={() => handleRescue(task)}
                      title="Reset to queued so it can be relaunched"
                    >
                      <RotateCcw size={13} />
                      {rescuing === task.id ? 'Rescuing...' : 'Rescue'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDismiss(task.id)}
                      title="Hide from this list"
                    >
                      <X size={13} /> Dismiss
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="health-drawer__footer">
          <span className="health-drawer__hint">
            Rescue resets a stuck task to queued so you can relaunch the agent.
          </span>
        </div>
      </div>
    </>
  )
}
