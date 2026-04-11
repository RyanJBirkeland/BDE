import './ConsoleCard.css'
import { formatTime } from './util'

interface StartedCardProps {
  model: string
  timestamp: number
  searchClass: string
}

export function StartedCard({ model, timestamp }: StartedCardProps): React.JSX.Element {
  return (
    <div className="console-card console-card--started" data-testid="console-line-started">
      🤖 Agent started · model {model} · {formatTime(timestamp)}
    </div>
  )
}
