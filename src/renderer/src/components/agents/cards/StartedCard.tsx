import '../ConsoleLine.css'
import { formatTime } from './util'

interface StartedCardProps {
  model: string
  timestamp: number
  searchClass: string
}

export function StartedCard({ model, timestamp, searchClass }: StartedCardProps): React.JSX.Element {
  return (
    <div className={`console-line${searchClass}`} data-testid="console-line-started">
      <span className="console-prefix console-prefix--agent">[agent]</span>
      <span className="console-line__content">Started with model {model}</span>
      <span className="console-line__timestamp">{formatTime(timestamp)}</span>
    </div>
  )
}
