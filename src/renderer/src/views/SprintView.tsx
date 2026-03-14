/**
 * SprintView — sprint planning and PR tracking.
 * Renders a kanban-style SprintBoard (from SPRINT.md) alongside a GitHub
 * PRList showing open pull requests. Data fetched via IPC (read-sprint-md)
 * and gateway RPC.
 */
import SprintBoard from '../components/sprint/SprintBoard'
import PRList from '../components/sprint/PRList'

export default function SprintView() {
  return (
    <div className="sprint-view">
      <div className="sprint-view__board">
        <SprintBoard />
      </div>
      <div className="sprint-view__prs">
        <PRList />
      </div>
    </div>
  )
}
