import './ReviewActionsBar.css'
import {
  GitMerge,
  GitPullRequest,
  RotateCcw,
  Trash2,
  Loader2,
  Rocket,
  RefreshCw
} from 'lucide-react'
import { useReviewActions } from '../../hooks/useReviewActions'
import { ConfirmModal } from '../ui/ConfirmModal'
import { TextareaPromptModal } from '../ui/TextareaPromptModal'

export interface ReviewActionCallbacks {
  actionInFlight: string | null
  mergeStrategy: 'squash' | 'merge' | 'rebase'
  setMergeStrategy: (strategy: 'squash' | 'merge' | 'rebase') => void
  freshness: {
    status: 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'
    commitsBehind?: number | undefined
  }
  ghConfigured: boolean
  shipIt: () => Promise<void>
  mergeLocally: () => Promise<void>
  createPr: () => Promise<void>
  requestRevision: () => Promise<void>
  rebase: () => Promise<void>
  discard: () => Promise<void>
  renderFreshnessBadge: () => React.ReactNode
  renderRebaseButton: () => React.ReactNode
}

interface ReviewActionsBarProps {
  variant: 'full' | 'compact'
  children?: ((actions: ReviewActionCallbacks) => React.ReactNode) | undefined
}

export function ReviewActionsBar({ variant, children }: ReviewActionsBarProps): React.JSX.Element {
  const {
    actionInFlight,
    mergeStrategy,
    setMergeStrategy,
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

  const freshnessTitle =
    freshness.status === 'stale'
      ? `${freshness.commitsBehind} commit(s) behind main`
      : freshness.status === 'conflict'
        ? 'Last rebase had conflicts'
        : freshness.status === 'fresh'
          ? 'Up to date with main'
          : 'Checking...'

  const renderFreshnessBadge = (): React.ReactNode => (
    <span className={`rab__freshness rab__freshness--${freshness.status}`} title={freshnessTitle}>
      {freshness.status === 'fresh' && 'Fresh'}
      {freshness.status === 'stale' && `Stale (${freshness.commitsBehind} behind)`}
      {freshness.status === 'conflict' && 'Conflict'}
      {freshness.status === 'unknown' && 'Unknown'}
      {freshness.status === 'loading' && '...'}
    </span>
  )

  const renderRebaseButton = (): React.ReactNode => (
    <button
      className="rab__btn rab__btn--ghost"
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
  )

  const actions: ReviewActionCallbacks = {
    actionInFlight,
    mergeStrategy,
    setMergeStrategy,
    freshness,
    ghConfigured,
    shipIt,
    mergeLocally,
    createPr,
    requestRevision,
    rebase,
    discard,
    renderFreshnessBadge,
    renderRebaseButton
  }

  return (
    <>
      {variant === 'full' && (
        <div className="rab">
          {/* Freshness badge + Rebase button */}
          <div className="rab__rebase-status">
            {renderFreshnessBadge()}
            {renderRebaseButton()}
          </div>

          {/* Action buttons */}
          <div className="rab__buttons-row">
            <div className="rab__primary">
              <button
                className="rab__btn rab__btn--ship"
                onClick={shipIt}
                disabled={!!actionInFlight || !ghConfigured}
                aria-busy={actionInFlight === 'shipIt'}
                aria-label={
                  actionInFlight === 'shipIt' ? 'Shipping changes, please wait…' : 'Ship It'
                }
                title={!ghConfigured ? 'Configure GitHub in Settings → Connections' : undefined}
              >
                {actionInFlight === 'shipIt' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Rocket size={14} />
                )}{' '}
                Ship It
              </button>
              <div className="rab__merge-group">
                <button
                  className="rab__btn rab__btn--primary"
                  onClick={mergeLocally}
                  disabled={
                    !!actionInFlight ||
                    freshness.status === 'stale' ||
                    freshness.status === 'conflict'
                  }
                  title={
                    freshness.status === 'stale'
                      ? 'Branch is stale — rebase required before merging'
                      : freshness.status === 'conflict'
                        ? 'Branch has conflicts — rebase required before merging'
                        : undefined
                  }
                >
                  {actionInFlight === 'merge' ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <GitMerge size={14} />
                  )}{' '}
                  Merge Locally
                </button>
                <select
                  className="rab__strategy bde-select"
                  aria-label="Merge strategy"
                  title="Squash: single commit. Merge: preserve branch history. Rebase: linear history."
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
                className="rab__btn rab__btn--secondary"
                onClick={createPr}
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
            </div>
            <div className="rab__secondary">
              <button
                className="rab__btn rab__btn--ghost"
                onClick={requestRevision}
                disabled={!!actionInFlight}
              >
                {actionInFlight === 'revise' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <RotateCcw size={14} />
                )}{' '}
                Revise
              </button>
              <button
                className="rab__btn rab__btn--danger"
                onClick={discard}
                disabled={!!actionInFlight}
              >
                {actionInFlight === 'discard' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Trash2 size={14} />
                )}{' '}
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {variant === 'compact' && children && children(actions)}

      <ConfirmModal {...confirmProps} />
      <TextareaPromptModal {...promptProps} />
    </>
  )
}
