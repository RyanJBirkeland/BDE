import '../ConsoleLine.css'
import { formatTime } from './util'
import { CollapsibleBlock } from '../CollapsibleBlock'

interface ThinkingCardProps {
  tokenCount: number
  text?: string
  timestamp: number
  searchClass: string
}

export function ThinkingCard({
  tokenCount,
  text,
  timestamp,
  searchClass
}: ThinkingCardProps): React.JSX.Element {
  return (
    <CollapsibleBlock
      testId="console-line-thinking"
      searchClass={searchClass}
      header={
        <>
          <span className="console-prefix console-prefix--think">[think]</span>
          <span className="console-line__content">Thinking...</span>
          <span className="console-badge console-badge--purple">
            {tokenCount.toLocaleString()} tokens
          </span>
          <span className="console-line__timestamp">{formatTime(timestamp)}</span>
        </>
      }
      expandedContent={
        text ? <div className="console-line__expanded-content">{text}</div> : null
      }
    />
  )
}
