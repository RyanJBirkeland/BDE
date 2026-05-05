interface MiniStatProps {
  label: string
  value: string
}

export function MiniStat({ label, value }: MiniStatProps): React.JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--s-2)',
        background: 'var(--surf-1)',
        border: '1px solid var(--line)',
        borderRadius: 5,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span className="fleet-eyebrow">{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--fg)' }}>
        {value}
      </span>
    </div>
  )
}
