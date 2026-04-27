import type { ReactNode } from 'react'

type RichEmptyStateProps = {
  icon?: ReactNode | undefined
  title: string
  message?: never | undefined
  description?: string | undefined
  action?: { label: string; onClick: () => void }
  className?: string | undefined
}

type SimpleEmptyStateProps = {
  message: string
  title?: never | undefined
  icon?: never | undefined
  description?: never | undefined
  action?: never | undefined
  className?: string | undefined
}

type EmptyStateProps = RichEmptyStateProps | SimpleEmptyStateProps

export function EmptyState(props: EmptyStateProps): React.JSX.Element {
  if ('message' in props && props.message != null) {
    const cls = ['fleet-empty-state', props.className].filter(Boolean).join(' ')
    return <div className={cls}>{props.message}</div>
  }

  const { icon, title, description, action, className } = props as RichEmptyStateProps
  const cls = ['fleet-empty', className].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {icon && <div className="fleet-empty__icon">{icon}</div>}
      <div className="fleet-empty__title">{title}</div>
      {description && <div className="fleet-empty__desc">{description}</div>}
      {action && (
        <button className="fleet-btn fleet-btn--primary fleet-btn--sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
