import type { ReactNode } from 'react'

type PanelProps = {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function Panel({ title, actions, children, className }: PanelProps) {
  const classes = ['bde-panel', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      {title && (
        <div className="bde-panel__header">
          <span className="bde-panel__title">{title}</span>
          {actions && <div className="bde-panel__actions">{actions}</div>}
        </div>
      )}
      <div className="bde-panel__body">{children}</div>
    </div>
  )
}
