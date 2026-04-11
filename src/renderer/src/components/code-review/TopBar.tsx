import './TopBar.css'
import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  GitMerge,
  GitPullRequest,
  RotateCcw,
  Trash2,
  Loader2,
  Rocket,
  RefreshCw,
  ChevronDown,
  MoreVertical,
  X
} from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { useTextareaPrompt, TextareaPromptModal } from '../ui/TextareaPromptModal'
import { toast } from '../../stores/toasts'
import { useGitHubStatus } from '../../hooks/useGitHubStatus'
import { nowIso } from '../../../../shared/time'
import { ReviewQueue } from './ReviewQueue'
import { VARIANTS } from '../../lib/motion'

function getNextReviewTaskId(
  currentTaskId: string,
  allTasks: Array<{ id: string; status: string; updated_at: string }>
): string | null {
  // Exclude the current task so callers (Ship It / Merge / Discard) don't get
  // handed back the same task they just acted on. If nothing else is in
  // review, return null and let the auto-select effect pick up whatever
  // transitions into review next.
  const reviewTasks = allTasks
    .filter((t) => t.status === 'review' && t.id !== currentTaskId)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  return reviewTasks.length > 0 ? reviewTasks[0].id : null
}

export function TopBar(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const selectedBatchIds = useCodeReviewStore((s) => s.selectedBatchIds)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const { confirm, confirmProps } = useConfirm()
  const { prompt, promptProps } = useTextareaPrompt()
  const { configured: ghConfigured } = useGitHubStatus()
  const [mergeStrategy, setMergeStrategy] = useState<'squash' | 'merge' | 'rebase'>('squash')
  const [actionInFlight, setActionInFlight] = useState<string | null>(null)
  const [freshness, setFreshness] = useState<{
    status: 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'
    commitsBehind?: number
  }>({ status: 'loading' })
  const [taskSwitcherOpen, setTaskSwitcherOpen] = useState(false)
  const [kebabOpen, setKebabOpen] = useState(false)
  const taskSwitcherRef = useRef<HTMLDivElement>(null)
  const kebabRef = useRef<HTMLDivElement>(null)

  const selectedTasks = tasks.filter((t) => selectedBatchIds.has(t.id) && t.status === 'review')

  useEffect(() => {
    if (!task || task.status !== 'review') return
    setFreshness({ status: 'loading' })
    window.api.review
      .checkFreshness({ taskId: task.id })
      .then(setFreshness)
      .catch(() => setFreshness({ status: 'unknown' }))
  }, [task?.id, task?.rebased_at])

  // Auto-select the first review task when the current selection is stale
  // (e.g. after Ship It marked it `done`) or missing. Without this, the
  // TopBar falls into its empty state any time the previously-selected task
  // leaves review status, even if another task is available — which blocks
  // the user from shipping anything more without manually reopening the
  // task switcher popover. Runs whenever `tasks` updates (poll merge + file
  // watcher `sprint:externalChange` events).
  const isValidSelection = !!task && task.status === 'review'
  useEffect(() => {
    if (isValidSelection) return
    const firstReview = tasks
      .filter((t) => t.status === 'review')
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]
    if (firstReview) selectTask(firstReview.id)
  }, [isValidSelection, tasks, selectTask])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (taskSwitcherRef.current && !taskSwitcherRef.current.contains(e.target as Node)) {
        setTaskSwitcherOpen(false)
      }
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) {
        setKebabOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleShipIt = async (): Promise<void> => {
    if (!task) return
    const ok = await confirm({
      title: 'Ship It',
      message: `Merge "${task.title.slice(0, 50)}" into main using ${mergeStrategy}, push to origin, and mark done?\n\nThis will merge + push in one step.`,
      confirmLabel: 'Ship It',
      variant: 'default'
    })
    if (!ok) return
    setActionInFlight('shipIt')
    try {
      const result = await window.api.review.shipIt({
        taskId: task.id,
        strategy: mergeStrategy
      })
      if (result.success) {
        if (result.pushed) {
          toast.success('Merged & pushed!')
        } else {
          toast.error(
            'Merged locally, but push to origin FAILED. Open Source Control to retry the push, or run `git push` manually.',
            10000
          )
        }
        const nextTaskId = getNextReviewTaskId(task.id, tasks)
        selectTask(nextTaskId)
        loadData()
      } else {
        toast.error(`Ship It failed: ${result.error || 'unknown error'}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ship It failed')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleMergeLocally = async (): Promise<void> => {
    if (!task) return
    const ok = await confirm({
      title: 'Merge Locally',
      message: `Merge "${task.title.slice(0, 50)}" into your local main branch using ${mergeStrategy} strategy?`,
      confirmLabel: 'Merge',
      variant: 'default'
    })
    if (!ok) return
    setActionInFlight('merge')
    try {
      const result = await window.api.review.mergeLocally({
        taskId: task.id,
        strategy: mergeStrategy
      })
      if (result.success) {
        toast.success('Changes merged locally')
        const nextTaskId = getNextReviewTaskId(task.id, tasks)
        selectTask(nextTaskId)
        loadData()
      } else {
        toast.error(`Merge failed: ${result.error || 'conflicts detected'}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleCreatePr = async (): Promise<void> => {
    if (!task) return
    const ok = await confirm({
      title: 'Create Pull Request',
      message: `Push agent branch to GitHub and create a public PR for "${task.title.slice(0, 50)}"?\n\nRepo: ${task.repo}\n\nThis action cannot be undone.`,
      confirmLabel: 'Create PR',
      variant: 'default'
    })
    if (!ok) return
    setActionInFlight('createPr')
    try {
      const result = await window.api.review.createPr({
        taskId: task.id,
        title: task.title,
        body: task.spec || task.prompt || ''
      })
      toast.success(`PR created: ${result.prUrl}`)
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create PR')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleRequestRevision = async (): Promise<void> => {
    if (!task) return
    setKebabOpen(false)
    const feedback = await prompt({
      title: 'Request Revision',
      message: 'What should the agent fix or improve?',
      placeholder: 'Describe the changes needed...',
      confirmLabel: 'Re-queue Task'
    })
    if (!feedback) return
    setActionInFlight('revise')
    try {
      const priorEntries = Array.isArray(task.revision_feedback) ? task.revision_feedback : []
      const attempt = priorEntries.length + 1
      const nextEntries = [
        ...priorEntries,
        {
          timestamp: nowIso(),
          feedback,
          attempt
        }
      ]
      try {
        await window.api.sprint.update(task.id, { revision_feedback: nextEntries })
      } catch (err) {
        console.warn('[review] Failed to persist revision feedback (audit trail only):', err)
      }
      await window.api.review.requestRevision({
        taskId: task.id,
        feedback,
        mode: 'fresh'
      })
      toast.success('Task re-queued with revision feedback')
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to request revision')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleRebase = async (): Promise<void> => {
    if (!task) return
    setActionInFlight('rebase')
    try {
      const result = await window.api.review.rebase({ taskId: task.id })
      if (result.success) {
        toast.success('Rebased onto main')
        setFreshness({ status: 'fresh', commitsBehind: 0 })
        loadData()
      } else {
        toast.error(`Rebase failed: ${result.error || 'conflicts detected'}`)
        setFreshness({ status: 'conflict' })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rebase failed')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleDiscard = async (): Promise<void> => {
    if (!task) return
    setKebabOpen(false)
    const ok = await confirm({
      title: 'Discard Changes',
      message: `Discard all work for "${task.title.slice(0, 50)}"? This cannot be undone.`,
      confirmLabel: 'Discard',
      variant: 'danger'
    })
    if (!ok) return
    setActionInFlight('discard')
    try {
      await window.api.review.discard({ taskId: task.id })
      toast.success('Changes discarded')
      const nextTaskId = getNextReviewTaskId(task.id, tasks)
      selectTask(nextTaskId)
      loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to discard')
    } finally {
      setActionInFlight(null)
    }
  }

  const handleBatchMergeAll = async (): Promise<void> => {
    const ok = await confirm({
      title: `Merge ${selectedTasks.length} Tasks`,
      message: `Merge all ${selectedTasks.length} selected tasks into your local branch using squash strategy?\n\n${selectedTasks.map((t) => `• ${t.title}`).join('\n')}`,
      confirmLabel: 'Merge All',
      variant: 'default'
    })
    if (!ok) return

    setActionInFlight('batchMerge')
    let succeeded = 0
    let failed = 0

    for (const batchTask of selectedTasks) {
      try {
        const result = await window.api.review.mergeLocally({
          taskId: batchTask.id,
          strategy: 'squash'
        })
        if (result.success) succeeded++
        else failed++
      } catch {
        failed++
      }
    }

    setActionInFlight(null)
    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Merged ${succeeded} tasks`)
    } else {
      toast.error(`Merged ${succeeded}, failed ${failed}`)
    }
  }

  const handleBatchShipAll = async (): Promise<void> => {
    const ok = await confirm({
      title: `Ship ${selectedTasks.length} Tasks`,
      message: `Merge all ${selectedTasks.length} selected tasks into main using squash, push to origin, and mark done?\n\n${selectedTasks.map((t) => `• ${t.title}`).join('\n')}\n\nThis will merge + push in one step.`,
      confirmLabel: 'Ship All',
      variant: 'default'
    })
    if (!ok) return

    setActionInFlight('batchShip')
    let succeeded = 0
    let failed = 0

    for (const batchTask of selectedTasks) {
      try {
        const result = await window.api.review.shipIt({
          taskId: batchTask.id,
          strategy: 'squash'
        })
        if (result.success) succeeded++
        else failed++
      } catch {
        failed++
      }
    }

    setActionInFlight(null)
    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Shipped ${succeeded} tasks`)
    } else {
      toast.error(`Shipped ${succeeded}, failed ${failed}`)
    }
  }

  const handleBatchCreatePr = async (): Promise<void> => {
    const ok = await confirm({
      title: `Create ${selectedTasks.length} PRs`,
      message: `Push branches to GitHub and create public PRs for all ${selectedTasks.length} selected tasks?\n\n${selectedTasks.map((t) => `• ${t.title}`).join('\n')}\n\nThis action cannot be undone.`,
      confirmLabel: 'Create PRs',
      variant: 'default'
    })
    if (!ok) return

    setActionInFlight('batchPr')
    let succeeded = 0
    let failed = 0

    for (const batchTask of selectedTasks) {
      try {
        await window.api.review.createPr({
          taskId: batchTask.id,
          title: batchTask.title,
          body: batchTask.spec || batchTask.prompt || ''
        })
        succeeded++
      } catch {
        failed++
      }
    }

    setActionInFlight(null)
    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Created ${succeeded} PRs`)
    } else {
      toast.error(`Created ${succeeded} PRs, failed ${failed}`)
    }
  }

  const handleBatchDiscard = async (): Promise<void> => {
    const ok = await confirm({
      title: `Discard ${selectedTasks.length} Tasks`,
      message: `Discard all work for ${selectedTasks.length} selected tasks? This cannot be undone.\n\n${selectedTasks.map((t) => `• ${t.title}`).join('\n')}`,
      confirmLabel: 'Discard All',
      variant: 'danger'
    })
    if (!ok) return

    setActionInFlight('batchDiscard')
    let succeeded = 0
    let failed = 0

    for (const batchTask of selectedTasks) {
      try {
        await window.api.review.discard({ taskId: batchTask.id })
        succeeded++
      } catch {
        failed++
      }
    }

    setActionInFlight(null)
    clearBatch()
    loadData()

    if (failed === 0) {
      toast.success(`Discarded ${succeeded} tasks`)
    } else {
      toast.error(`Discarded ${succeeded} tasks, failed ${failed}`)
    }
  }

  const isBatchMode = selectedBatchIds.size > 0
  const hasAnyReviewTask = tasks.some((t) => t.status === 'review')

  if (!task || task.status !== 'review') {
    return (
      <div className="cr-topbar">
        <AnimatePresence mode="wait">
          {isBatchMode ? (
            <motion.div
              key="batch"
              className="cr-topbar__batch"
              variants={VARIANTS.fadeIn}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.12 }}
            >
              <span className="cr-topbar__batch-count">{selectedTasks.length} tasks selected</span>
              <button
                className="cr-topbar__btn cr-topbar__btn--primary"
                onClick={handleBatchMergeAll}
                disabled={!!actionInFlight}
              >
                {actionInFlight === 'batchMerge' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <GitMerge size={14} />
                )}{' '}
                Merge All
              </button>
              <button
                className="cr-topbar__btn cr-topbar__btn--ship"
                onClick={handleBatchShipAll}
                disabled={!!actionInFlight || !ghConfigured}
              >
                {actionInFlight === 'batchShip' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Rocket size={14} />
                )}{' '}
                Ship All
              </button>
              <button
                className="cr-topbar__btn cr-topbar__btn--secondary"
                onClick={handleBatchCreatePr}
                disabled={!!actionInFlight || !ghConfigured}
              >
                {actionInFlight === 'batchPr' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <GitPullRequest size={14} />
                )}{' '}
                Create PRs
              </button>
              <button
                className="cr-topbar__btn cr-topbar__btn--ghost"
                onClick={handleBatchDiscard}
                disabled={!!actionInFlight}
              >
                {actionInFlight === 'batchDiscard' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Trash2 size={14} />
                )}{' '}
                Discard All
              </button>
              <button
                className="cr-topbar__btn cr-topbar__btn--ghost"
                onClick={clearBatch}
                disabled={!!actionInFlight}
              >
                <X size={14} /> Clear
              </button>
            </motion.div>
          ) : (
            <motion.span
              key="hint"
              className="cr-topbar__hint"
              variants={VARIANTS.fadeIn}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.12 }}
            >
              {hasAnyReviewTask ? 'Loading…' : 'No tasks in review'}
            </motion.span>
          )}
        </AnimatePresence>
        <ConfirmModal {...confirmProps} />
        <TextareaPromptModal {...promptProps} />
      </div>
    )
  }

  return (
    <div className="cr-topbar">
      <AnimatePresence mode="wait">
        {isBatchMode ? (
          <motion.div
            key="batch"
            className="cr-topbar__batch"
            variants={VARIANTS.fadeIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.12 }}
          >
            <span className="cr-topbar__batch-count">{selectedTasks.length} tasks selected</span>
            <button
              className="cr-topbar__btn cr-topbar__btn--primary"
              onClick={handleBatchMergeAll}
              disabled={!!actionInFlight}
            >
              {actionInFlight === 'batchMerge' ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <GitMerge size={14} />
              )}{' '}
              Merge All
            </button>
            <button
              className="cr-topbar__btn cr-topbar__btn--ship"
              onClick={handleBatchShipAll}
              disabled={!!actionInFlight || !ghConfigured}
            >
              {actionInFlight === 'batchShip' ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Rocket size={14} />
              )}{' '}
              Ship All
            </button>
            <button
              className="cr-topbar__btn cr-topbar__btn--secondary"
              onClick={handleBatchCreatePr}
              disabled={!!actionInFlight || !ghConfigured}
            >
              {actionInFlight === 'batchPr' ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <GitPullRequest size={14} />
              )}{' '}
              Create PRs
            </button>
            <button
              className="cr-topbar__btn cr-topbar__btn--ghost"
              onClick={handleBatchDiscard}
              disabled={!!actionInFlight}
            >
              {actionInFlight === 'batchDiscard' ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Trash2 size={14} />
              )}{' '}
              Discard All
            </button>
            <button
              className="cr-topbar__btn cr-topbar__btn--ghost"
              onClick={clearBatch}
              disabled={!!actionInFlight}
            >
              <X size={14} /> Clear
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="normal"
            className="cr-topbar__content"
            variants={VARIANTS.fadeIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.12 }}
          >
            <div className="cr-topbar__left">
              <div className="cr-topbar__task-switcher" ref={taskSwitcherRef}>
                <button
                  className="cr-topbar__task-btn"
                  onClick={() => setTaskSwitcherOpen(!taskSwitcherOpen)}
                >
                  <span className="cr-topbar__task-title">{task.title}</span>
                  <ChevronDown size={14} />
                </button>
                {taskSwitcherOpen && (
                  <div className="cr-topbar__popover" role="dialog" aria-modal="true">
                    <ReviewQueue />
                  </div>
                )}
              </div>
            </div>

            <div className="cr-topbar__center">
              <span
                className={`cr-topbar__freshness cr-topbar__freshness--${freshness.status}`}
                title={
                  freshness.status === 'stale'
                    ? `${freshness.commitsBehind} commit(s) behind main`
                    : freshness.status === 'conflict'
                      ? 'Last rebase had conflicts'
                      : freshness.status === 'fresh'
                        ? 'Up to date with main'
                        : 'Checking...'
                }
              >
                {freshness.status === 'fresh' && 'Fresh'}
                {freshness.status === 'stale' && `Stale (${freshness.commitsBehind} behind)`}
                {freshness.status === 'conflict' && 'Conflict'}
                {freshness.status === 'unknown' && 'Unknown'}
                {freshness.status === 'loading' && '...'}
              </span>
              <button
                className="cr-topbar__btn cr-topbar__btn--ghost"
                onClick={handleRebase}
                disabled={!!actionInFlight || freshness.status === 'fresh'}
                title="Rebase agent branch onto current main"
              >
                {actionInFlight === 'rebase' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}{' '}
                Rebase
              </button>
            </div>

            <div className="cr-topbar__right">
              <button
                className="cr-topbar__btn cr-topbar__btn--ship"
                onClick={handleShipIt}
                disabled={!!actionInFlight || !ghConfigured}
                title={!ghConfigured ? 'Configure GitHub in Settings → Connections' : undefined}
              >
                {actionInFlight === 'shipIt' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Rocket size={14} />
                )}{' '}
                Ship It
              </button>
              <div className="cr-topbar__merge-group">
                <button
                  className="cr-topbar__btn cr-topbar__btn--primary"
                  onClick={handleMergeLocally}
                  disabled={!!actionInFlight}
                >
                  {actionInFlight === 'merge' ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <GitMerge size={14} />
                  )}{' '}
                  Merge Locally
                </button>
                <select
                  className="cr-topbar__strategy"
                  value={mergeStrategy}
                  onChange={(e) =>
                    setMergeStrategy(e.target.value as 'squash' | 'merge' | 'rebase')
                  }
                  disabled={!!actionInFlight}
                >
                  <option value="squash">Squash</option>
                  <option value="merge">Merge</option>
                  <option value="rebase">Rebase</option>
                </select>
              </div>
              <button
                className="cr-topbar__btn cr-topbar__btn--secondary"
                onClick={handleCreatePr}
                disabled={!!actionInFlight || !ghConfigured}
                title={!ghConfigured ? 'Configure GitHub in Settings → Connections' : undefined}
              >
                {actionInFlight === 'createPr' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <GitPullRequest size={14} />
                )}{' '}
                Create PR
              </button>
              <div className="cr-topbar__kebab" ref={kebabRef}>
                <button
                  className="cr-topbar__btn cr-topbar__btn--ghost"
                  onClick={() => setKebabOpen(!kebabOpen)}
                  aria-label="More actions"
                >
                  <MoreVertical size={14} />
                </button>
                {kebabOpen && (
                  <div className="cr-topbar__kebab-menu" role="menu">
                    <button
                      className="cr-topbar__kebab-item"
                      onClick={handleRequestRevision}
                      disabled={!!actionInFlight}
                      role="menuitem"
                    >
                      <RotateCcw size={14} />
                      Revise
                    </button>
                    <button
                      className="cr-topbar__kebab-item cr-topbar__kebab-item--danger"
                      onClick={handleDiscard}
                      disabled={!!actionInFlight}
                      role="menuitem"
                    >
                      <Trash2 size={14} />
                      Discard
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal {...confirmProps} />
      <TextareaPromptModal {...promptProps} />
    </div>
  )
}
