import '../ConsoleLine.css'
import { formatTime } from './util'
import { renderAgentMarkdown } from '../../../lib/render-agent-markdown'

interface TextCardProps {
  text: string
  timestamp: number
  searchClass: string
}

export function TextCard({ text, timestamp, searchClass }: TextCardProps): React.JSX.Element {
  const isGrouped = text.includes('\n')
  return (
    <div className={`console-line${searchClass}`} data-testid="console-line-text">
      <span className="console-prefix console-prefix--agent">[agent]</span>
      <span
        className={`console-line__content${isGrouped ? ' console-line__content--grouped' : ''}`}
      >
        {renderAgentMarkdown(text)}
      </span>
      <span className="console-line__timestamp">{formatTime(timestamp)}</span>
    </div>
  )
}
