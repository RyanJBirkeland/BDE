/**
 * SettingsPageHeader — section title and subtitle for settings pages.
 */
import type { ReactNode } from 'react'

interface SettingsPageHeaderProps {
  title: string
  subtitle: string
}

export function SettingsPageHeader({ title, subtitle }: SettingsPageHeaderProps): ReactNode {
  return (
    <div className="stg-page-header">
      <h2 className="stg-page-header__title">{title}</h2>
      <p className="stg-page-header__subtitle">{subtitle}</p>
    </div>
  )
}
