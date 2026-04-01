/**
 * SprintPipeline — Three-zone neon pipeline layout:
 * Left: PipelineBacklog | Center: Pipeline stages | Right: TaskDetailDrawer (conditional)
 */
import { useEffect, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LayoutGroup } from 'framer-motion'
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
import { Spinner } from '../ui/Spinner'
import { PipelineBacklog } from './PipelineBacklog'
import { PipelineStage } from './PipelineStage'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { SpecPanel } from './SpecPanel'
import { DoneHistoryPanel } from './DoneHistoryPanel'
import { ConflictDrawer } from './ConflictDrawer'
import { HealthCheckDrawer } from './HealthCheckDrawer'
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

  const setView = usePanelLayoutStore((s) => s.setView)

  // --- Extracted hooks ---
  const {
    handleSaveSpec,
    handleStop,
    handleRerun,
    launchTask,
    deleteTask,
    confirmProps
  } = useSprintTaskActions()

  // SP-7: Extract health check results for HealthCheckDrawer
  useHealthCheckPolling()
  const { visibleStuckTasks, dismissTask } = useVisibleStuckTasks()

  // --- Local UI state ---

  // Partition tasks
  const partition = useMemo(() => partitionSprintTasks(tasks), [tasks])

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
          ['awaiting-review', 'in-progress'].includes(t.status)
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
  const activeCount = partition.inProgress.length
  const queuedCount = partition.todo.length
  const doneCount = partition.done.length

  return (
    <div className="sprint-pipeline">
      <header className="sprint-pipeline__header">
        <h1 className="sprint-pipeline__title">Task Pipeline</h1>
        <div className="sprint-pipeline__stats">
          <span className="sprint-pipeline__stat">
            <b>{activeCount}</b> active
          </span>
          <span className="sprint-pipeline__stat">
            <b>{queuedCount}</b> queued
          </span>
          <span className="sprint-pipeline__stat">
            <b>{doneCount}</b> done
          </span>
        </div>
      </header>

      {loading && tasks.length === 0 && (
        <div className="pipeline-empty-state">
          <Spinner size="md" />
          <p className="pipeline-empty-state__title">Loading tasks...</p>
        </div>
      )}

      {loadError && (
        <div className="pipeline-empty-state">
          <p className="pipeline-empty-state__title">Error loading tasks</p>
          <p className="pipeline-empty-state__hint" style={{ marginBottom: '12px' }}>
            {loadError}
          </p>
          <Button variant="primary" size="sm" onClick={loadData} disabled={loading}>
            {loading ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      )}

      {!loading && !loadError && tasks.length === 0 && (
        <div className="pipeline-empty-state">
          <p className="pipeline-empty-state__title">No tasks yet</p>
          <p className="pipeline-empty-state__hint">
            Open Task Workbench (Cmd+0) to create your first task
          </p>
        </div>
      )}

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
              tasks={partition.done.slice(0, 5)}
              count={`${partition.done.length}`}
              selectedTaskId={selectedTaskId}
              onTaskClick={handleTaskClick}
              doneFooter={
                partition.done.length > 5 ? (
                  <div className="pipeline-stage__done-footer">
                    Showing 5 of {partition.done.length} ·{' '}
                    <button
                      className="pipeline-stage__done-link"
                      onClick={() => setDoneViewOpen(true)}
                    >
                      View all &rarr;
                    </button>
                  </div>
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
          />
        )}
      </div>

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
    </div>
  )
}
