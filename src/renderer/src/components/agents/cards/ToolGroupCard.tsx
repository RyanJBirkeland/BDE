import './ConsoleCard.css'
import { formatTime, getToolMeta } from './util'
import { CollapsibleBlock } from '../CollapsibleBlock'
import type { ToolBlock } from '../../../lib/pair-events'
import type { PlaygroundContentType } from '../../../../../shared/types'
import { ToolCallCard } from './ToolCallCard'
import { ToolPairCard } from './ToolPairCard'

interface ToolGroupCardProps {
  tools: ToolBlock[]
  timestamp: number
  searchClass: string
  onPlaygroundClick?:
    | ((block: {
        filename: string
        html: string
        contentType: PlaygroundContentType
        sizeBytes: number
      }) => void)
    | undefined
  searchHighlight?: 'match' | 'active' | undefined
}

function renderToolBlock(tool: ToolBlock, searchHighlight?: 'match' | 'active'): React.JSX.Element {
  const searchClass = !searchHighlight
    ? ''
    : searchHighlight === 'active'
      ? ' console-line--search-active'
      : ' console-line--search-match'

  if (tool.type === 'tool_call') {
    return (
      <ToolCallCard
        tool={tool.tool}
        summary={tool.summary}
        input={tool.input}
        timestamp={tool.timestamp}
        searchClass={searchClass}
      />
    )
  }

  return (
    <ToolPairCard
      tool={tool.tool}
      summary={tool.summary}
      input={tool.input}
      result={tool.result}
      timestamp={tool.timestamp}
      searchClass={searchClass}
    />
  )
}

export function ToolGroupCard({
  tools,
  timestamp,
  searchClass,
  searchHighlight
}: ToolGroupCardProps): React.JSX.Element {
  const total = tools.length

  if (total === 1 && tools[0]) {
    return renderToolBlock(tools[0], searchHighlight)
  }

  const counts: Record<string, number> = {}
  for (const t of tools) {
    counts[t.tool] = (counts[t.tool] || 0) + 1
  }
  const breakdown = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count} ${name}`)
    .join(', ')

  return (
    <div className={`console-card ${searchClass}`}>
      <CollapsibleBlock
        testId="console-line-tool-group"
        searchClass=""
        header={
          <div className="console-card__header">
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              {tools.map((t, i) => {
                const meta = getToolMeta(t.tool)
                return <meta.Icon key={i} size={14} style={{ color: meta.color }} />
              })}
            </div>
            <span className="console-prefix console-prefix--tool">[tools]</span>
            <span className="console-line__content">
              {total} tool calls — {breakdown}
            </span>
            <span className="console-line__timestamp">{formatTime(timestamp)}</span>
          </div>
        }
        expandedContent={
          <div className="console-tool-group__items">
            {tools.map((tool, i) => (
              <div key={i}>{renderToolBlock(tool, searchHighlight)}</div>
            ))}
          </div>
        }
      />
    </div>
  )
}
