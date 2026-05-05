import React from 'react'

interface EyebrowTitleProps {
  eyebrow: string
  title: string
  count?: number
}

export function EyebrowTitle({ eyebrow, title, count }: EyebrowTitleProps): React.JSX.Element {
  return (
    <div>
      <span className="fleet-eyebrow">{eyebrow}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)', marginTop: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{title}</span>
        {count != null && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--fg-3)',
              marginLeft: 'auto',
            }}
          >
            {count}
          </span>
        )}
      </div>
    </div>
  )
}
