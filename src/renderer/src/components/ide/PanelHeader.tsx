import type { ReactNode } from 'react'

interface PanelHeaderProps {
  eyebrow: string
  children?: ReactNode
}

export function PanelHeader({ eyebrow, children }: PanelHeaderProps): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--s-3)',
        height: 32,
        borderBottom: '1px solid var(--line)',
        flexShrink: 0
      }}
    >
      <span className="fleet-eyebrow">{eyebrow}</span>
      <div style={{ display: 'flex', gap: 'var(--s-1)' }}>{children}</div>
    </div>
  )
}
