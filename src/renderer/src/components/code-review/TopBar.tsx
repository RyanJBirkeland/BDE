import './TopBar.css'
import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, FileText, GitPullRequest, Loader2, Sparkles } from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { ConfirmModal } from '../ui/ConfirmModal'
import { Modal } from '../ui/Modal'
import { ReviewQueue } from './ReviewQueue'
import { VARIANTS } from '../../lib/motion'
import { useReviewActions } from '../../hooks/useReviewActions'
import { useApproveAction } from '../../hooks/useApproveAction'
import { useTaskAutoSelect } from '../../hooks/useTaskAutoSelect'
import { useBatchActions } from '../../hooks/useBatchActions'
import { BranchBar } from './BranchBar'
import { TaskRunMetrics } from './TaskRunMetrics'
import { ApproveDropdown } from './ApproveDropdown'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { ReviewActionsBar } from './ReviewActionsBar'
import { BatchActionsToolbar } from './BatchActionsToolbar'
import { PrBuilderModal } from './PrBuilderModal'

export function TopBar(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectedBatchIds = useCodeReviewStore((s) => s.selectedBatchIds)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)
  const pruneBatch = useCodeReviewStore((s) => s.pruneBatch)
  const tasks = useSprintTasks((s) => s.tasks)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const panelOpen = useReviewPartnerStore((s) => s.panelOpen)
  const togglePanel = useReviewPartnerStore((s) => s.togglePanel)
  const reviewResult = useReviewPartnerStore((s) =>
    selectedTaskId ? s.reviewByTask[selectedTaskId]?.result : undefined
  )
  const branch = reviewResult?.findings.branch

  const [taskSwitcherOpen, setTaskSwitcherOpen] = useState(false)
  const taskSwitcherRef = useRef<HTMLDivElement>(null)
  const [promptModalOpen, setPromptModalOpen] = useState(false)
  const [promptText, setPromptText] = useState<string | null>(null)
  const [showPrBuilder, setShowPrBuilder] = useState(false)

  const openPromptModal = async (): Promise<void> => {
    if (!task) return
    const result = await window.api.sprint.getLastPrompt(task.id)
    setPromptText(result.prompt)
    setPromptModalOpen(true)
  }

  const loadData = useSprintTasks((s) => s.loadData)

  const selectedTasks = tasks.filter((t) => selectedBatchIds.has(t.id) && t.status === 'review')
  const isBatchMode = selectedBatchIds.size > 0

  // Call hooks unconditionally (Rules of Hooks).
  const { ghConfigured } = useReviewActions()
  // useApproveAction requires a taskId — use empty string as a safe sentinel when no task
  // is selected; approve() will never be called in that state because the button is hidden.
  const { approve, inFlight: approveInFlight } = useApproveAction(
    selectedTaskId ?? '',
    loadData
  )
  const {
    batchActionInFlight,
    confirmProps: batchConfirmProps,
    handleBatchMergeAll,
    handleBatchShipAll,
    handleBatchCreatePr,
    handleBatchDiscard
  } = useBatchActions()

  // Auto-select review tasks when current selection becomes invalid
  useTaskAutoSelect()

  // Prune batch selection of IDs that have since left review status
  // (shipped, discarded, auto-merged) so batch toolbar counts stay accurate.
  useEffect(() => {
    pruneBatch(tasks.filter((t) => t.status === 'review').map((t) => t.id))
  }, [tasks, pruneBatch])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (taskSwitcherRef.current && !taskSwitcherRef.current.contains(e.target as Node)) {
        setTaskSwitcherOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const hasAnyReviewOrApprovedTask = tasks.some(
    (t) => t.status === 'review' || t.status === 'approved'
  )
  const isTaskInQueue = !!task && (task.status === 'review' || task.status === 'approved')

  if (!isTaskInQueue) {
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
              <BatchActionsToolbar
                selectedCount={selectedTasks.length}
                batchActionInFlight={batchActionInFlight}
                ghConfigured={ghConfigured}
                onMergeAll={() => handleBatchMergeAll(selectedTasks)}
                onShipAll={() => handleBatchShipAll(selectedTasks, ghConfigured)}
                onCreatePrs={() => handleBatchCreatePr(selectedTasks, ghConfigured)}
                onDiscard={() => handleBatchDiscard(selectedTasks)}
                onClear={clearBatch}
              />
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
              {hasAnyReviewOrApprovedTask ? 'Loading…' : 'No tasks in review'}
            </motion.span>
          )}
        </AnimatePresence>
        <ConfirmModal {...batchConfirmProps} />
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
            <BatchActionsToolbar
              selectedCount={selectedTasks.length}
              batchActionInFlight={batchActionInFlight}
              ghConfigured={ghConfigured}
              onMergeAll={() => handleBatchMergeAll(selectedTasks)}
              onShipAll={() => handleBatchShipAll(selectedTasks, ghConfigured)}
              onCreatePrs={() => handleBatchCreatePr(selectedTasks, ghConfigured)}
              onDiscard={() => handleBatchDiscard(selectedTasks)}
              onClear={clearBatch}
            />
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
                  className={`cr-topbar__task-btn${taskSwitcherOpen ? ' cr-topbar__task-btn--open' : ''}`}
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
              <TaskRunMetrics task={task} />
            </div>

            <ReviewActionsBar variant="compact">
              {(actions) => (
                <>
                  <div className="cr-topbar__center">
                    {actions.renderFreshnessBadge()}
                    {actions.renderRebaseButton()}
                  </div>

                  <div className="cr-topbar__right">
                    {/* View rendered agent prompt */}
                    <button
                      type="button"
                      className="cr-topbar__icon-btn"
                      aria-label="View rendered agent prompt"
                      title="View rendered agent prompt"
                      onClick={openPromptModal}
                    >
                      <FileText size={14} />
                    </button>

                    {/* AI Partner toggle — no pulse, just a labeled segmented button */}
                    <button
                      type="button"
                      className={`cr-topbar__ai-toggle${panelOpen ? ' cr-topbar__ai-toggle--on' : ''}`}
                      aria-pressed={panelOpen}
                      aria-label="Toggle AI Review Partner"
                      onClick={togglePanel}
                    >
                      <Sparkles size={12} />
                      <span>AI Partner</span>
                    </button>

                    {/* Approve — primary CTA only when task.status === 'review' */}
                    {task.status === 'review' && (
                      <button
                        type="button"
                        className="cr-topbar__cta-btn"
                        onClick={approve}
                        disabled={approveInFlight || !!actions.actionInFlight}
                        aria-busy={approveInFlight}
                        aria-label={approveInFlight ? 'Approving task…' : 'Approve task — mark as reviewed'}
                      >
                        {approveInFlight ? <Loader2 size={12} className="spin" /> : null}
                        {approveInFlight ? 'Approving…' : 'Approve'}
                      </button>
                    )}

                    {/* Build PR — primary CTA only when task.status === 'approved' */}
                    {task.status === 'approved' && (
                      <button
                        type="button"
                        className="cr-topbar__cta-btn"
                        onClick={() => setShowPrBuilder(true)}
                        disabled={!!actions.actionInFlight}
                        aria-label="Build PR from approved tasks"
                      >
                        <GitPullRequest size={12} />
                        Build PR
                      </button>
                    )}

                    {/* Approve dropdown (consolidated merge/discard actions) */}
                    <ApproveDropdown
                      onMergeLocally={actions.mergeLocally}
                      onSquashMerge={actions.shipIt}
                      onCreatePR={actions.createPr}
                      onRequestRevision={actions.requestRevision}
                      onDiscard={actions.discard}
                      loading={!!actions.actionInFlight}
                    />
                  </div>
                </>
              )}
            </ReviewActionsBar>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmModal {...batchConfirmProps} />
      <PrBuilderModal
        open={showPrBuilder}
        repo={task?.repo ?? ''}
        onClose={() => setShowPrBuilder(false)}
      />
      <Modal
        open={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        title="Rendered Agent Prompt"
        size="lg"
      >
        {promptText != null ? (
          <pre
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-xs)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowY: 'auto',
              maxHeight: '60vh',
              margin: 0,
              padding: 'var(--s-4)',
              color: 'var(--fg-2)'
            }}
          >
            {promptText}
          </pre>
        ) : (
          <p style={{ padding: 'var(--s-4)', color: 'var(--fg-3)', fontSize: 'var(--t-sm)' }}>
            No prompt recorded for this run.
          </p>
        )}
      </Modal>
    </div>
  )
}
