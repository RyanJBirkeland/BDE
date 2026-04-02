import type { ReactNode } from 'react'

type EmptyStateProps = {
  icon?: ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="bde-empty">
      {icon && <div className="bde-empty__icon">{icon}</div>}
      <div className="bde-empty__title">{title}</div>
      {description && <div className="bde-empty__desc">{description}</div>}
      {action && (
        <button className="bde-btn bde-btn--primary bde-btn--sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
