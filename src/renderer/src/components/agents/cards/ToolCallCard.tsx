import '../ConsoleLine.css'
import { formatTime, getToolMeta } from './util'
import { formatToolSummary } from '../../../lib/tool-summaries'
import { CollapsibleBlock } from '../CollapsibleBlock'

interface ToolCallCardProps {
  tool: string
  summary: string
  input?: unknown
  timestamp: number
  searchClass: string
}

export function ToolCallCard({
  tool,
  summary,
  input,
  timestamp,
  searchClass
}: ToolCallCardProps): React.JSX.Element {
  const meta = getToolMeta(tool)
  return (
    <CollapsibleBlock
      testId="console-line-tool-call"
      searchClass={searchClass}
      header={
        <>
          <span className={`console-tool-icon ${meta.iconClass}`} title={tool}>
            {meta.letter}
          </span>
          <span className="console-prefix console-prefix--tool">[tool]</span>
          <span className="console-line__content">
            {tool} — {summary}
          </span>
          <span className="console-line__timestamp">{formatTime(timestamp)}</span>
        </>
      }
      expandedContent={
        input !== undefined ? (
          <div className="console-line__detail">
            {(() => {
              const summary = formatToolSummary(tool, input)
              return summary ? (
                <div className="console-line__tool-summary">{summary}</div>
              ) : null
            })()}
            <div className="console-line__detail-label">Input</div>
            <pre className="console-line__json">
              <code>{JSON.stringify(input, null, 2)}</code>
            </pre>
          </div>
        ) : null
      }
    />
  )
}
