import { useState } from 'react'

// TODO(phase-5): consolidate with AgentsView compact row when Phase 5 lands

export interface CompactAgentRowProps {
  agentId: string
  status: 'running' | 'done' | 'failed' | 'review' | 'cancelled' | 'error'
  currentStep?: string
  tokenCount?: number
  onClick?: () => void
}

// 'cancelled' and 'error' share the --st-failed color — no dedicated tokens exist.
function toFleetDotStatus(status: CompactAgentRowProps['status']): string {
  if (status === 'cancelled') return 'failed'
  if (status === 'error') return 'failed'
  return status
}

function StatusIndicator({ status }: { status: CompactAgentRowProps['status'] }): React.JSX.Element {
  if (status === 'running') {
    return <span className="fleet-pulse" style={{ width: 6, height: 6 }} />
  }
  return (
    <span
      className={`fleet-dot fleet-dot--${toFleetDotStatus(status)}`}
      style={{ width: 6, height: 6 }}
    />
  )
}

export function CompactAgentRow({
  agentId,
  status,
  currentStep,
  tokenCount,
  onClick
}: CompactAgentRowProps): React.JSX.Element {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={agentId}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault()
          onClick?.()
        } else if (e.key === 'Enter') {
          onClick?.()
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: '0 var(--s-2)',
        borderRadius: 'var(--r-sm)',
        cursor: 'pointer',
        background: hovered ? 'var(--surf-2)' : 'transparent'
      }}
    >
      <StatusIndicator status={status} />

      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-sm)',
          color: 'var(--fg)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {agentId}
      </span>

      {currentStep !== undefined && (
        <span
          style={{
            fontSize: 'var(--t-sm)',
            color: 'var(--fg-3)'
          }}
        >
          {currentStep}
        </span>
      )}

      {tokenCount !== undefined && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-2xs)',
            color: 'var(--fg-4)'
          }}
        >
          {tokenCount.toLocaleString()}
        </span>
      )}
    </div>
  )
}
