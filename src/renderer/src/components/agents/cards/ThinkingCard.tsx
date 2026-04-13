import './ConsoleCard.css'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

interface ThinkingCardProps {
  tokenCount: number
  text?: string
  timestamp: number
  searchClass: string
}

export function ThinkingCard({ tokenCount, text }: ThinkingCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const preview = text ? text.slice(0, 120) + (text.length > 120 ? '...' : '') : ''

  return (
    <div className="console-card console-card--reasoning" data-testid="console-line-thinking">
      <div className="console-card__header">
        💭 Reasoning · {tokenCount.toLocaleString()} tokens
        {text && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              color: 'inherit'
            }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              size={14}
              style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 100ms ease'
              }}
            />
          </button>
        )}
      </div>
      {text && !expanded && <div className="console-card__preview">{preview}</div>}
      {text && expanded && <div className="console-card__content">{text}</div>}
    </div>
  )
}
