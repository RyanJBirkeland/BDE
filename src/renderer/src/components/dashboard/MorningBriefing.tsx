import { useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { NeonCard } from '../neon'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION } from '../../lib/motion'
import type { SprintTask, AgentCostRecord } from '../../../../shared/types'

interface MorningBriefingProps {
  tasks: SprintTask[]
  localAgents: AgentCostRecord[]
  onReviewAll: () => void
  onDismiss: () => void
}

interface TaskWithCost {
  title: string
  cost: number | null
}

export function MorningBriefing({
  tasks,
  localAgents,
  onReviewAll,
  onDismiss
}: MorningBriefingProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const transition = reduced ? REDUCED_TRANSITION : SPRINGS.snappy

  // Match tasks with their cost data
  const tasksWithCost = useMemo((): TaskWithCost[] => {
    return tasks.slice(0, 5).map((task) => {
      const agent =
        localAgents.find((a) => a.sprintTaskId === task.id) ??
        localAgents.find((a) => a.id === task.agent_run_id)
      return {
        title: task.title,
        cost: agent?.costUsd ?? null
      }
    })
  }, [tasks, localAgents])

  // Calculate total cost
  const totalCost = useMemo(() => {
    return tasksWithCost.reduce((sum, t) => sum + (t.cost ?? 0), 0)
  }, [tasksWithCost])

  return (
    <motion.div
      className="dashboard-briefing"
      variants={reduced ? undefined : VARIANTS.fadeIn}
      initial={reduced ? undefined : 'initial'}
      animate={reduced ? undefined : 'animate'}
      exit={reduced ? undefined : 'exit'}
      transition={transition}
    >
      <NeonCard accent="cyan" title="Morning Briefing">
        <div className="dashboard-briefing__content">
          <p className="dashboard-briefing__text">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} completed since last session
          </p>

          {tasksWithCost.length > 0 && (
            <div className="dashboard-briefing__tasks">
              {tasksWithCost.map((task, i) => (
                <div key={i} className="dashboard-briefing__task-row">
                  <span className="dashboard-briefing__task-title" title={task.title}>
                    {task.title}
                  </span>
                  <span className="dashboard-briefing__task-cost">
                    {task.cost !== null ? `$${task.cost.toFixed(3)}` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {totalCost > 0 && (
            <div className="dashboard-briefing__total">
              <span className="dashboard-briefing__total-label">Total Cost</span>
              <span className="dashboard-briefing__total-value">${totalCost.toFixed(3)}</span>
            </div>
          )}

          <div className="dashboard-briefing__actions">
            <button
              className="dashboard-briefing__button dashboard-briefing__button--primary"
              onClick={onReviewAll}
            >
              Review All
            </button>
            <button
              className="dashboard-briefing__button dashboard-briefing__button--secondary"
              onClick={onDismiss}
            >
              Dismiss
            </button>
          </div>
        </div>
      </NeonCard>
    </motion.div>
  )
}
