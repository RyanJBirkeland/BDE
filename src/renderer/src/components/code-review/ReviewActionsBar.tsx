import './ReviewActionsBar.css'
import {
  GitMerge,
  GitPullRequest,
  RotateCcw,
  Trash2,
  Loader2,
  Rocket,
  RefreshCw,
  FolderOpen,
  CheckCheck,
  Settings
} from 'lucide-react'
import { useReviewActions } from '../../hooks/useReviewActions'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { useIDEStore } from '../../stores/ide'
import { ConfirmModal } from '../ui/ConfirmModal'
import { TextareaPromptModal } from '../ui/TextareaPromptModal'

const MAX_REVISION_ATTEMPTS = 5

// V2 freshness chip helpers — status dot class + label text
const FRESHNESS_DOT_CLASS: Record<string, string> = {
  fresh: 'fleet-dot fleet-dot--done',
  stale: 'fleet-dot fleet-dot--blocked',
  conflict: 'fleet-dot fleet-dot--failed',
  unknown: 'fleet-dot fleet-dot--queued',
  loading: 'fleet-dot fleet-dot--running'
}

function freshnessLabel(freshness: { status: string; commitsBehind?: number | undefined }): string {
  if (freshness.status === 'fresh') return 'Fresh'
  if (freshness.status === 'stale') return `Stale · ${freshness.commitsBehind ?? '?'} behind`
  if (freshness.status === 'conflict') return 'Conflict'
  if (freshness.status === 'loading') return 'Checking…'
  return 'Unknown'
}

export interface ReviewActionCallbacks {
  actionInFlight: string | null
  mergeStrategy: 'squash' | 'merge' | 'rebase'
  setMergeStrategy: (strategy: 'squash' | 'merge' | 'rebase') => void
  freshness: {
    status: 'fresh' | 'stale' | 'conflict' | 'unknown' | 'loading'
    commitsBehind?: number | undefined
  }
  ghConfigured: boolean
  worktreePath: string | null | undefined
  revisionCount: number
  shipIt: () => Promise<void>
  mergeLocally: () => Promise<void>
  createPr: () => Promise<void>
  requestRevision: () => Promise<void>
  rebase: () => Promise<void>
  discard: () => Promise<void>
  markShippedOutsideFleet: () => Promise<void>
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
    worktreePath,
    revisionCount,
    shipIt,
    mergeLocally,
    createPr,
    requestRevision,
    rebase,
    discard,
    markShippedOutsideFleet,
    confirmProps,
    promptProps
  } = useReviewActions()

  const setView = usePanelLayoutStore((s) => s.setView)
  const setRootPath = useIDEStore((s) => s.setRootPath)

  const openWorktreeInIde = (): void => {
    if (worktreePath) {
      setRootPath(worktreePath)
    }
    setView('ide')
  }

  const openWorktreeInFinder = (): void => {
    if (worktreePath) {
      void window.api.window.openWorktreePath(worktreePath)
    }
  }

  const hasConflicts = freshness.status === 'conflict'
  const revisionCapReached = revisionCount >= MAX_REVISION_ATTEMPTS

  const freshnessTitle =
    freshness.status === 'stale'
      ? `${freshness.commitsBehind} commit(s) behind main`
      : freshness.status === 'conflict'
        ? 'Last rebase had conflicts'
        : freshness.status === 'fresh'
          ? 'Up to date with main'
          : 'Checking...'

  const renderFreshnessBadge = (): React.ReactNode => {
    const dotClass = FRESHNESS_DOT_CLASS[freshness.status]
    const label = freshnessLabel(freshness)
    return (
      <span
        title={freshnessTitle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--s-1)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-2xs)',
          background: 'var(--surf-1)',
          border: '1px solid var(--line)',
          borderRadius: 999,
          padding: '1px 7px',
          whiteSpace: 'nowrap'
        }}
      >
        <span className={dotClass} />
        {label}
      </span>
    )
  }

  const renderRebaseButton = (): React.ReactNode => (
    <button
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--s-1)',
        height: 26,
        padding: '0 var(--s-2)',
        background: 'transparent',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        color: 'var(--fg-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-xs)',
        cursor: 'pointer'
      }}
      onClick={rebase}
      disabled={!!actionInFlight || freshness.status === 'fresh'}
      title="Rebase agent branch onto current main"
    >
      {actionInFlight === 'rebase' ? (
        <Loader2 size={12} style={{ animation: 'fleet-spin 1s linear infinite' }} />
      ) : (
        <RefreshCw size={12} />
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
    worktreePath,
    revisionCount,
    shipIt,
    mergeLocally,
    createPr,
    requestRevision,
    rebase,
    discard,
    markShippedOutsideFleet,
    renderFreshnessBadge,
    renderRebaseButton
  }

  return (
    <>
      {/* TODO(phase-4.5): refit ReviewActionsBar full variant to V2 tokens */}
      {variant === 'full' && (
        <div className="rab">
          {/* Conflict resolution banner — shown when rebase left unresolved conflicts */}
          {hasConflicts && (
            <div className="rab__conflict-banner">
              <span className="rab__conflict-banner__message">
                This branch has conflicts that must be resolved manually.
              </span>
              <button
                className="rab__btn rab__btn--ghost"
                onClick={openWorktreeInIde}
                title="Open the worktree in the IDE to resolve conflicts"
              >
                <FolderOpen size={14} /> Open in IDE
              </button>
            </div>
          )}

          {/* Freshness badge + Rebase button */}
          <div className="rab__rebase-status">
            {renderFreshnessBadge()}
            {renderRebaseButton()}
            {worktreePath && (
              <button
                className="rab__btn rab__btn--ghost"
                onClick={openWorktreeInFinder}
                title="Open the agent's worktree directory in Finder"
              >
                <FolderOpen size={14} /> Open in Finder
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="rab__buttons-row">
            <div className="rab__primary">
              {ghConfigured ? (
                <button
                  className="rab__btn rab__btn--ship"
                  onClick={shipIt}
                  disabled={!!actionInFlight}
                  aria-busy={actionInFlight === 'shipIt'}
                  aria-label={
                    actionInFlight === 'shipIt' ? 'Shipping changes, please wait…' : 'Ship It'
                  }
                >
                  {actionInFlight === 'shipIt' ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Rocket size={14} />
                  )}{' '}
                  Ship It
                </button>
              ) : (
                <button
                  className="rab__btn rab__btn--ghost"
                  onClick={() => usePanelLayoutStore.getState().setView('settings')}
                  title="Connect GitHub to enable Ship It and Create PR"
                >
                  <Settings size={14} /> Connect GitHub →
                </button>
              )}
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
                  className="rab__strategy fleet-select"
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
              {ghConfigured && (
                <button
                  className="rab__btn rab__btn--secondary"
                  onClick={createPr}
                  disabled={!!actionInFlight}
                >
                  {actionInFlight === 'createPr' ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <GitPullRequest size={14} />
                  )}{' '}
                  Create PR
                </button>
              )}
            </div>
            <div className="rab__secondary">
              <button
                className="rab__btn rab__btn--ghost"
                onClick={markShippedOutsideFleet}
                disabled={!!actionInFlight}
                title="Mark as done when you shipped this work outside FLEET"
              >
                {actionInFlight === 'markShipped' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <CheckCheck size={14} />
                )}{' '}
                Shipped Outside FLEET
              </button>
              <button
                className="rab__btn rab__btn--ghost"
                onClick={requestRevision}
                disabled={!!actionInFlight || revisionCapReached}
                title={
                  revisionCapReached
                    ? `Max revisions (${MAX_REVISION_ATTEMPTS}/${MAX_REVISION_ATTEMPTS})`
                    : actionInFlight
                      ? 'Another action is in progress'
                      : undefined
                }
              >
                {actionInFlight === 'revise' ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <RotateCcw size={14} />
                )}{' '}
                {revisionCapReached
                  ? `Max revisions (${MAX_REVISION_ATTEMPTS}/${MAX_REVISION_ATTEMPTS})`
                  : 'Revise'}
              </button>
              <button
                className="rab__btn rab__btn--danger"
                onClick={discard}
                disabled={!!actionInFlight}
                title={actionInFlight ? 'Another action is in progress' : undefined}
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
