import type { GatewayStatus } from '../../stores/gateway'
import { Badge } from '../ui/Badge'

interface StatusBarProps {
  status: GatewayStatus
  sessionCount: number
  model: string
  onReconnect: () => void
}

function gatewayBadge(status: GatewayStatus): { variant: 'success' | 'muted' | 'warning' | 'danger'; label: string } {
  switch (status) {
    case 'connected':
      return { variant: 'success', label: 'Gateway' }
    case 'not-configured':
      return { variant: 'muted', label: 'Not Configured' }
    case 'connecting':
      return { variant: 'warning', label: 'Connecting' }
    case 'error':
      return { variant: 'danger', label: 'Error' }
    case 'disconnected':
    default:
      return { variant: 'danger', label: 'Disconnected' }
  }
}

export function StatusBar({ status, sessionCount, model, onReconnect }: StatusBarProps): React.JSX.Element {
  const { variant, label } = gatewayBadge(status)
  const isClickable = status !== 'not-configured'

  return (
    <div className="statusbar">
      <div className="statusbar__left">
        <button
          className={`statusbar__connection statusbar__connection--${status === 'connected' ? 'connected' : 'disconnected'}`}
          onClick={isClickable ? onReconnect : undefined}
          title={isClickable ? `Gateway: ${label} — click to reconnect` : 'Gateway not configured — set URL and token in Settings'}
          disabled={!isClickable}
        >
          <Badge variant={variant} size="sm">
            {label}
          </Badge>
        </button>
      </div>

      <div className="statusbar__right">
        {model && <span className="statusbar__model">{model}</span>}
        {sessionCount > 0 && (
          <span className="statusbar__sessions">{sessionCount} session{sessionCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}
