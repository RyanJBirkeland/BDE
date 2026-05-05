import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { motion, LayoutGroup } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { useSprintFilters } from '../../stores/sprintFilters'
import { useSprintTasks } from '../../stores/sprintTasks'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useSprintUI, selectOrphanRecoveryBanner } from '../../stores/sprintUI'
import { useTaskWorkbenchModalStore } from '../../stores/taskWorkbenchModal'
import { setOpenLogDrawerTaskId, useTaskToasts } from '../../hooks/useTaskNotifications'
import { useSprintKeyboardShortcuts } from '../../hooks/useSprintKeyboardShortcuts'
import { useSprintTaskActions } from '../../hooks/useSprintTaskActions'
import { useVisibleStuckTasks } from '../../hooks/useVisibleStuckTasks'
import { useSprintPipelineState } from '../../hooks/useSprintPipelineState'
import { useDrainStatus } from '../../hooks/useDrainStatus'
import { useNow } from '../../hooks/useNow'
import { useRepoOptions } from '../../hooks/useRepoOptions'
import { toast } from '../../stores/toasts'
import { PipelineBacklogV2 } from './PipelineBacklogV2'
import { PipelineStageV2 } from './PipelineStageV2'
import { TaskDetailDrawerV2 } from './TaskDetailDrawerV2'
import { PipelineErrorBoundary } from './PipelineErrorBoundary'
import { PipelineFilterBarV2 } from './PipelineFilterBarV2'
import { PipelineFilterBanner } from './PipelineFilterBanner'
import { PipelineHeaderV2 } from './PipelineHeaderV2'
import { PipelineOverlays } from './PipelineOverlays'
import { DagOverlay } from './DagOverlay'
import { BulkActionBar } from './BulkActionBar'
import { PollErrorBanner } from './banners/PollErrorBanner'
import { DrainPausedBanner } from './banners/DrainPausedBanner'
import { OrphanRecoveryBanner } from './banners/OrphanRecoveryBanner'
import type { SprintTask } from '../../../../shared/types'
import { WIP_LIMIT_IN_PROGRESS } from '../../lib/constants'
import { useSprintPipelineCommands } from '../../hooks/useSprintPipelineCommands'

import './SprintPipeline.css'

export function SprintPipelineV2(): React.JSX.Element {
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
    conflictingTasks,
  } = useSprintPipelineState()

  const pollError = useSprintTasks((s) => s.pollError)
  const clearPollError = useSprintTasks((s) => s.clearPollError)

  const orphanBanner = useSprintUI(selectOrphanRecoveryBanner)
  const dismissOrphanBanner = useSprintUI((s) => s.setOrphanRecoveryBanner)

  const drainStatus = useDrainStatus()
  const now = useNow()
  const repos = useRepoOptions()

  const setStatusFilter = useSprintFilters((s) => s.setStatusFilter)
  const setView = usePanelLayoutStore((s) => s.setView)
  const reduced = useReducedMotion()
  const openWorkbenchForCreate = useTaskWorkbenchModalStore((s) => s.openForCreate)
  const openWorkbench = useCallback(() => openWorkbenchForCreate(), [openWorkbenchForCreate])

  const {
    handleSaveSpec,
    handleStop,
    handleRerun,
    handleRetry,
    launchTask,
    deleteTask,
    batchDeleteTasks,
    confirmProps,
  } = useSprintTaskActions()

  const { visibleStuckTasks, dismissTask } = useVisibleStuckTasks()

  const triggerRef = useRef<HTMLElement | null>(null)

  useSprintPipelineCommands({ openWorkbench, handleStop, handleRetry, setStatusFilter })

  const [dagOpen, setDagOpen] = useState(false)

  useEffect(() => {
    const cleanup = initTaskOutputListener()
    return cleanup
  }, [initTaskOutputListener])

  useEffect(() => {
    setOpenLogDrawerTaskId(logDrawerTaskId)
    return () => setOpenLogDrawerTaskId(null)
  }, [logDrawerTaskId])

  const handleViewOutput = useCallback(
    (task: SprintTask) => { setLogDrawerTaskId(task.id) },
    [setLogDrawerTaskId]
  )
  useTaskToasts(tasks, logDrawerTaskId, handleViewOutput)

  useSprintKeyboardShortcuts({
    openWorkbench,
    setConflictDrawerOpen: (value) => {
      setConflictDrawerOpen(typeof value === 'function' ? value(conflictDrawerOpen) : value)
    },
  })

  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      const active = partition.inProgress[0] || partition.todo[0]
      if (active) setSelectedTaskId(active.id)
    }
  }, [tasks, selectedTaskId, partition, setSelectedTaskId])

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
      } catch {
        // Error already shown by updateTask; store reverts optimistic update
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
    (task: SprintTask) => { void deleteTask(task.id) },
    [deleteTask]
  )

  const handleUnblock = useCallback(async (task: SprintTask) => {
    try {
      await window.api.sprint.unblockTask(task.id)
      toast.success('Task unblocked - dependencies will be re-checked')
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
    void batchDeleteTasks(filteredPartition.failed.map((t) => t.id))
  }, [filteredPartition.failed, batchDeleteTasks])

  const handleRequeueAllFailed = useCallback(() => {
    void batchRequeueTasks(filteredPartition.failed.map((t) => t.id))
  }, [filteredPartition.failed, batchRequeueTasks])

  const handleExport = useCallback(async (task: SprintTask) => {
    try {
      const result = await window.api.sprint.exportTaskHistory(task.id)
      if (result.success) toast.success(`Task history exported to ${result.path}`)
    } catch (err) {
      toast.error(`Failed to export: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const headerStats = useMemo(
    () => [
      { label: 'active', count: partition.inProgress.length, filter: 'in-progress' as const },
      { label: 'queued', count: partition.todo.length, filter: 'todo' as const },
      { label: 'blocked', count: partition.blocked.length, filter: 'blocked' as const },
      { label: 'review', count: partition.pendingReview.length, filter: 'review' as const },
      { label: 'PRs', count: partition.openPrs.length, filter: 'open-prs' as const },
      { label: 'failed', count: partition.failed.length, filter: 'failed' as const },
      { label: 'done', count: partition.done.length, filter: 'done' as const },
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
      <PipelineHeaderV2
        stats={headerStats}
        conflictingTasks={conflictingTasks}
        visibleStuckTasks={visibleStuckTasks}
        onFilterClick={setStatusFilter}
        onConflictClick={() => setConflictDrawerOpen(true)}
        onHealthCheckClick={() => setHealthCheckDrawerOpen(true)}
        onDagToggle={() => setDagOpen(!dagOpen)}
        dagOpen={dagOpen}
        onOpenWorkbench={openWorkbench}
      />

      <BulkActionBar
        selectedCount={selectedTaskIds.size}
        selectedTaskIds={selectedTaskIds}
        onClearSelection={clearMultiSelection}
      />

      <PipelineFilterBarV2 tasks={tasks} />

      <PipelineFilterBanner filteredTasks={filteredTasks} totalTasks={tasks} />

      {pollError && (
        <PollErrorBanner
          message={pollError}
          loading={loading && tasks.length === 0}
          onRetry={() => { clearPollError(); void loadData() }}
          onDismiss={clearPollError}
        />
      )}

      {orphanBanner && (
        <OrphanRecoveryBanner
          recoveredCount={orphanBanner.recovered.length}
          exhaustedCount={orphanBanner.exhausted.length}
          onDismiss={() => dismissOrphanBanner(null)}
        />
      )}

      {drainStatus && (
        <DrainPausedBanner
          reason={drainStatus.reason}
          affectedTaskCount={drainStatus.affectedTaskCount}
          pausedUntil={drainStatus.pausedUntil}
          now={now}
        />
      )}

      {loading && tasks.length === 0 && (
        <div role="status" aria-label="Loading pipeline" className="sprint-pipeline__body">
          <div className="pipeline-sidebar pipeline-sidebar--loading">
            <div aria-hidden="true" className="fleet-skeleton pipeline-skeleton--sidebar" />
          </div>
          <div className="pipeline-center pipeline-center--loading">
            <div aria-hidden="true" className="fleet-skeleton pipeline-skeleton--stage" />
            <div aria-hidden="true" className="fleet-skeleton pipeline-skeleton--stage" />
            <div aria-hidden="true" className="fleet-skeleton pipeline-skeleton--stage" />
          </div>
        </div>
      )}

      {loadError && (
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: 'var(--s-8)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s-3)' }}>
            <span className="fleet-eyebrow">ERROR</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)' }}>Error loading tasks</span>
            <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>{loadError}</p>
            <button
              onClick={() => void loadData()}
              disabled={loading}
              style={{ padding: '0 var(--s-3)', height: 28, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
            >
              {loading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        </div>
      )}

      {!loading && !loadError && tasks.length === 0 && (
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {repos.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s-3)', padding: 'var(--s-8)' }}>
              <span className="fleet-eyebrow">NO REPOSITORY</span>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg)' }}>No repository configured</span>
              <p style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', margin: 0 }}>
                Add a repository in Settings before creating tasks.
              </p>
              <button
                onClick={() => setView('settings')}
                style={{ padding: '0 var(--s-3)', height: 28, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >
                Configure Repository
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s-3)', padding: 'var(--s-8)' }}>
              <span className="fleet-eyebrow">PIPELINE</span>
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg)' }}>No tasks yet</span>
              <p style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', margin: 0 }}>
                Create your first task to start the pipeline.
              </p>
              <button
                onClick={openWorkbench}
                style={{ padding: '0 var(--s-3)', height: 28, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >
                New Task
              </button>
            </div>
          )}
        </div>
      )}

      <PipelineErrorBoundary fallbackLabel="Pipeline crashed">
        <div className={`sprint-pipeline__body ${tasks.length === 0 ? 'sprint-pipeline__body--hidden' : ''}`}>
          <PipelineBacklogV2
            backlog={filteredPartition.backlog}
            failed={filteredPartition.failed}
            onTaskClick={handleTaskClick}
            onAddToQueue={handleAddToQueue}
            onRerun={handleRerun}
            onClearFailures={handleClearFailures}
            onRequeueAllFailed={handleRequeueAllFailed}
          />

          <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(220px, 1fr))', gap: 'var(--s-3)', padding: 'var(--s-4)', flex: 1, minHeight: 0, alignItems: 'stretch' }}>
              <LayoutGroup>
                <PipelineStageV2
                  name="queued"
                  label="Queued"
                  tasks={filteredPartition.todo}
                  count={`${filteredPartition.todo.length}`}
                  selectedTaskId={selectedTaskId}
                  selectedTaskIds={selectedTaskIds}
                  onTaskClick={handleTaskClick}
                />
                <PipelineStageV2
                  name="blocked"
                  label="Blocked"
                  tasks={filteredPartition.blocked}
                  count={`${filteredPartition.blocked.length}`}
                  selectedTaskId={selectedTaskId}
                  selectedTaskIds={selectedTaskIds}
                  onTaskClick={handleTaskClick}
                />
                <PipelineStageV2
                  name="active"
                  label="Active"
                  tasks={filteredPartition.inProgress}
                  count={`${filteredPartition.inProgress.length}/${WIP_LIMIT_IN_PROGRESS}`}
                  selectedTaskId={selectedTaskId}
                  selectedTaskIds={selectedTaskIds}
                  onTaskClick={handleTaskClick}
                />
                <PipelineStageV2
                  name="review"
                  label="Review"
                  tasks={filteredPartition.pendingReview}
                  count={`${filteredPartition.pendingReview.length}`}
                  selectedTaskId={selectedTaskId}
                  selectedTaskIds={selectedTaskIds}
                  onTaskClick={handleTaskClick}
                />
                <PipelineStageV2
                  name="open-prs"
                  label="PRs"
                  tasks={filteredPartition.openPrs}
                  count={`${filteredPartition.openPrs.length}`}
                  selectedTaskId={selectedTaskId}
                  selectedTaskIds={selectedTaskIds}
                  onTaskClick={handleTaskClick}
                />
                <PipelineStageV2
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
          </div>

          {drawerOpen && selectedTask && (
            <TaskDetailDrawerV2
              task={selectedTask}
              onClose={handleCloseDrawer}
              onLaunch={launchTask}
              onStop={handleStop}
              onRerun={handleRerun}
              onDelete={handleDeleteTask}
              onViewLogs={() => setView('agents')}
              onOpenSpec={() => setSpecPanelOpen(true)}
              onEdit={() => useTaskWorkbenchModalStore.getState().openForEdit(selectedTask)}
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
