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
  return inFlight === actionKey ? <Loader2 size={12} className="spin" /> : <>{icon}</>
}

/**
 * Batch mode toolbar — replaces the TopBar when selectedBatchIds.size > 0.
 * Follows the V2 button matrix: Ship all = accent, Merge/Create PRs = secondary,
 * Discard = danger text.
 */
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
      {/* Count chip */}
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-xs)',
          color: 'var(--fg)',
          background: 'var(--accent-soft)',
          border: '1px solid var(--accent-line)',
          borderRadius: 'var(--r-sm)',
          padding: '1px var(--s-2)',
          whiteSpace: 'nowrap'
        }}
      >
        {selectedCount} selected
      </span>

      {/* Ship all — primary accent */}
      <button
        style={buttonStyle('accent')}
        onClick={onShipAll}
        disabled={!!batchActionInFlight || !ghConfigured}
        aria-label={`Ship all ${selectedCount} selected tasks as pull requests`}
      >
        <ActionIcon inFlight={batchActionInFlight} actionKey="batchShip" icon={<Rocket size={12} />} />
        Ship all
      </button>

      {/* Merge all — secondary */}
      <button
        style={buttonStyle('secondary')}
        onClick={onMergeAll}
        disabled={!!batchActionInFlight}
        aria-label={`Merge all ${selectedCount} selected tasks locally`}
      >
        <ActionIcon inFlight={batchActionInFlight} actionKey="batchMerge" icon={<GitMerge size={12} />} />
        Merge all
      </button>

      {/* Create PRs — secondary */}
      <button
        style={buttonStyle('secondary')}
        onClick={onCreatePrs}
        disabled={!!batchActionInFlight || !ghConfigured}
        aria-label={`Create pull requests for all ${selectedCount} selected tasks`}
      >
        <ActionIcon inFlight={batchActionInFlight} actionKey="batchPr" icon={<GitPullRequest size={12} />} />
        Create PRs
      </button>

      {/* Discard — danger text */}
      <button
        style={buttonStyle('danger')}
        onClick={onDiscard}
        disabled={!!batchActionInFlight}
        aria-label={`Discard all ${selectedCount} selected tasks`}
      >
        <ActionIcon inFlight={batchActionInFlight} actionKey="batchDiscard" icon={<Trash2 size={12} />} />
        Discard
      </button>

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Clear — ghost */}
      <button
        style={{ ...buttonStyle('secondary'), marginLeft: 'auto' }}
        onClick={onClear}
        disabled={!!batchActionInFlight}
      >
        <X size={12} /> Clear
      </button>
    </>
  )
}

type ButtonVariant = 'accent' | 'secondary' | 'danger'

function buttonStyle(variant: ButtonVariant): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--s-1)',
    height: 28,
    padding: '0 var(--s-3)',
    borderRadius: 'var(--r-md)',
    fontSize: 'var(--t-sm)',
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  }

  if (variant === 'accent') {
    return { ...base, background: 'var(--accent)', color: 'var(--accent-fg)', border: 'none' }
  }
  if (variant === 'danger') {
    return {
      ...base,
      background: 'transparent',
      color: 'var(--st-failed)',
      border: '1px solid color-mix(in oklch, var(--st-failed) 30%, transparent)'
    }
  }
  // secondary
  return {
    ...base,
    background: 'transparent',
    color: 'var(--fg-2)',
    border: '1px solid var(--line)'
  }
}
