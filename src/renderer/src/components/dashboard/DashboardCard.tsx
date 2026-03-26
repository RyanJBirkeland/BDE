import { tokens } from '../../design-system/tokens'

interface DashboardCardProps {
  title: string
  icon?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}

export function DashboardCard({
  title,
  icon,
  action,
  children
}: DashboardCardProps): React.JSX.Element {
  return (
    <div
      style={{
        background: tokens.color.surface,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.lg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          padding: `${tokens.space[3]} ${tokens.space[4]}`,
          borderBottom: `1px solid ${tokens.color.border}`
        }}
      >
        {icon && (
          <span
            style={{ color: tokens.color.textMuted, display: 'flex', alignItems: 'center' }}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <span
          style={{
            fontSize: tokens.size.sm,
            fontWeight: 600,
            color: tokens.color.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            flex: 1
          }}
        >
          {title}
        </span>
        {action && <span style={{ display: 'flex', alignItems: 'center' }}>{action}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
    </div>
  )
}
