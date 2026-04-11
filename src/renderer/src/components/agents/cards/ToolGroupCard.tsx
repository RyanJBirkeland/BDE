import '../ConsoleLine.css'
import { formatTime } from './util'
import { CollapsibleBlock } from '../CollapsibleBlock'
import type { ToolBlock } from '../../../lib/pair-events'
import { ToolCallCard } from './ToolCallCard'
import { ToolPairCard } from './ToolPairCard'

interface ToolGroupCardProps {
  tools: ToolBlock[]
  timestamp: number
  searchClass: string
  onPlaygroundClick?: (block: { filename: string; html: string; sizeBytes: number }) => void
  searchHighlight?: 'match' | 'active'
}

function renderToolBlock(
  tool: ToolBlock,
  searchHighlight?: 'match' | 'active'
): React.JSX.Element {
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

  if (total === 1) {
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
    <CollapsibleBlock
      testId="console-line-tool-group"
      searchClass={searchClass}
      header={
        <>
          <span className="console-prefix console-prefix--tool">[tools]</span>
          <span className="console-line__content">
            {total} tool calls ({breakdown})
          </span>
          <span className="console-line__timestamp">{formatTime(timestamp)}</span>
        </>
      }
      expandedContent={
        <div className="console-tool-group__items">
          {tools.map((tool, i) => (
            <div key={i}>{renderToolBlock(tool, searchHighlight)}</div>
          ))}
        </div>
      }
    />
  )
}
