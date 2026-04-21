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
    const cls = ['bde-empty-state', props.className].filter(Boolean).join(' ')
    return <div className={cls}>{props.message}</div>
  }

  const { icon, title, description, action, className } = props as RichEmptyStateProps
  const cls = ['bde-empty', className].filter(Boolean).join(' ')
  return (
    <div className={cls}>
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
