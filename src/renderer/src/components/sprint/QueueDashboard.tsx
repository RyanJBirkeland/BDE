import { tokens } from '../../design-system/tokens'
import type { QueueHealth } from '../../stores/sprintEvents'

interface QueueDashboardProps {
  health: QueueHealth | null
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${tokens.space[2]} ${tokens.space[4]}`,
    background: tokens.color.surfaceHigh,
    borderRadius: tokens.radius.md,
    marginBottom: tokens.space[3],
    fontFamily: tokens.font.ui,
    fontSize: tokens.size.sm,
    minHeight: '32px',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space[2],
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space[4],
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: tokens.radius.full,
    flexShrink: 0,
  },
  stat: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space[1],
    color: tokens.color.textMuted,
  },
  statValue: {
    fontWeight: 600,
    fontFamily: tokens.font.code,
    color: tokens.color.text,
  },
  nullState: {
    color: tokens.color.textDim,
    fontSize: tokens.size.sm,
    fontStyle: 'italic' as const,
  },
} as const

export function QueueDashboard({ health }: QueueDashboardProps) {
  if (!health) {
    return (
      <div style={styles.container} data-testid="queue-dashboard">
        <span style={styles.nullState}>Queue API inactive</span>
      </div>
    )
  }

  const { queue, doneToday, connectedRunners } = health
  const isConnected = connectedRunners > 0
  const failedCount = (queue.failed ?? 0) + (queue.error ?? 0)

  return (
    <div style={styles.container} data-testid="queue-dashboard">
      <div style={styles.left}>
        <span
          style={{
            ...styles.dot,
            backgroundColor: isConnected ? tokens.color.accent : tokens.color.textDim,
          }}
          data-testid="runner-dot"
        />
        <span style={{ color: isConnected ? tokens.color.text : tokens.color.textMuted }}>
          {isConnected ? 'Runner connected' : 'No runner connected'}
        </span>
      </div>

      <div style={styles.right}>
        <span style={styles.stat}>
          Queued <span style={styles.statValue}>{queue.queued ?? 0}</span>
        </span>
        <span style={styles.stat}>
          Active <span style={styles.statValue}>{queue.active ?? 0}</span>
        </span>
        <span style={styles.stat}>
          Done today <span style={styles.statValue}>{doneToday}</span>
        </span>
        <span style={styles.stat}>
          Failed{' '}
          <span
            style={{
              ...styles.statValue,
              color: failedCount > 0 ? tokens.color.danger : tokens.color.text,
            }}
            data-testid="failed-count"
          >
            {failedCount}
          </span>
        </span>
      </div>
    </div>
  )
}
