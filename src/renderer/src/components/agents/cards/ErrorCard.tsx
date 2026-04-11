import '../ConsoleLine.css'
import { formatTime } from './util'

interface ErrorCardProps {
  message: string
  timestamp: number
  searchClass: string
}

export function ErrorCard({ message, timestamp, searchClass }: ErrorCardProps): React.JSX.Element {
  return (
    <div
      className={`console-line console-line--error${searchClass}`}
      data-testid="console-line-error"
    >
      <span className="console-prefix console-prefix--error">[error]</span>
      <span className="console-line__content">{message}</span>
      <span className="console-line__timestamp">{formatTime(timestamp)}</span>
    </div>
  )
}
