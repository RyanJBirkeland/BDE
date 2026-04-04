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
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'
import { PipelineBacklog } from './PipelineBacklog'
import { PipelineStage } from './PipelineStage'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { PipelineErrorBoundary } from './PipelineErrorBoundary'
import { PipelineFilterBar } from './PipelineFilterBar'
import { PipelineHeader } from './PipelineHeader'
import { PipelineOverlays } from './PipelineOverlays'
import { NeonCard } from '../neon'
import { useCodeReviewStore } from '../../stores/codeReview'
import type { SprintTask } from '../../../../shared/types'

import '../../assets/sprint-pipeline-neon.css'

export function SprintPipeline(): React.JSX.Element {
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
  const statusFilter = useSprintUI((s) => s.statusFilter)
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

  // Apply status filter to partition buckets
  const filteredPartition = useMemo(() => {
    if (statusFilter === 'all') return partition

    const emptyBucket: SprintTask[] = []
    switch (statusFilter) {
      case 'backlog':
        return {
          ...partition,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'todo':
        return {
          ...partition,
          backlog: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'blocked':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'in-progress':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'awaiting-review':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'done':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          failed: emptyBucket
        }
      case 'failed':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket
        }
      default:
        return partition
    }
  }, [partition, statusFilter])

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
      } catch (_err) {
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

  const handleUnblock = useCallback(async (task: SprintTask) => {
    try {
      await window.api.sprint.unblockTask(task.id)
      toast.success(`Task unblocked - dependencies will be re-checked`)
    } catch (err) {
      toast.error(`Failed to unblock: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const handleReviewChanges = useCallback(
    (task: SprintTask) => {
      useCodeReviewStore.getState().selectTask(task.id)
      setView('code-review')
    },
    [setView]
  )

  // Stats
  const headerStats = useMemo(
    () => [
      { label: 'active', count: partition.inProgress.length, filter: 'in-progress' as const },
      { label: 'queued', count: partition.todo.length, filter: 'todo' as const },
      { label: 'blocked', count: partition.blocked.length, filter: 'blocked' as const },
      {
        label: 'review',
        count: partition.awaitingReview.length,
        filter: 'awaiting-review' as const
      },
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
      <PipelineHeader
        stats={headerStats}
        conflictingTasks={conflictingTasks}
        visibleStuckTasks={visibleStuckTasks}
        onFilterClick={setStatusFilter}
        onConflictClick={() => setConflictDrawerOpen(true)}
        onHealthCheckClick={() => setHealthCheckDrawerOpen(true)}
      />

      <PipelineFilterBar tasks={tasks} />

      {loading && tasks.length === 0 && (
        <div className="sprint-pipeline__body">
          <div className="pipeline-sidebar pipeline-sidebar--loading">
            <div className="bde-skeleton pipeline-skeleton--sidebar" />
          </div>
          <div className="pipeline-center pipeline-center--loading">
            <div className="bde-skeleton pipeline-skeleton--stage" />
            <div className="bde-skeleton pipeline-skeleton--stage" />
            <div className="bde-skeleton pipeline-skeleton--stage" />
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
        <div className="sprint-pipeline__empty-container">
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
        <div
          className={`sprint-pipeline__body ${tasks.length === 0 ? 'sprint-pipeline__body--hidden' : ''}`}
        >
          <PipelineBacklog
            backlog={filteredPartition.backlog}
            failed={filteredPartition.failed}
            onTaskClick={handleTaskClick}
            onAddToQueue={handleAddToQueue}
            onRerun={handleRerun}
          />

          <div className="pipeline-center">
            <LayoutGroup>
              <PipelineStage
                name="queued"
                label="Queued"
                tasks={filteredPartition.todo}
                count={`${filteredPartition.todo.length}`}
                selectedTaskId={selectedTaskId}
                onTaskClick={handleTaskClick}
              />
              <PipelineStage
                name="blocked"
                label="Blocked"
                tasks={filteredPartition.blocked}
                count={`${filteredPartition.blocked.length}`}
                selectedTaskId={selectedTaskId}
                onTaskClick={handleTaskClick}
              />
              <PipelineStage
                name="active"
                label="Active"
                tasks={filteredPartition.inProgress}
                count={`${filteredPartition.inProgress.length}/5`}
                selectedTaskId={selectedTaskId}
                onTaskClick={handleTaskClick}
              />
              <PipelineStage
                name="review"
                label="Review"
                tasks={filteredPartition.awaitingReview}
                count={`${filteredPartition.awaitingReview.length}`}
                selectedTaskId={selectedTaskId}
                onTaskClick={handleTaskClick}
              />
              <PipelineStage
                name="done"
                label="Done"
                tasks={filteredPartition.done.slice(0, 3)}
                count={`${filteredPartition.done.length}`}
                selectedTaskId={selectedTaskId}
                onTaskClick={handleTaskClick}
                doneFooter={
                  filteredPartition.done.length > 3 ? (
                    <button
                      className="pipeline-stage__done-summary"
                      onClick={() => setDoneViewOpen(true)}
                    >
                      {filteredPartition.done.length} completed · View all
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
              onReviewChanges={handleReviewChanges}
            />
          )}
        </div>
      </PipelineErrorBoundary>

      <PipelineOverlays
        specPanelOpen={specPanelOpen}
        selectedTask={selectedTask}
        onCloseSpec={() => setSpecPanelOpen(false)}
        onSaveSpec={handleSaveSpec}
        doneViewOpen={doneViewOpen}
        doneTasks={filteredPartition.done}
        onCloseDoneView={() => setDoneViewOpen(false)}
        onTaskClick={handleTaskClick}
        conflictDrawerOpen={conflictDrawerOpen}
        conflictingTasks={conflictingTasks}
        onCloseConflict={() => setConflictDrawerOpen(false)}
        healthCheckDrawerOpen={healthCheckDrawerOpen}
        visibleStuckTasks={visibleStuckTasks}
        onCloseHealthCheck={() => setHealthCheckDrawerOpen(false)}
        onDismissStuckTask={dismissTask}
        confirmProps={confirmProps}
      />
    </motion.div>
  )
}
