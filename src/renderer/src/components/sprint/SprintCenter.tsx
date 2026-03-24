import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmModal } from '../ui/ConfirmModal'
import { KanbanBoard } from './KanbanBoard'
import { TaskTable } from './TaskTable'
import { SpecDrawer } from './SpecDrawer'
import { LogDrawer } from './LogDrawer'
import { ConflictDrawer } from './ConflictDrawer'
import { HealthCheckDrawer } from './HealthCheckDrawer'
import { usePrConflictsStore } from '../../stores/prConflicts'
import { useUIStore } from '../../stores/ui'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintUI } from '../../stores/sprintUI'
import { useSprintEvents } from '../../stores/sprintEvents'
import { partitionSprintTasks } from '../../lib/partitionSprintTasks'
import { setOpenLogDrawerTaskId, useTaskToasts } from '../../hooks/useTaskNotifications'
import { useSprintPolling } from '../../hooks/useSprintPolling'
import { usePrStatusPolling } from '../../hooks/usePrStatusPolling'
import { useSprintKeyboardShortcuts } from '../../hooks/useSprintKeyboardShortcuts'
import { useSprintTaskActions } from '../../hooks/useSprintTaskActions'
import { useHealthCheck } from '../../hooks/useHealthCheck'
import { REPO_OPTIONS } from '../../lib/constants'

import { ErrorBoundary } from '../ui/ErrorBoundary'
import type { SprintTask } from '../../../../shared/types'
export type { SprintTask }

// --- Component ---

export function SprintCenter() {
  // --- Store state ---
  const tasks = useSprintTasks((s) => s.tasks)
  const loading = useSprintTasks((s) => s.loading)
  const loadError = useSprintTasks((s) => s.loadError)
  const repoFilter = useSprintUI((s) => s.repoFilter)
  const selectedTaskId = useSprintUI((s) => s.selectedTaskId)
  const logDrawerTaskId = useSprintUI((s) => s.logDrawerTaskId)
  const prMergedMap = useSprintTasks((s) => s.prMergedMap)
  const generatingIds = useSprintUI((s) => s.generatingIds)

  const loadData = useSprintTasks((s) => s.loadData)
  const setRepoFilter = useSprintUI((s) => s.setRepoFilter)
  const setSelectedTaskId = useSprintUI((s) => s.setSelectedTaskId)
  const setLogDrawerTaskId = useSprintUI((s) => s.setLogDrawerTaskId)

  // --- Extracted hooks ---
  const {
    handleDragEnd,
    handleReorder,
    handlePushToSprint,
    handleViewSpec,
    handleSaveSpec,
    handleMarkDone,
    handleStop,
    handleRerun,
    handleUpdateTitle,
    handleUpdatePriority,
    handleEditInWorkbench,
    launchTask,
    deleteTask,
    confirmProps,
  } = useSprintTaskActions()

  const { visibleStuckTasks, dismissTask } = useHealthCheck(tasks)

  const setView = useUIStore((s) => s.setView)
  const openWorkbench = useCallback(() => setView('task-workbench'), [setView])

  // --- Local UI state ---
  const [backlogSearch, setBacklogSearch] = useState('')
  const [conflictDrawerOpen, setConflictDrawerOpen] = useState(false)
  const [healthDrawerOpen, setHealthDrawerOpen] = useState(false)

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null),
    [selectedTaskId, tasks]
  )
  const logDrawerTask = logDrawerTaskId ? (tasks.find((t) => t.id === logDrawerTaskId) ?? null) : null

  // Subscribe to live task output events
  const initTaskOutputListener = useSprintEvents((s) => s.initTaskOutputListener)
  useEffect(() => {
    const cleanup = initTaskOutputListener()
    return cleanup
  }, [initTaskOutputListener])

  // Keep notification hook aware of which task's LogDrawer is open
  useEffect(() => {
    setOpenLogDrawerTaskId(logDrawerTaskId)
    return () => setOpenLogDrawerTaskId(null)
  }, [logDrawerTaskId])

  // In-app toast notifications for agent-done and PR-opened transitions
  const handleViewOutput = useCallback((task: SprintTask) => {
    setLogDrawerTaskId(task.id)
  }, [setLogDrawerTaskId])
  useTaskToasts(tasks, logDrawerTaskId, handleViewOutput)

  // Extracted polling hooks
  useSprintPolling()
  usePrStatusPolling()
  useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen })

  const conflictingTaskIds = usePrConflictsStore((s) => s.conflictingTaskIds)
  const conflictingTasks = useMemo(
    () => tasks.filter((t) => conflictingTaskIds.has(t.id)),
    [tasks, conflictingTaskIds]
  )

  const filteredTasks = repoFilter
    ? tasks.filter((t) => t.repo.toLowerCase() === repoFilter.toLowerCase())
    : tasks

  const partition = useMemo(() => partitionSprintTasks(filteredTasks), [filteredTasks])

  const filteredBacklog = useMemo(() => {
    if (!backlogSearch.trim()) return partition.backlog
    const q = backlogSearch.trim().toLowerCase()
    return partition.backlog.filter((t) => t.title.toLowerCase().includes(q))
  }, [partition.backlog, backlogSearch])

  return (
    <div className="sprint-center">
      <div className="sprint-center__header">
        <div className="sprint-center__title-row">
          <span className="sprint-center__title text-gradient-aurora">SPRINT CENTER</span>
          <div className="sprint-board__repo-switcher">
            {REPO_OPTIONS.map((r) => (
              <button
                key={r.label}
                onClick={() => setRepoFilter(repoFilter === r.label ? null : r.label)}
                className={`sprint-board__repo-chip ${repoFilter === r.label ? 'sprint-board__repo-chip--active' : ''}`}
                style={
                  repoFilter === r.label ? { borderColor: r.color, color: r.color } : undefined
                }
              >
                <span className="sprint-board__repo-dot" style={{ background: r.color }} />
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setRepoFilter(null)}
              className={`sprint-board__repo-chip ${repoFilter === null ? 'sprint-board__repo-chip--active' : ''}`}
            >
              All
            </button>
          </div>
        </div>
        <div className="sprint-center__actions">
          {visibleStuckTasks.length > 0 && (
            <button
              className="conflict-badge-btn"
              onClick={() => setHealthDrawerOpen(true)}
              title="Stuck tasks detected"
            >
              <Badge variant="warning" size="sm">
                {visibleStuckTasks.length} stuck
              </Badge>
            </button>
          )}
          {conflictingTasks.length > 0 && (
            <button
              className="conflict-badge-btn"
              onClick={() => setConflictDrawerOpen(true)}
              title="View merge conflicts"
            >
              <Badge variant="danger" size="sm">
                {conflictingTasks.length} conflict{conflictingTasks.length > 1 ? 's' : ''}
              </Badge>
            </button>
          )}
          <kbd className="sprint-center__shortcut-hint" title="Keyboard shortcuts">
            N — New ticket &nbsp; Esc — Close
          </kbd>
          <Button variant="primary" size="sm" onClick={openWorkbench}>
            + New Ticket
          </Button>
          <Button variant="icon" size="sm" onClick={loadData} disabled={loading} title="Refresh" aria-label="Refresh">
            &#x21bb;
          </Button>
        </div>
      </div>

      <div className="sprint-center__body">
        {loadError && tasks.length === 0 ? (
          <div className="sprint-center__error">
            <p className="sprint-center__error-message">{loadError}</p>
            <Button variant="primary" size="sm" onClick={loadData} disabled={loading}>
              {loading ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        ) : loading && tasks.length === 0 ? (
          <div className="kanban-board">
            {['To Do', 'In Progress', 'Awaiting Review'].map((label) => (
              <div key={label} className="kanban-col">
                <div className="kanban-col__header">
                  {label} <span className="sprint-col__count bde-count-badge">&mdash;</span>
                </div>
                <div className="kanban-col__cards">
                  <div className="sprint-board__skeleton" />
                  <div className="sprint-board__skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <ErrorBoundary name="KanbanBoard">
            <KanbanBoard
              todoTasks={partition.todo}
              activeTasks={partition.inProgress}
              awaitingReviewTasks={partition.awaitingReview}
              prMergedMap={prMergedMap}
              generatingIds={generatingIds}
              onDragEnd={(taskId, newStatus) => handleDragEnd(taskId, newStatus, tasks)}
              onReorder={handleReorder}
              onPushToSprint={handlePushToSprint}
              onLaunch={launchTask}
              onViewSpec={handleViewSpec}
              onViewOutput={handleViewOutput}
              onMarkDone={handleMarkDone}
              onStop={handleStop}
            />
            </ErrorBoundary>

            <div className="bde-backlog-search">
              <input
                type="text"
                className="bde-backlog-search__input"
                placeholder="Search backlog..."
                value={backlogSearch}
                onChange={(e) => setBacklogSearch(e.target.value)}
              />
              {backlogSearch && (
                <button
                  className="bde-backlog-search__clear"
                  onClick={() => setBacklogSearch('')}
                  title="Clear search"
                >
                  &times;
                </button>
              )}
            </div>

            <ErrorBoundary name="Backlog">
            <TaskTable
              section="backlog"
              tasks={filteredBacklog}
              onPushToSprint={handlePushToSprint}
              onViewSpec={handleViewSpec}
              onViewOutput={handleViewOutput}
              onMarkDone={handleMarkDone}
              onUpdate={handleUpdatePriority}
              onEditInWorkbench={handleEditInWorkbench}
            />
            </ErrorBoundary>

            <ErrorBoundary name="Done Tasks">
            <TaskTable
              section="done"
              tasks={partition.done}
              defaultExpanded={false}
              onPushToSprint={handlePushToSprint}
              onViewSpec={handleViewSpec}
              onViewOutput={handleViewOutput}
              onRerun={handleRerun}
            />
            </ErrorBoundary>

            {partition.failed.length > 0 && (
              <ErrorBoundary name="Failed Tasks">
              <TaskTable
                section="failed"
                tasks={partition.failed}
                defaultExpanded={false}
                onPushToSprint={handlePushToSprint}
                onViewSpec={handleViewSpec}
                onViewOutput={handleViewOutput}
              />
              </ErrorBoundary>
            )}
          </>
        )}
      </div>

      <SpecDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskId(null)}
        onSave={handleSaveSpec}
        onLaunch={launchTask}
        onPushToSprint={handlePushToSprint}
        onMarkDone={handleMarkDone}
        onUpdate={handleUpdateTitle}
        onDelete={deleteTask}
      />

      <LogDrawer task={logDrawerTask} onClose={() => setLogDrawerTaskId(null)} onStop={handleStop} onRerun={handleRerun} />

      <ConflictDrawer
        open={conflictDrawerOpen}
        tasks={conflictingTasks}
        onClose={() => setConflictDrawerOpen(false)}
      />

      <HealthCheckDrawer
        open={healthDrawerOpen}
        tasks={visibleStuckTasks}
        onClose={() => setHealthDrawerOpen(false)}
        onDismiss={dismissTask}
      />

      <ConfirmModal {...confirmProps} />
    </div>
  )
}
