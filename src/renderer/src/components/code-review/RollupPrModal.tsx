import { useState, useEffect } from 'react'
import { AlertCircle, GitFork, Loader2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import type { SprintTask } from '../../../../shared/types'

const SAFE_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,198}$/

interface RollupPrModalProps {
  open: boolean
  tasks: SprintTask[]
  onClose: () => void
  onSubmit: (branchName: string, prTitle: string) => Promise<void>
}

function defaultBranchName(): string {
  const date = new Date().toISOString().slice(0, 10)
  return `feat/rollup-${date}`
}

function defaultPrTitle(tasks: SprintTask[]): string {
  if (tasks.length === 0) return 'Rollup PR'
  if (tasks.length === 1) return tasks[0]!.title
  return `Rollup: ${tasks[0]!.title} +${tasks.length - 1} more`
}

export function RollupPrModal({
  open,
  tasks,
  onClose,
  onSubmit
}: RollupPrModalProps): React.JSX.Element | null {
  const [branchName, setBranchName] = useState(defaultBranchName)
  const [prTitle, setPrTitle] = useState(() => defaultPrTitle(tasks))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; conflictingFiles?: string[] } | null>(null)

  useEffect(() => {
    if (open) {
      setBranchName(defaultBranchName())
      setPrTitle(defaultPrTitle(tasks))
      setError(null)
    }
  }, [open, tasks])

  const branchValid = SAFE_REF_PATTERN.test(branchName)

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!branchValid || !prTitle.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(branchName.trim(), prTitle.trim())
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} size="md" title="Build Rollup PR">
      <form onSubmit={handleSubmit} className="rollup-modal">
        <p className="rollup-modal__description">
          Squash-merges {tasks.length} selected {tasks.length === 1 ? 'task' : 'tasks'} into a single
          branch and opens one PR for your team to review.
        </p>

        <div className="rollup-modal__field">
          <label className="rollup-modal__label" htmlFor="rollup-branch">
            Branch name
          </label>
          <input
            id="rollup-branch"
            className={`rollup-modal__input${!branchValid && branchName ? ' rollup-modal__input--error' : ''}`}
            type="text"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            disabled={submitting}
            autoFocus
            spellCheck={false}
          />
          {!branchValid && branchName && (
            <span className="rollup-modal__field-error">
              Branch name can only contain letters, numbers, /, _, . and -
            </span>
          )}
        </div>

        <div className="rollup-modal__field">
          <label className="rollup-modal__label" htmlFor="rollup-title">
            PR title
          </label>
          <input
            id="rollup-title"
            className="rollup-modal__input"
            type="text"
            value={prTitle}
            onChange={(e) => setPrTitle(e.target.value)}
            disabled={submitting}
            spellCheck={false}
          />
        </div>

        <div className="rollup-modal__field">
          <span className="rollup-modal__label">Task order (dependency-sorted)</span>
          <ol className="rollup-modal__task-list">
            {tasks.map((task, i) => (
              <li key={task.id} className="rollup-modal__task-item">
                <span className="rollup-modal__task-index">{i + 1}</span>
                <span className="rollup-modal__task-title">{task.title}</span>
                <span className="rollup-modal__task-id">{task.id.slice(0, 8)}</span>
              </li>
            ))}
          </ol>
          <p className="rollup-modal__note">
            Tasks with conflicts will halt the rollup — resolve them with Revision Request first.
          </p>
        </div>

        {error && (
          <div className="rollup-modal__error" role="alert">
            <AlertCircle size={14} />
            <div>
              <p className="rollup-modal__error-message">{error.message}</p>
              {error.conflictingFiles && error.conflictingFiles.length > 0 && (
                <ul className="rollup-modal__conflict-files">
                  {error.conflictingFiles.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="rollup-modal__actions">
          <button
            type="button"
            className="rollup-modal__btn rollup-modal__btn--ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rollup-modal__btn rollup-modal__btn--primary"
            disabled={!branchValid || !prTitle.trim() || submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="spin" /> Building…
              </>
            ) : (
              <>
                <GitFork size={14} /> Build &amp; Open PR
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
