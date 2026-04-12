import './TopBar.css'
import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  GitMerge,
  GitPullRequest,
  Trash2,
  Loader2,
  Rocket,
  RefreshCw,
  ChevronDown,
  Sparkles,
  X
} from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { TextareaPromptModal } from '../ui/TextareaPromptModal'
import { toast } from '../../stores/toasts'
import { ReviewQueue } from './ReviewQueue'
import { VARIANTS } from '../../lib/motion'
import { useReviewActions } from '../../hooks/useReviewActions'
import { useTaskAutoSelect } from '../../hooks/useTaskAutoSelect'
import { BranchBar } from './BranchBar'
import { ApproveDropdown } from './ApproveDropdown'
import { useReviewPartnerStore } from '../../stores/reviewPartner'

export function TopBar(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectedBatchIds = useCodeReviewStore((s) => s.selectedBatchIds)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadData = useSprintTasks((s) => s.loadData)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const { confirm, confirmProps: batchConfirmProps } = useConfirm()
  const {
    actionInFlight,
    freshness,
    ghConfigured,
    shipIt,
    mergeLocally,
    createPr,
    requestRevision,
    rebase,
    discard,
    confirmProps,
    promptProps
  } = useReviewActions()
  const panelOpen = useReviewPartnerStore((s) => s.panelOpen)
  const togglePanel = useReviewPartnerStore((s) => s.togglePanel)
  const reviewResult = useReviewPartnerStore((s) =>
    selectedTaskId ? s.reviewByTask[selectedTaskId]?.result : undefined
  )
  const branch = reviewResult?.findings.branch

  const [taskSwitcherOpen, setTaskSwitcherOpen] = useState(false)
  const [batchActionInFlight, setBatchActionInFlight] = useState<string | null>(null)
  const taskSwitcherRef = useRef<HTMLDivElement>(null)

  const selectedTasks = tasks.filter((t) => selectedBatchIds.has(t.id) && t.status === 'review')

  // Auto-select review tasks when current selection becomes invalid
  useTaskAutoSelect()

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (taskSwitcherRef.current && !taskSwitcherRef.current.contains(e.target as Node)) {
        setTaskSwitcherOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleRequestRevision = async (): Promise<void> => {
    await requestRevision()
  }

  const handleDiscard = async (): Promise<void> => {
    await discard()
  }

  const handleBatchMergeAll = async (): Promise<void> => {
    const ok = await confirm({
      title: `Merge ${selectedTasks.length} Tasks`,
      message: `Merge all ${selectedTasks.length} selected tasks into your local branch using squash strategy?\n\n${selectedTasks.map((t) => `• ${t.title}`).join('\n')}`,
      confirmLabel: 'Merge All',
      variant: 'default'
    })
    if (!ok) return

    setBatchActionInFlight('batchMerge')
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

    setBatchActionInFlight(null)
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

    setBatchActionInFlight('batchShip')
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

    setBatchActionInFlight(null)
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

    setBatchActionInFlight('batchPr')
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

    setBatchActionInFlight(null)
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

    setBatchActionInFlight('batchDiscard')
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

    setBatchActionInFlight(null)
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
                disabled={!!batchActionInFlight}
              >
                {batchActionInFlight === 'batchMerge' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <GitMerge size={14} />
                )}{' '}
                Merge All
              </button>
              <button
                className="cr-topbar__btn cr-topbar__btn--ship"
                onClick={handleBatchShipAll}
                disabled={!!batchActionInFlight || !ghConfigured}
              >
                {batchActionInFlight === 'batchShip' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Rocket size={14} />
                )}{' '}
                Ship All
              </button>
              <button
                className="cr-topbar__btn cr-topbar__btn--secondary"
                onClick={handleBatchCreatePr}
                disabled={!!batchActionInFlight || !ghConfigured}
              >
                {batchActionInFlight === 'batchPr' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <GitPullRequest size={14} />
                )}{' '}
                Create PRs
              </button>
              <button
                className="cr-topbar__btn cr-topbar__btn--ghost"
                onClick={handleBatchDiscard}
                disabled={!!batchActionInFlight}
              >
                {batchActionInFlight === 'batchDiscard' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Trash2 size={14} />
                )}{' '}
                Discard All
              </button>
              <button
                className="cr-topbar__btn cr-topbar__btn--ghost"
                onClick={clearBatch}
                disabled={!!batchActionInFlight}
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
        <ConfirmModal {...batchConfirmProps} />
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
              {branch && <BranchBar branch={branch} targetBranch="main" />}
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
                onClick={rebase}
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
              {/* AI Partner toggle */}
              <button
                type="button"
                className={`cr-topbar__ai-toggle${panelOpen ? ' cr-topbar__ai-toggle--on' : ''}`}
                aria-pressed={panelOpen}
                aria-label="Toggle AI Review Partner"
                onClick={togglePanel}
              >
                <Sparkles size={14} />
                <span>AI Partner</span>
              </button>

              {/* Approve dropdown (consolidated actions) */}
              <ApproveDropdown
                onMergeLocally={mergeLocally}
                onSquashMerge={shipIt}
                onCreatePR={createPr}
                onRequestRevision={handleRequestRevision}
                onDiscard={handleDiscard}
                disabled={!!actionInFlight}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmModal {...confirmProps} />
      <TextareaPromptModal {...promptProps} />
    </div>
  )
}
