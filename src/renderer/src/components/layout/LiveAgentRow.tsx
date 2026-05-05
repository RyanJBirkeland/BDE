import './LiveAgentRow.css'

interface LiveAgentRowProps {
  title: string
  onClick: () => void
}

export function LiveAgentRow({ title, onClick }: LiveAgentRowProps): React.JSX.Element {
  return (
    <div
      className="live-agent-row"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      style={{
        padding: '7px var(--s-2)',
        borderRadius: 'var(--r-md)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
        <span className="fleet-pulse" style={{ width: 6, height: 6 }} />
        <span
          style={{
            fontSize: 'var(--t-sm)',
            color: 'var(--fg)',
            fontFamily: 'var(--font-mono)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          height: 2,
          background: 'var(--surf-2)',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        <div
          className="live-agent-row__progress"
          style={{
            height: '100%',
            background: 'var(--st-running)',
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  )
}
