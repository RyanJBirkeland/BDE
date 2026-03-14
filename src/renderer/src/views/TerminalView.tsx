import { TerminalPane } from '../components/terminal/TerminalPane'

export function TerminalView(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0A0A0A' }}>
      <TerminalPane />
    </div>
  )
}
