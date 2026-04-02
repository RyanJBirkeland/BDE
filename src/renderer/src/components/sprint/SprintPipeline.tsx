/**
 * SprintPipeline — Three-zone neon pipeline layout:
 * Left: PipelineBacklog | Center: Pipeline stages | Right: TaskDetailDrawer (conditional)
 */
import { useEffect, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { motion, LayoutGroup } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintUI } from '../../stores/sprintUI'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useSprintEvents } from '../../stores/sprintEvents'
import { setOpenLogDrawerTaskId, useTaskToasts } from '../../hooks/useTaskNotifications'
import { useSprintKeyboardShortcuts } from '../../hooks/useSprintKeyboardShortcuts'
import { useSprintTaskActions } from '../../hooks/useSprintTaskActions'
import { useHealthCheckPolling } from '../../hooks/useHealthCheck'
import { useVisibleStuckTasks } from '../../stores/healthCheck'
import { partitionSprintTasks } from '../../lib/partitionSprintTasks'
import { ConfirmModal } from '../ui/ConfirmModal'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'
import { PipelineBacklog } from './PipelineBacklog'
import { PipelineStage } from './PipelineStage'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { PipelineErrorBoundary } from './PipelineErrorBoundary'
import { SpecPanel } from './SpecPanel'
import { DoneHistoryPanel } from './DoneHistoryPanel'
import { ConflictDrawer } from './ConflictDrawer'
import { HealthCheckDrawer } from './HealthCheckDrawer'
import { PipelineFilterBar } from './PipelineFilterBar'
import { NeonCard } from '../neon'
import { GitMerge, HeartPulse } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'

import '../../assets/sprint-pipeline-neon.css'

export function SprintPipeline() {
  // --- Store state ---
  const { tasks, loading, loadError } = useSprintTasks(
    useShallow((s) => ({
      tasks: s.tasks,
      loading: s.loading,
      loadError: s.loadError
    }))
  )
  const updateTask = useSprintTasks((s) => s.updateTask)
  const loadData = useSprintTasks((s) => s.loadData)

  const {
    selectedTaskId,
    drawerOpen,
    specPanelOpen,
    doneViewOpen,
    logDrawerTaskId,
    conflictDrawerOpen,
    healthCheckDrawerOpen
  } = useSprintUI(
    useShallow((s) => ({
      selectedTaskId: s.selectedTaskId,
      drawerOpen: s.drawerOpen,
      specPanelOpen: s.specPanelOpen,
      doneViewOpen: s.doneViewOpen,
      logDrawerTaskId: s.logDrawerTaskId,
      conflictDrawerOpen: s.conflictDrawerOpen,
      healthCheckDrawerOpen: s.healthCheckDrawerOpen
    }))
  )
  const setSelectedTaskId = useSprintUI((s) => s.setSelectedTaskId)
  const setDrawerOpen = useSprintUI((s) => s.setDrawerOpen)
  const setSpecPanelOpen = useSprintUI((s) => s.setSpecPanelOpen)
  const setDoneViewOpen = useSprintUI((s) => s.setDoneViewOpen)
  const setLogDrawerTaskId = useSprintUI((s) => s.setLogDrawerTaskId)
  const setConflictDrawerOpen = useSprintUI((s) => s.setConflictDrawerOpen)
  const setHealthCheckDrawerOpen = useSprintUI((s) => s.setHealthCheckDrawerOpen)
  const setStatusFilter = useSprintUI((s) => s.setStatusFilter)
  const repoFilter = useSprintUI((s) => s.repoFilter)
  const searchQuery = useSprintUI((s) => s.searchQuery)

  const setView = usePanelLayoutStore((s) => s.setView)
  const reduced = useReducedMotion()
  const openWorkbench = useCallback(() => setView('task-workbench'), [setView])

  // --- Extracted hooks ---
  const {
    handleSaveSpec,
    handleStop,
    handleRerun,
    handleRetry,
    launchTask,
    deleteTask,
    confirmProps
  } = useSprintTaskActions()

  // SP-7: Extract health check results for HealthCheckDrawer
  useHealthCheckPolling()
  const { visibleStuckTasks, dismissTask } = useVisibleStuckTasks()

  // --- Local UI state ---

  // Filter + partition tasks
  const filteredTasks = useMemo(() => {
    let result = tasks
    if (repoFilter) result = result.filter((t) => t.repo === repoFilter)
    if (searchQuery) {
      const lower = searchQuery.toLowerCase()
      result = result.filter((t) => t.title.toLowerCase().includes(lower))
    }
    return result
  }, [tasks, repoFilter, searchQuery])

  const partition = useMemo(() => partitionSprintTasks(filteredTasks), [filteredTasks])

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

  // In-app toast notifications
  const handleViewOutput = useCallback(
    (task: SprintTask) => {
      setLogDrawerTaskId(task.id)
    },
    [setLogDrawerTaskId]
  )
  useTaskToasts(tasks, logDrawerTaskId, handleViewOutput)

  // SP-7: Wire setConflictDrawerOpen to actual function (wrapped to match Dispatch<SetStateAction> signature)
  useSprintKeyboardShortcuts({
    openWorkbench: () => setView('task-workbench'),
    setConflictDrawerOpen: (value) => {
      setConflictDrawerOpen(typeof value === 'function' ? value(conflictDrawerOpen) : value)
    }
  })

  // SP-7: Filter tasks with merge conflicts for ConflictDrawer
  const conflictingTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.pr_url &&
          t.pr_number &&
          t.pr_mergeable_state === 'dirty' &&
          (t.status === 'active' || t.status === 'done')
      ),
    [tasks]
  )

  // Auto-select first active or queued task on load
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      const active = partition.inProgress[0] || partition.todo[0]
      if (active) {
        setSelectedTaskId(active.id)
      }
    }
  }, [tasks, selectedTaskId, partition, setSelectedTaskId])

  // --- Callbacks ---
  const handleTaskClick = useCallback(
    (id: string) => {
      setSelectedTaskId(id)
    },
    [setSelectedTaskId]
  )

  const handleAddToQueue = useCallback(
    async (task: SprintTask) => {
      try {
        await updateTask(task.id, { status: 'queued' })
      } catch (err) {
        // Error already shown by updateTask, no need to show again
        // The store will revert the optimistic update
      }
    },
    [updateTask]
  )

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
    setSelectedTaskId(null)
  }, [setDrawerOpen, setSelectedTaskId])

  const handleDeleteTask = useCallback(
    (task: SprintTask) => {
      void deleteTask(task.id)
    },
    [deleteTask]
  )

  const handleUnblock = useCallback(
    async (task: SprintTask) => {
      try {
        await window.api.sprint.unblockTask(task.id)
        toast.success(`Task unblocked - dependencies will be re-checked`)
      } catch (err) {
        toast.error(`Failed to unblock: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    []
  )

  // Stats
  const headerStats = useMemo(
    () => [
      { label: 'active', count: partition.inProgress.length, filter: 'in-progress' as const },
      { label: 'queued', count: partition.todo.length, filter: 'todo' as const },
      { label: 'blocked', count: partition.blocked.length, filter: 'blocked' as const },
      { label: 'review', count: partition.awaitingReview.length, filter: 'awaiting-review' as const },
      { label: 'failed', count: partition.failed.length, filter: 'failed' as const },
      { label: 'done', count: partition.done.length, filter: 'done' as const }
    ],
    [partition]
  )

  return (
    <motion.div
      className="sprint-pipeline"
      data-testid="sprint-pipeline"
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <header className="sprint-pipeline__header">
        <h1 className="sprint-pipeline__title">Task Pipeline</h1>
        <div className="sprint-pipeline__stats">
          {headerStats.map((stat) => (
            <span
              key={stat.label}
              className={`sprint-pipeline__stat sprint-pipeline__stat--${stat.label} sprint-pipeline__stat--clickable`}
              onClick={() => setStatusFilter(stat.filter)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setStatusFilter(stat.filter)
              }}
            >
              <b className="sprint-pipeline__stat-count">{stat.count}</b> {stat.label}
            </span>
          ))}
        </div>
        {conflictingTasks.length > 0 && (
          <button
            className="sprint-pipeline__badge sprint-pipeline__badge--danger"
            onClick={() => setConflictDrawerOpen(true)}
            title={`${conflictingTasks.length} PR conflict${conflictingTasks.length > 1 ? 's' : ''}`}
            aria-label={`${conflictingTasks.length} merge conflict${conflictingTasks.length > 1 ? 's' : ''}`}
          >
            <GitMerge size={12} />
            <span>{conflictingTasks.length}</span>
          </button>
        )}
        {visibleStuckTasks.length > 0 && (
          <button
            className="sprint-pipeline__badge sprint-pipeline__badge--warning"
            onClick={() => setHealthCheckDrawerOpen(true)}
            title={`${visibleStuckTasks.length} stuck task${visibleStuckTasks.length > 1 ? 's' : ''}`}
            aria-label={`${visibleStuckTasks.length} stuck task${visibleStuckTasks.length > 1 ? 's' : ''}`}
          >
            <HeartPulse size={12} />
            <span>{visibleStuckTasks.length}</span>
          </button>
        )}
      </header>

      <PipelineFilterBar tasks={tasks} />

      {loading && tasks.length === 0 && (
        <div className="sprint-pipeline__body">
          <div className="pipeline-sidebar" style={{ opacity: 0.3 }}>
            <div className="bde-skeleton" style={{ height: 200 }} />
          </div>
          <div className="pipeline-center" style={{ opacity: 0.3 }}>
            <div className="bde-skeleton" style={{ height: 64 }} />
            <div className="bde-skeleton" style={{ height: 64 }} />
            <div className="bde-skeleton" style={{ height: 64 }} />
          </div>
        </div>
      )}

      {loadError && (
        <div className="pipeline-empty-state">
          <p className="pipeline-empty-state__title">Error loading tasks</p>
          <p className="pipeline-empty-state__hint pipeline-empty-state__hint--spaced">
            {loadError}
          </p>
          <Button variant="primary" size="sm" onClick={loadData} disabled={loading}>
            {loading ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      )}

      {!loading && !loadError && tasks.length === 0 && (
        <div style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}>
          <NeonCard accent="purple" title="No tasks yet">
            <p className="sprint-pipeline__empty-text">
              Create your first task to start the pipeline.
            </p>
            <button className="task-drawer__btn task-drawer__btn--primary" onClick={openWorkbench}>
              New Task
            </button>
          </NeonCard>
        </div>
      )}

      <PipelineErrorBoundary fallbackLabel="Pipeline crashed">
      <div className="sprint-pipeline__body" style={{ display: tasks.length === 0 ? 'none' : undefined }}>
        <PipelineBacklog
          backlog={partition.backlog}
          failed={partition.failed}
          onTaskClick={handleTaskClick}
          onAddToQueue={handleAddToQueue}
          onRerun={handleRerun}
        />

        <div className="pipeline-center">
          <LayoutGroup>
            <PipelineStage
              name="queued"
              label="Queued"
              tasks={partition.todo}
              count={`${partition.todo.length}`}
              selectedTaskId={selectedTaskId}
              onTaskClick={handleTaskClick}
            />
            <PipelineStage
              name="blocked"
              label="Blocked"
              tasks={partition.blocked}
              count={`${partition.blocked.length}`}
              selectedTaskId={selectedTaskId}
              onTaskClick={handleTaskClick}
            />
            <PipelineStage
              name="active"
              label="Active"
              tasks={partition.inProgress}
              count={`${partition.inProgress.length}/5`}
              selectedTaskId={selectedTaskId}
              onTaskClick={handleTaskClick}
            />
            <PipelineStage
              name="review"
              label="Review"
              tasks={partition.awaitingReview}
              count={`${partition.awaitingReview.length}`}
              selectedTaskId={selectedTaskId}
              onTaskClick={handleTaskClick}
            />
            <PipelineStage
              name="done"
              label="Done"
              tasks={partition.done.slice(0, 3)}
              count={`${partition.done.length}`}
              selectedTaskId={selectedTaskId}
              onTaskClick={handleTaskClick}
              doneFooter={
                partition.done.length > 3 ? (
                  <button
                    className="pipeline-stage__done-summary"
                    onClick={() => setDoneViewOpen(true)}
                  >
                    {partition.done.length} completed · View all
                  </button>
                ) : undefined
              }
            />
          </LayoutGroup>
        </div>

        {drawerOpen && selectedTask && (
          <TaskDetailDrawer
            task={selectedTask}
            onClose={handleCloseDrawer}
            onLaunch={launchTask}
            onStop={handleStop}
            onRerun={handleRerun}
            onDelete={handleDeleteTask}
            onViewLogs={() => setView('agents')}
            onOpenSpec={() => setSpecPanelOpen(true)}
            onEdit={() => {
              useTaskWorkbenchStore.getState().loadTask(selectedTask)
              setView('task-workbench')
            }}
            onViewAgents={() => setView('agents')}
            onUnblock={handleUnblock}
            onRetry={handleRetry}
          />
        )}
      </div>
      </PipelineErrorBoundary>

      {specPanelOpen && selectedTask?.spec && (
        <SpecPanel
          taskTitle={selectedTask.title}
          spec={selectedTask.spec}
          onClose={() => setSpecPanelOpen(false)}
          onSave={(newSpec) => handleSaveSpec(selectedTask.id, newSpec)}
        />
      )}

      {doneViewOpen && (
        <DoneHistoryPanel
          tasks={partition.done}
          onTaskClick={handleTaskClick}
          onClose={() => setDoneViewOpen(false)}
        />
      )}

      <ConfirmModal {...confirmProps} />

      {/* SP-7: Wire ConflictDrawer and HealthCheckDrawer */}
      <ConflictDrawer
        open={conflictDrawerOpen}
        tasks={conflictingTasks}
        onClose={() => setConflictDrawerOpen(false)}
      />

      <HealthCheckDrawer
        open={healthCheckDrawerOpen}
        tasks={visibleStuckTasks}
        onClose={() => setHealthCheckDrawerOpen(false)}
        onDismiss={dismissTask}
      />
    </motion.div>
  )
}
