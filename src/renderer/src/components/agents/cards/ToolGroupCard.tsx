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
  const sortedTools = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const breakdown = sortedTools.map(([name, count]) => `${count} ${name}`).join(', ')

  return (
    <div className={`console-card ${searchClass}`}>
      <CollapsibleBlock
        testId="console-line-tool-group"
        searchClass=""
        header={
          <div className="console-card__header">
            <div className="console-tool-group__icons">
              {sortedTools.map(([toolName, count]) => {
                const meta = getToolMeta(toolName)
                return (
                  <span key={toolName} className="console-tool-group__chip">
                    <meta.Icon size={14} style={{ color: meta.color }} />
                    {count > 1 && <span className="console-tool-group__count">{count}</span>}
                  </span>
                )
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
