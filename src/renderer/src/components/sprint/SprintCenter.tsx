/**
 * SprintCenter — Two-column neon layout:
 * Left sidebar: CircuitPipeline + repo filter + task list
 * Right content: SprintDetailPane
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmModal } from '../ui/ConfirmModal'
import { CircuitPipeline } from './CircuitPipeline'
import { SprintTaskList } from './SprintTaskList'
import { SprintDetailPane } from './SprintDetailPane'
import { ConflictDrawer } from './ConflictDrawer'
import { HealthCheckDrawer } from './HealthCheckDrawer'
import { usePrConflictsStore } from '../../stores/prConflicts'
import { useUIStore } from '../../stores/ui'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintUI } from '../../stores/sprintUI'
import { useSprintEvents } from '../../stores/sprintEvents'
import { setOpenLogDrawerTaskId, useTaskToasts } from '../../hooks/useTaskNotifications'
import { useSprintPolling } from '../../hooks/useSprintPolling'
import { usePrStatusPolling } from '../../hooks/usePrStatusPolling'
import { useSprintKeyboardShortcuts } from '../../hooks/useSprintKeyboardShortcuts'
import { useSprintTaskActions } from '../../hooks/useSprintTaskActions'
import { useHealthCheck } from '../../hooks/useHealthCheck'
import { REPO_OPTIONS } from '../../lib/constants'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'

import { ErrorBoundary } from '../ui/ErrorBoundary'
import type { SprintTask } from '../../../../shared/types'
export type { SprintTask }

export function SprintCenter() {
  const reduced = useReducedMotion()

  // --- Store state ---
  const { tasks, loading, loadError } = useSprintTasks(
    useShallow((s) => ({
      tasks: s.tasks,
      loading: s.loading,
      loadError: s.loadError
    }))
  )
  const loadData = useSprintTasks((s) => s.loadData)

  const { repoFilter, logDrawerTaskId, statusFilter } = useSprintUI(
    useShallow((s) => ({
      repoFilter: s.repoFilter,
      logDrawerTaskId: s.logDrawerTaskId,
      statusFilter: s.statusFilter
    }))
  )
  const setRepoFilter = useSprintUI((s) => s.setRepoFilter)
  const setLogDrawerTaskId = useSprintUI((s) => s.setLogDrawerTaskId)
  const setStatusFilter = useSprintUI((s) => s.setStatusFilter)

  // --- Extracted hooks ---
  const {
    handleSaveSpec,
    handleMarkDone,
    handleStop,
    handleRerun,
    launchTask,
    deleteTask,
    confirmProps
  } = useSprintTaskActions()

  const { visibleStuckTasks, dismissTask } = useHealthCheck(tasks)

  const setView = useUIStore((s) => s.setView)
  const openWorkbench = useCallback(() => setView('task-workbench'), [setView])

  // --- Local UI state ---
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [conflictDrawerOpen, setConflictDrawerOpen] = useState(false)
  const [healthDrawerOpen, setHealthDrawerOpen] = useState(false)

  const selectedTask = useMemo(
    () => (selectedTaskId ? (tasks.find((t) => t.id === selectedTaskId) ?? null) : null),
    [selectedTaskId, tasks]
  )

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
  const handleViewOutput = useCallback(
    (task: SprintTask) => {
      setLogDrawerTaskId(task.id)
    },
    [setLogDrawerTaskId]
  )
  useTaskToasts(tasks, logDrawerTaskId, handleViewOutput)

  // Extracted polling hooks
  useSprintPolling()
  usePrStatusPolling()
  useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen })

  // Auto-select first task if none selected
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      setSelectedTaskId(tasks[0].id)
    }
  }, [tasks, selectedTaskId])

  const conflictingTaskIds = usePrConflictsStore((s) => s.conflictingTaskIds)
  const conflictingTasks = useMemo(
    () => tasks.filter((t) => conflictingTaskIds.includes(t.id)),
    [tasks, conflictingTaskIds]
  )

  return (
    <motion.div
      className="sprint-center"
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <div className="sprint-center__layout">
        {/* Left: Sidebar (pipeline + filter + task list) */}
        <div className="sprint-center__sidebar">
          {/* Pipeline */}
          <ErrorBoundary name="CircuitPipeline">
            <CircuitPipeline
              tasks={tasks}
              statusFilter={statusFilter}
              onStageClick={setStatusFilter as (filter: string) => void}
            />
          </ErrorBoundary>

          {/* Header */}
          <div className="sprint-center__sidebar-header">
            <span className="sprint-center__sidebar-title">Tasks</span>
            <div className="sprint-center__sidebar-actions">
              {visibleStuckTasks.length > 0 && (
                <button
                  className="conflict-badge-btn"
                  onClick={() => setHealthDrawerOpen(true)}
                  title="Stuck tasks detected"
                >
                  <Badge variant="warning" size="sm">
                    {visibleStuckTasks.length}
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
                    {conflictingTasks.length}
                  </Badge>
                </button>
              )}
              <button className="sprint-center__add-btn" onClick={openWorkbench} title="New Ticket">
                <Plus size={13} />
              </button>
            </div>
          </div>

          {/* Repo Filter */}
          <div className="sprint-center__repo-row">
            {REPO_OPTIONS.map((r) => {
              const active = repoFilter === r.label
              return (
                <button
                  key={r.label}
                  className={`sprint-center__repo-chip ${active ? 'sprint-center__repo-chip--active' : ''}`}
                  onClick={() => setRepoFilter(active ? null : r.label)}
                  style={active ? { borderColor: r.color, color: r.color } : undefined}
                >
                  {r.label}
                </button>
              )
            })}
            <button
              className={`sprint-center__repo-chip ${repoFilter === null ? 'sprint-center__repo-chip--active' : ''}`}
              onClick={() => setRepoFilter(null)}
            >
              All
            </button>
          </div>

          {/* Task List */}
          <ErrorBoundary name="SprintTaskList">
            {loadError && tasks.length === 0 ? (
              <div style={{ padding: '16px', color: 'rgba(255, 255, 255, 0.5)' }}>
                <p style={{ marginBottom: '12px', fontSize: '13px' }}>{loadError}</p>
                <Button variant="primary" size="sm" onClick={loadData} disabled={loading}>
                  {loading ? 'Retrying…' : 'Retry'}
                </Button>
              </div>
            ) : (
              <SprintTaskList
                tasks={tasks}
                selectedTaskId={selectedTaskId}
                onSelectTask={(task) => setSelectedTaskId(task.id)}
                repoFilter={repoFilter}
              />
            )}
          </ErrorBoundary>
        </div>

        {/* Right: Detail Pane */}
        <ErrorBoundary name="SprintDetailPane">
          <div className="sprint-center__content">
            <SprintDetailPane
              task={selectedTask}
              onClose={() => setSelectedTaskId(null)}
              onLaunch={launchTask}
              onStop={handleStop}
              onRerun={handleRerun}
              onMarkDone={handleMarkDone}
              onDelete={deleteTask}
              onSaveSpec={handleSaveSpec}
            />
          </div>
        </ErrorBoundary>
      </div>

      {/* Drawers */}
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
    </motion.div>
  )
}
