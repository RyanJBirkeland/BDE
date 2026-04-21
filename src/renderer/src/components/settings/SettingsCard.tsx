/**
 * SettingsCard — reusable card wrapper for settings sections.
 */
import './SettingsCard.css'
import type { ReactNode } from 'react'
import type { StatusVariant } from './StatusPill'
import { StatusPill } from './StatusPill'

interface SettingsCardProps {
  icon?: ReactNode | undefined
  title: string
  subtitle?: string | undefined
  status?: { label: string; variant: StatusVariant } | undefined
  children: ReactNode
  footer?: ReactNode | undefined
  noPadding?: boolean | undefined
}

export function SettingsCard({
  icon,
  title,
  subtitle,
  status,
  children,
  footer,
  noPadding
}: SettingsCardProps): ReactNode {
  const cardClass = ['bde-card', noPadding ? 'bde-card--pad-none' : 'bde-card--pad-md', 'stg-card']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cardClass}>
      <div className="stg-card__header">
        {icon && (
          <div className="stg-card__icon" style={{ width: 36, height: 36 }}>
            {icon}
          </div>
        )}
        <div className="stg-card__header-text">
          <div className="stg-card__title-row">
            <span className="stg-card__title">{title}</span>
            {status && <StatusPill label={status.label} variant={status.variant} />}
          </div>
          {subtitle && <span className="stg-card__subtitle">{subtitle}</span>}
        </div>
      </div>
      <div className="stg-card__body">{children}</div>
      {footer && <div className="stg-card__footer">{footer}</div>}
    </div>
  )
}
