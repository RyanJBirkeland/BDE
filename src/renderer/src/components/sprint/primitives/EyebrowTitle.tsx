interface EyebrowTitleProps {
  eyebrow: string
  title: string
  right?: React.ReactNode
}

export function EyebrowTitle({ eyebrow, title, right }: EyebrowTitleProps): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
        <span className="fleet-eyebrow">{eyebrow}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--fg)',
          letterSpacing: '-0.01em',
          lineHeight: 1.35,
        }}
      >
        {title}
      </span>
    </div>
  )
}
