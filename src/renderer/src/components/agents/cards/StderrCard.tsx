import '../ConsoleLine.css'
import { formatTime } from './util'

interface StderrCardProps {
  text: string
  timestamp: number
  searchClass: string
}

export function StderrCard({ text, timestamp, searchClass }: StderrCardProps): React.JSX.Element {
  return (
    <div className={`console-line${searchClass}`} data-testid="console-line-stderr">
      <span className="console-prefix console-prefix--rate">[stderr]</span>
      <span className="console-line__content console-line__content--stderr">{text}</span>
      <span className="console-line__timestamp">{formatTime(timestamp)}</span>
    </div>
  )
}
