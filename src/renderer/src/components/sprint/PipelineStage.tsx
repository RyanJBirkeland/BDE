import { AnimatePresence } from 'framer-motion'
import { TaskPill } from './TaskPill'
import type { SprintTask } from '../../../../shared/types'

interface PipelineStageProps {
  name: 'queued' | 'blocked' | 'active' | 'review' | 'done'
  label: string
  tasks: SprintTask[]
  count: string
  selectedTaskId: string | null
  onTaskClick: (id: string) => void
  doneFooter?: React.ReactNode
}

export function PipelineStage({
  name,
  label,
  tasks,
  count,
  selectedTaskId,
  onTaskClick,
  doneFooter
}: PipelineStageProps) {
  const empty = tasks.length === 0 && !doneFooter

  return (
    <div className={`pipeline-stage${empty ? ' pipeline-stage--empty' : ''}`} data-testid={`pipeline-stage-${name}`}>
      <div className={`pipeline-stage__dot pipeline-stage__dot--${name}${empty ? ' pipeline-stage__dot--dim' : ''}`}>
        {tasks.length}
      </div>
      <div className="pipeline-stage__header">
        <div className={`pipeline-stage__name pipeline-stage__name--${name}`}>{label}</div>
        {!empty && <div className="pipeline-stage__count">{count}</div>}
      </div>
      {!empty && (
        <div className="pipeline-stage__cards">
          <AnimatePresence mode="popLayout">
            {tasks.map((task) => (
              <TaskPill
                key={task.id}
                task={task}
                selected={task.id === selectedTaskId}
                onClick={onTaskClick}
              />
            ))}
          </AnimatePresence>
          {doneFooter}
        </div>
      )}
    </div>
  )
}
