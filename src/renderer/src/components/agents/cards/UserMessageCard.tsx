import '../ConsoleLine.css'
import { formatTime } from './util'

interface UserMessageCardProps {
  text: string
  timestamp: number
  pending?: boolean
  searchClass: string
}

export function UserMessageCard({
  text,
  timestamp,
  pending,
  searchClass
}: UserMessageCardProps): React.JSX.Element {
  return (
    <div
      className={`console-line${pending ? ' console-line--pending' : ''}${searchClass}`}
      data-testid="console-line-user"
    >
      <span className="console-prefix console-prefix--user">[user]</span>
      <span className="console-line__content">{text}</span>
      <span className="console-line__timestamp">{formatTime(timestamp)}</span>
    </div>
  )
}
