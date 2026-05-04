import './TopBar.css'
import { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, FileText, Sparkles } from 'lucide-react'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import { ConfirmModal } from '../ui/ConfirmModal'
import { Modal } from '../ui/Modal'
import { ReviewQueue } from './ReviewQueue'
import { VARIANTS } from '../../lib/motion'
import { useReviewActions } from '../../hooks/useReviewActions'
import { useTaskAutoSelect } from '../../hooks/useTaskAutoSelect'
import { useBatchActions } from '../../hooks/useBatchActions'
import { BranchBar } from './BranchBar'
import { TaskRunMetrics } from './TaskRunMetrics'
import { ApproveDropdown } from './ApproveDropdown'
import { useReviewPartnerStore } from '../../stores/reviewPartner'
import { ReviewActionsBar } from './ReviewActionsBar'
import { BatchActionsToolbar } from './BatchActionsToolbar'
import { RollupPrModal } from './RollupPrModal'

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

  const openPromptModal = async (): Promise<void> => {
    if (!task) return
    const result = await window.api.sprint.getLastPrompt(task.id)
    setPromptText(result.prompt)
    setPromptModalOpen(true)
  }

  const selectedTasks = tasks.filter((t) => selectedBatchIds.has(t.id) && t.status === 'review')
  const isBatchMode = selectedBatchIds.size > 0

  // Call hook unconditionally (Rules of Hooks), but only use ghConfigured in batch mode
  const { ghConfigured } = useReviewActions()
  const {
    batchActionInFlight,
    confirmProps: batchConfirmProps,
    rollupModalOpen,
    handleBatchMergeAll,
    handleBatchShipAll,
    handleBatchCreatePr,
    handleBatchDiscard,
    handleOpenRollupModal,
    handleCloseRollupModal,
    handleSubmitRollupPr
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
              <BatchActionsToolbar
                selectedCount={selectedTasks.length}
                batchActionInFlight={batchActionInFlight}
                ghConfigured={ghConfigured}
                onMergeAll={() => handleBatchMergeAll(selectedTasks)}
                onShipAll={() => handleBatchShipAll(selectedTasks, ghConfigured)}
                onCreatePrs={() => handleBatchCreatePr(selectedTasks, ghConfigured)}
                onDiscard={() => handleBatchDiscard(selectedTasks)}
                onClear={clearBatch}
                onBuildRollupPr={() => handleOpenRollupModal(selectedTasks, ghConfigured)}
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
              {hasAnyReviewTask ? 'Loading…' : 'No tasks in review'}
            </motion.span>
          )}
        </AnimatePresence>
        <ConfirmModal {...batchConfirmProps} />
        <RollupPrModal
          open={rollupModalOpen}
          tasks={selectedTasks}
          onClose={handleCloseRollupModal}
          onSubmit={(branchName, prTitle) =>
            handleSubmitRollupPr(selectedTasks, branchName, prTitle)
          }
        />
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
              onBuildRollupPr={() => handleOpenRollupModal(selectedTasks, ghConfigured)}
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
                      className="cr-topbar__prompt-btn"
                      aria-label="View rendered agent prompt"
                      title="View rendered agent prompt"
                      onClick={openPromptModal}
                    >
                      <FileText size={14} />
                    </button>

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
      <RollupPrModal
        open={rollupModalOpen}
        tasks={selectedTasks}
        onClose={handleCloseRollupModal}
        onSubmit={(branchName, prTitle) =>
          handleSubmitRollupPr(selectedTasks, branchName, prTitle)
        }
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
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowY: 'auto',
              maxHeight: '60vh',
              margin: 0,
              padding: '1rem'
            }}
          >
            {promptText}
          </pre>
        ) : (
          <p style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>
            No prompt recorded for this run.
          </p>
        )}
      </Modal>
    </div>
  )
}
