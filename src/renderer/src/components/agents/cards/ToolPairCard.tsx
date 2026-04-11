import '../ConsoleLine.css'
import { formatTime, getToolMeta } from './util'
import { formatToolSummary } from '../../../lib/tool-summaries'
import { CollapsibleBlock } from '../CollapsibleBlock'

interface ToolPairCardProps {
  tool: string
  summary: string
  input?: unknown
  result: { success: boolean; summary: string; output?: unknown }
  timestamp: number
  searchClass: string
}

export function ToolPairCard({
  tool,
  summary,
  input,
  result,
  timestamp,
  searchClass
}: ToolPairCardProps): React.JSX.Element {
  const meta = getToolMeta(tool)
  return (
    <CollapsibleBlock
      testId="console-line-tool-pair"
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
          <span
            className={`console-badge ${result.success ? 'console-badge--success' : 'console-badge--danger'}`}
          >
            {result.success ? 'success' : 'failed'}
          </span>
          <span className="console-line__timestamp">{formatTime(timestamp)}</span>
        </>
      }
      expandedContent={
        <div className="console-line__detail-group">
          {(() => {
            const summary = formatToolSummary(tool, input)
            return summary ? <div className="console-line__tool-summary">{summary}</div> : null
          })()}
          {input !== undefined && (
            <div className="console-line__detail">
              <div className="console-line__detail-label">Input</div>
              <pre className="console-line__json">
                <code>{JSON.stringify(input, null, 2)}</code>
              </pre>
            </div>
          )}
          {result.output !== undefined && (
            <div className="console-line__detail">
              <div className="console-line__detail-label">Output</div>
              <pre className="console-line__json">
                <code>{JSON.stringify(result.output, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      }
    />
  )
}
