import { tokens } from '../../design-system/tokens'

interface HealthBarProps {
  connected: boolean
  stats: { queued: number; active: number; doneToday: number; failed: number } | null
}

export function HealthBar({ connected, stats }: HealthBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[3],
        height: '28px',
        padding: `0 ${tokens.space[3]}`,
        background: tokens.color.surface,
        borderBottom: `1px solid ${tokens.color.border}`,
        fontFamily: tokens.font.ui,
        fontSize: tokens.size.sm,
        color: tokens.color.textMuted,
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: tokens.space[1],
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: tokens.radius.full,
            background: connected ? tokens.color.success : tokens.color.danger,
            flexShrink: 0,
          }}
        />
        {connected ? (
          <span style={{ color: tokens.color.text }}>Connected</span>
        ) : (
          <span style={{ color: tokens.color.textDim }}>Not configured</span>
        )}
      </span>

      {stats && (
        <>
          <span style={{ color: tokens.color.border }}>|</span>
          <span>
            Queued: <span style={{ color: tokens.color.text }}>{stats.queued}</span>
          </span>
          <span>
            Active: <span style={{ color: tokens.color.text }}>{stats.active}</span>
          </span>
          <span>
            Done today: <span style={{ color: tokens.color.text }}>{stats.doneToday}</span>
          </span>
          <span>
            Failed:{' '}
            <span style={{ color: stats.failed > 0 ? tokens.color.danger : tokens.color.text }}>
              {stats.failed}
            </span>
          </span>
        </>
      )}
    </div>
  )
}
