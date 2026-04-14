/**
 * SprintPipeline — Three-zone neon pipeline layout:
 * Left: PipelineBacklog | Center: Pipeline stages | Right: TaskDetailDrawer (conditional)
 */
import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { motion, LayoutGroup } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { useSprintFilters } from '../../stores/sprintFilters'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { setOpenLogDrawerTaskId, useTaskToasts } from '../../hooks/useTaskNotifications'
import { useSprintKeyboardShortcuts } from '../../hooks/useSprintKeyboardShortcuts'
import { useSprintTaskActions } from '../../hooks/useSprintTaskActions'
import { useVisibleStuckTasks } from '../../hooks/useVisibleStuckTasks'
import { useSprintPipelineState } from '../../hooks/useSprintPipelineState'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'
import { PipelineBacklog } from './PipelineBacklog'
import { PipelineStage } from './PipelineStage'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { PipelineErrorBoundary } from './PipelineErrorBoundary'
import { PipelineFilterBar } from './PipelineFilterBar'
import { PipelineFilterBanner } from './PipelineFilterBanner'
import { PipelineHeader } from './PipelineHeader'
import { PipelineOverlays } from './PipelineOverlays'
import { DagOverlay } from './DagOverlay'
import { BulkActionBar } from './BulkActionBar'
import { NeonCard } from '../neon'
import type { SprintTask } from '../../../../shared/types'
import { useSprintPipelineCommands } from '../../hooks/useSprintPipelineCommands'

import './SprintPipeline.css'

export function SprintPipeline(): React.JSX.Element {
  // --- Centralised store state ---
  const {
    tasks,
    loading,
    loadError,
    updateTask,
    loadData,
    batchRequeueTasks,
    selectedTaskId,
    selectedTaskIds,
    drawerOpen,
    specPanelOpen,
    logDrawerTaskId,
    setSelectedTaskId,
    setDrawerOpen,
    setSpecPanelOpen,
    setLogDrawerTaskId,
    clearMultiSelection,
    doneViewOpen,
    conflictDrawerOpen,
    healthCheckDrawerOpen,
    setDoneViewOpen,
    setConflictDrawerOpen,
    setHealthCheckDrawerOpen,
    selectCodeReviewTask,
    initTaskOutputListener,
    filteredTasks,
    filteredPartition,
    partition,
    selectedTask,
    conflictingTasks
  } = useSprintPipelineState()

  const setStatusFilter = useSprintFilters((s) => s.setStatusFilter)
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
    batchDeleteTasks,
    confirmProps
  } = useSprintTaskActions()

  // SP-7: Health check polling runs in PollingProvider; just read results here
  const { visibleStuckTasks, dismissTask } = useVisibleStuckTasks()

  // --- Focus management ---
  const triggerRef = useRef<HTMLElement | null>(null)

  const loadTaskInWorkbench = useTaskWorkbenchStore((s) => s.loadTask)

  // Register sprint commands in command palette
  useSprintPipelineCommands({
    openWorkbench,
    handleStop,
    handleRetry,
    setStatusFilter
  })

  // --- Local UI state ---
  const [dagOpen, setDagOpen] = useState(false)

  // Subscribe to live task output events
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
      triggerRef.current = document.activeElement as HTMLElement
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
    requestAnimationFrame(() => {
      triggerRef.current?.focus()
      triggerRef.current = null
    })
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
    (task: SprintTask): void => {
      selectCodeReviewTask(task.id)
      setView('code-review')
    },
    [selectCodeReviewTask, setView]
  )

  const handleClearFailures = useCallback(() => {
    const failedIds = filteredPartition.failed.map((t) => t.id)
    void batchDeleteTasks(failedIds)
  }, [filteredPartition.failed, batchDeleteTasks])

  const handleRequeueAllFailed = useCallback(() => {
    const failedIds = filteredPartition.failed.map((t) => t.id)
    void batchRequeueTasks(failedIds)
  }, [filteredPartition.failed, batchRequeueTasks])

  const handleExport = useCallback(async (task: SprintTask) => {
    try {
      const result = await window.api.sprint.exportTaskHistory(task.id)
      if (result.success) {
        toast.success(`Task history exported to ${result.path}`)
      }
    } catch (err) {
      toast.error(`Failed to export: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

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
        onDagToggle={() => setDagOpen(!dagOpen)}
        dagOpen={dagOpen}
      />

      <BulkActionBar
        selectedCount={selectedTaskIds.size}
        selectedTaskIds={selectedTaskIds}
        onClearSelection={clearMultiSelection}
      />

      <PipelineFilterBar tasks={tasks} />

      <PipelineFilterBanner filteredTasks={filteredTasks} totalTasks={tasks} />

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
            onClearFailures={handleClearFailures}
            onRequeueAllFailed={handleRequeueAllFailed}
          />

          <div className="pipeline-center">
            <LayoutGroup>
              <PipelineStage
                name="queued"
                label="Queued"
                tasks={filteredPartition.todo}
                count={`${filteredPartition.todo.length}`}
                selectedTaskId={selectedTaskId}
                selectedTaskIds={selectedTaskIds}
                onTaskClick={handleTaskClick}
              />
              <PipelineStage
                name="blocked"
                label="Blocked"
                tasks={filteredPartition.blocked}
                count={`${filteredPartition.blocked.length}`}
                selectedTaskId={selectedTaskId}
                selectedTaskIds={selectedTaskIds}
                onTaskClick={handleTaskClick}
              />
              <PipelineStage
                name="active"
                label="Active"
                tasks={filteredPartition.inProgress}
                count={`${filteredPartition.inProgress.length}/5`}
                selectedTaskId={selectedTaskId}
                selectedTaskIds={selectedTaskIds}
                onTaskClick={handleTaskClick}
              />
              <PipelineStage
                name="review"
                label="Review"
                tasks={filteredPartition.awaitingReview}
                count={`${filteredPartition.awaitingReview.length}`}
                selectedTaskId={selectedTaskId}
                selectedTaskIds={selectedTaskIds}
                onTaskClick={handleTaskClick}
              />
              <PipelineStage
                name="done"
                label="Done"
                tasks={filteredPartition.done.slice(0, 3)}
                count={`${filteredPartition.done.length}`}
                selectedTaskId={selectedTaskId}
                selectedTaskIds={selectedTaskIds}
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
                loadTaskInWorkbench(selectedTask)
                setView('task-workbench')
              }}
              onViewAgents={() => setView('agents')}
              onUnblock={handleUnblock}
              onRetry={handleRetry}
              onReviewChanges={handleReviewChanges}
              onExport={handleExport}
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

      {dagOpen && (
        <DagOverlay
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={(taskId) => {
            setSelectedTaskId(taskId)
            setDrawerOpen(true)
          }}
          onClose={() => setDagOpen(false)}
        />
      )}
    </motion.div>
  )
}
