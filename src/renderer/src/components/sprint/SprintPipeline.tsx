/**
 * SprintPipeline — Three-zone neon pipeline layout:
 * Left: PipelineBacklog | Center: Pipeline stages | Right: TaskDetailDrawer (conditional)
 */
import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
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
import { useVisibleStuckTasks } from '../../stores/healthCheck'
import { partitionSprintTasks } from '../../lib/partitionSprintTasks'
import { parseTaskQuery, applyPredicates } from '../../lib/task-query'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'
import { PipelineBacklog } from './PipelineBacklog'
import { PipelineStage } from './PipelineStage'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { PipelineErrorBoundary } from './PipelineErrorBoundary'
import { PipelineFilterBar } from './PipelineFilterBar'
import { PipelineHeader } from './PipelineHeader'
import { PipelineOverlays } from './PipelineOverlays'
import { DagOverlay } from './DagOverlay'
import { BulkActionBar } from './BulkActionBar'
import { NeonCard } from '../neon'
import { useCodeReviewStore } from '../../stores/codeReview'
import type { SprintTask } from '../../../../shared/types'
import { useCommandPaletteStore, type Command } from '../../stores/commandPalette'

import '../../assets/sprint-pipeline.css'

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
  const batchDeleteTasks = useSprintTasks((s) => s.batchDeleteTasks)
  const batchRequeueTasks = useSprintTasks((s) => s.batchRequeueTasks)

  const {
    selectedTaskId,
    selectedTaskIds,
    drawerOpen,
    specPanelOpen,
    doneViewOpen,
    logDrawerTaskId,
    conflictDrawerOpen,
    healthCheckDrawerOpen,
    statusFilter,
    repoFilter,
    tagFilter,
    searchQuery
  } = useSprintUI(
    useShallow((s) => ({
      selectedTaskId: s.selectedTaskId,
      selectedTaskIds: s.selectedTaskIds,
      drawerOpen: s.drawerOpen,
      specPanelOpen: s.specPanelOpen,
      doneViewOpen: s.doneViewOpen,
      logDrawerTaskId: s.logDrawerTaskId,
      conflictDrawerOpen: s.conflictDrawerOpen,
      healthCheckDrawerOpen: s.healthCheckDrawerOpen,
      statusFilter: s.statusFilter,
      repoFilter: s.repoFilter,
      tagFilter: s.tagFilter,
      searchQuery: s.searchQuery
    }))
  )
  // Setters are stable Zustand references — no shallow-eq needed, one subscription
  const {
    setSelectedTaskId,
    setDrawerOpen,
    setSpecPanelOpen,
    setDoneViewOpen,
    setLogDrawerTaskId,
    setConflictDrawerOpen,
    setHealthCheckDrawerOpen,
    setStatusFilter,
    clearMultiSelection
  } = useSprintUI(
    useShallow((s) => ({
      setSelectedTaskId: s.setSelectedTaskId,
      setDrawerOpen: s.setDrawerOpen,
      setSpecPanelOpen: s.setSpecPanelOpen,
      setDoneViewOpen: s.setDoneViewOpen,
      setLogDrawerTaskId: s.setLogDrawerTaskId,
      setConflictDrawerOpen: s.setConflictDrawerOpen,
      setHealthCheckDrawerOpen: s.setHealthCheckDrawerOpen,
      setStatusFilter: s.setStatusFilter,
      clearMultiSelection: s.clearMultiSelection
    }))
  )

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

  // SP-7: Health check polling runs in PollingProvider; just read results here
  const { visibleStuckTasks, dismissTask } = useVisibleStuckTasks()

  // --- Focus management ---
  const triggerRef = useRef<HTMLElement | null>(null)

  // Register sprint commands in command palette
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)

  useEffect(() => {
    const taskCommands: Command[] = [
      {
        id: 'task-create',
        label: 'Create New Task',
        category: 'task',
        keywords: ['create', 'new', 'task', 'workbench'],
        action: openWorkbench
      },
      {
        id: 'task-stop-active',
        label: 'Stop Active Task',
        category: 'task',
        keywords: ['stop', 'cancel', 'active'],
        action: () => {
          const currentTasks = useSprintTasks.getState().tasks
          const currentPartition = partitionSprintTasks(currentTasks)
          const activeTask = currentPartition.inProgress[0]
          if (activeTask) {
            handleStop(activeTask)
          } else {
            toast.error('No active task to stop')
          }
        }
      },
      {
        id: 'task-retry-failed',
        label: 'Retry First Failed Task',
        category: 'task',
        keywords: ['retry', 'failed', 'error'],
        action: () => {
          const currentTasks = useSprintTasks.getState().tasks
          const currentPartition = partitionSprintTasks(currentTasks)
          const failedTask = currentPartition.failed[0]
          if (failedTask) {
            handleRetry(failedTask)
          } else {
            toast.error('No failed tasks to retry')
          }
        }
      }
    ]

    const filterCommands: Command[] = [
      {
        id: 'filter-all',
        label: 'Show All Tasks',
        category: 'filter',
        keywords: ['filter', 'all', 'show'],
        action: () => setStatusFilter('all')
      },
      {
        id: 'filter-backlog',
        label: 'Filter: Backlog',
        category: 'filter',
        keywords: ['filter', 'backlog'],
        action: () => setStatusFilter('backlog')
      },
      {
        id: 'filter-todo',
        label: 'Filter: To Do',
        category: 'filter',
        keywords: ['filter', 'todo', 'queued'],
        action: () => setStatusFilter('todo')
      },
      {
        id: 'filter-blocked',
        label: 'Filter: Blocked',
        category: 'filter',
        keywords: ['filter', 'blocked'],
        action: () => setStatusFilter('blocked')
      },
      {
        id: 'filter-active',
        label: 'Filter: In Progress',
        category: 'filter',
        keywords: ['filter', 'active', 'progress'],
        action: () => setStatusFilter('in-progress')
      },
      {
        id: 'filter-review',
        label: 'Filter: Awaiting Review',
        category: 'filter',
        keywords: ['filter', 'review', 'pr'],
        action: () => setStatusFilter('awaiting-review')
      },
      {
        id: 'filter-done',
        label: 'Filter: Done',
        category: 'filter',
        keywords: ['filter', 'done', 'complete'],
        action: () => setStatusFilter('done')
      },
      {
        id: 'filter-failed',
        label: 'Filter: Failed',
        category: 'filter',
        keywords: ['filter', 'failed', 'error'],
        action: () => setStatusFilter('failed')
      }
    ]

    const commands = [...taskCommands, ...filterCommands]
    registerCommands(commands)

    return () => {
      unregisterCommands(commands.map((c) => c.id))
    }
  }, [
    openWorkbench,
    handleStop,
    handleRetry,
    setStatusFilter,
    registerCommands,
    unregisterCommands
  ])

  // --- Local UI state ---
  const [dagOpen, setDagOpen] = useState(false)

  // Filter + partition tasks
  const filteredTasks = useMemo(() => {
    let result = tasks
    // Apply UI chip filters
    if (repoFilter) result = result.filter((t) => t.repo === repoFilter)
    if (tagFilter) result = result.filter((t) => t.tags?.includes(tagFilter))
    // Apply structured query language
    if (searchQuery) {
      const predicates = parseTaskQuery(searchQuery)
      result = applyPredicates(result, predicates)
    }
    return result
  }, [tasks, repoFilter, tagFilter, searchQuery])

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
    (task: SprintTask) => {
      useCodeReviewStore.getState().selectTask(task.id)
      setView('code-review')
    },
    [setView]
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
                useTaskWorkbenchStore.getState().loadTask(selectedTask)
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
