import type { ReactNode } from 'react'

type PanelProps = {
  title?: string | undefined
  actions?: ReactNode | undefined
  children: ReactNode
  className?: string | undefined
}

export function Panel({ title, actions, children, className }: PanelProps): React.JSX.Element {
  const classes = ['fleet-panel', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      {title && (
        <div className="fleet-panel__header">
          <span className="fleet-panel__title">{title}</span>
          {actions && <div className="fleet-panel__actions">{actions}</div>}
        </div>
      )}
      <div className="fleet-panel__body">{children}</div>
    </div>
  )
}
