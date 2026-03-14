import type { ConnectionStatus } from '../../lib/gateway'

interface StatusBarProps {
  status: ConnectionStatus
  sessionCount: number
  model: string
  onReconnect: () => void
}

export function StatusBar({ status, sessionCount, model, onReconnect }: StatusBarProps): React.JSX.Element {
  const isConnected = status === 'connected'

  return (
    <div className="statusbar">
      <div className="statusbar__left">
        <button
          className={`statusbar__connection ${isConnected ? 'statusbar__connection--connected' : 'statusbar__connection--disconnected'}`}
          onClick={onReconnect}
          title={isConnected ? 'Connected' : 'Click to reconnect'}
        >
          {isConnected ? '◉ Connected ws://127.0.0.1:18789' : '◌ Disconnected'}
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
