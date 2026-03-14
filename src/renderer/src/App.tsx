import { useEffect } from 'react'
import { useGatewayStore } from './stores/gateway'

function App(): React.JSX.Element {
  const status = useGatewayStore((s) => s.status)
  const connect = useGatewayStore((s) => s.connect)

  useEffect(() => {
    connect()
  }, [connect])

  const isConnected = status === 'connected'

  return (
    <>
      <div className="titlebar">
        <span className="titlebar__name">BDE</span>
      </div>

      <div className="main-content">
        <span className="main-content__placeholder">BDE — coming soon</span>
      </div>

      <div className="statusbar">
        <span
          className={`statusbar__indicator ${
            isConnected ? 'statusbar__indicator--connected' : 'statusbar__indicator--disconnected'
          }`}
        >
          {isConnected ? '◉ Connected' : '◌ Disconnected'}
        </span>
      </div>
    </>
  )
}

export default App
