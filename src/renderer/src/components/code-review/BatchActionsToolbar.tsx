import { GitMerge, GitPullRequest, Loader2, Rocket, Trash2, X } from 'lucide-react'
import type { BatchActionKey } from '../../hooks/useBatchActions'

interface BatchActionsToolbarProps {
  selectedCount: number
  batchActionInFlight: BatchActionKey | null
  ghConfigured: boolean
  onMergeAll: () => void
  onShipAll: () => void
  onCreatePrs: () => void
  onDiscard: () => void
  onClear: () => void
}

function ActionIcon({
  inFlight,
  actionKey,
  icon
}: {
  inFlight: BatchActionKey | null
  actionKey: BatchActionKey
  icon: React.ReactNode
}): React.JSX.Element {
  return inFlight === actionKey ? <Loader2 size={14} className="spin" /> : <>{icon}</>
}

export function BatchActionsToolbar({
  selectedCount,
  batchActionInFlight,
  ghConfigured,
  onMergeAll,
  onShipAll,
  onCreatePrs,
  onDiscard,
  onClear
}: BatchActionsToolbarProps): React.JSX.Element {
  return (
    <>
      <span className="cr-topbar__batch-count" aria-live="polite" aria-atomic="true">
        {selectedCount} tasks selected
      </span>
      <button
        className="cr-topbar__btn cr-topbar__btn--primary"
        onClick={onMergeAll}
        disabled={!!batchActionInFlight}
        aria-label={`Merge all ${selectedCount} selected tasks locally`}
      >
        <ActionIcon
          inFlight={batchActionInFlight}
          actionKey="batchMerge"
          icon={<GitMerge size={14} />}
        />{' '}
        Merge All
      </button>
      <button
        className="cr-topbar__btn cr-topbar__btn--ship"
        onClick={onShipAll}
        disabled={!!batchActionInFlight || !ghConfigured}
        aria-label={`Ship all ${selectedCount} selected tasks as pull requests`}
      >
        <ActionIcon
          inFlight={batchActionInFlight}
          actionKey="batchShip"
          icon={<Rocket size={14} />}
        />{' '}
        Ship All
      </button>
      <button
        className="cr-topbar__btn cr-topbar__btn--secondary"
        onClick={onCreatePrs}
        disabled={!!batchActionInFlight || !ghConfigured}
        aria-label={`Create pull requests for all ${selectedCount} selected tasks`}
      >
        <ActionIcon
          inFlight={batchActionInFlight}
          actionKey="batchPr"
          icon={<GitPullRequest size={14} />}
        />{' '}
        Create PRs
      </button>
      <button
        className="cr-topbar__btn cr-topbar__btn--ghost"
        onClick={onDiscard}
        disabled={!!batchActionInFlight}
        aria-label={`Discard all ${selectedCount} selected tasks`}
      >
        <ActionIcon
          inFlight={batchActionInFlight}
          actionKey="batchDiscard"
          icon={<Trash2 size={14} />}
        />{' '}
        Discard All
      </button>
      <button
        className="cr-topbar__btn cr-topbar__btn--ghost"
        onClick={onClear}
        disabled={!!batchActionInFlight}
      >
        <X size={14} /> Clear
      </button>
    </>
  )
}
