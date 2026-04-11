import '../ConsoleLine.css'
import { formatTime } from './util'

interface RateLimitedCardProps {
  retryDelayMs: number
  attempt: number
  timestamp: number
  searchClass: string
}

export function RateLimitedCard({
  retryDelayMs,
  attempt,
  timestamp,
  searchClass
}: RateLimitedCardProps): React.JSX.Element {
  return (
    <div className={`console-line${searchClass}`} data-testid="console-line-rate-limited">
      <span className="console-prefix console-prefix--rate">[rate]</span>
      <span className="console-line__content">
        Rate limited, retry in {Math.ceil(retryDelayMs / 1000)}s (attempt {attempt})
      </span>
      <span className="console-line__timestamp">{formatTime(timestamp)}</span>
    </div>
  )
}
