import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import './CollapsibleBlock.css'

interface CollapsibleBlockProps {
  header: React.ReactNode
  expandedContent: React.ReactNode
  searchClass?: string
  testId?: string
}

export function CollapsibleBlock({
  header,
  expandedContent,
  searchClass = '',
  testId
}: CollapsibleBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={`console-line console-line--collapsible${expanded ? ' console-line--expanded' : ''}${searchClass}`}
      data-testid={testId}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="console-collapsible-button"
        aria-label={expanded ? 'Collapse' : 'Expand'}
      >
        <ChevronRight
          size={14}
          className="console-line__chevron"
          style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)'
          }}
        />
        {header}
      </button>
      {expanded && expandedContent}
    </div>
  )
}
