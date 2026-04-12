import './ReviewActions.css'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { ReviewActionsBar } from './ReviewActionsBar'

export function ReviewActions(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const tasks = useSprintTasks((s) => s.tasks)
  const task = tasks.find((t) => t.id === selectedTaskId)

  if (!task || task.status !== 'review') {
    return (
      <div className="cr-actions">
        <span className="cr-actions__hint">Select a task in review to see actions</span>
      </div>
    )
  }

  return (
    <div className="cr-actions">
      <ReviewActionsBar variant="full" />
    </div>
  )
}
