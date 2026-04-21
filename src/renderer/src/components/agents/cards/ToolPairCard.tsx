import './ConsoleCard.css'
import { formatTime, getToolMeta } from './util'
import { formatToolSummary } from '../../../lib/tool-summaries'
import { CollapsibleBlock } from '../CollapsibleBlock'
import { EditDiffCard } from './EditDiffCard'

interface ToolPairCardProps {
  tool: string
  summary: string
  input?: unknown | undefined
  result: { success: boolean; summary: string; output?: unknown }
  timestamp: number
  searchClass: string
}

function renderExpandedContent(
  tool: string,
  input: unknown,
  result: { success: boolean; summary: string; output?: unknown }
): React.JSX.Element {
  const toolLower = tool.toLowerCase()
  const toolSummary = formatToolSummary(tool, input)

  // Edit/Write tools: show diff or code block
  if (toolLower === 'edit' || toolLower === 'write') {
    return (
      <div className="console-line__detail-group">
        {toolSummary && <div className="console-line__tool-summary">{toolSummary}</div>}
        <EditDiffCard input={input} />
        {result.output !== undefined && (
          <div className="console-line__detail">
            <div className="console-line__detail-label">Output</div>
            <pre className="console-line__json">
              <code>{JSON.stringify(result.output, null, 2)}</code>
            </pre>
          </div>
        )}
      </div>
    )
  }

  // Bash: show command + output as code block
  if (toolLower === 'bash') {
    const inputObj = input as Record<string, unknown>
    const command = inputObj?.command
    const outputObj = result.output as Record<string, unknown> | undefined
    const stdout = outputObj?.stdout

    return (
      <div className="console-line__detail-group">
        {toolSummary && <div className="console-line__tool-summary">{toolSummary}</div>}
        {typeof command === 'string' && (
          <div className="console-line__detail">
            <div className="console-line__detail-label">Command</div>
            <pre className="console-line__json">
              <code>{command}</code>
            </pre>
          </div>
        )}
        {typeof stdout === 'string' && (
          <div className="console-line__detail">
            <div className="console-line__detail-label">Output</div>
            <pre className="console-line__json">
              <code>{stdout}</code>
            </pre>
          </div>
        )}
      </div>
    )
  }

  // Default: JSON pretty-print
  return (
    <div className="console-line__detail-group">
      {toolSummary && <div className="console-line__tool-summary">{toolSummary}</div>}
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
  )
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
    <div className={`console-card ${searchClass}`}>
      <CollapsibleBlock
        testId="console-line-tool-pair"
        searchClass=""
        header={
          <div className="console-card__header">
            <meta.Icon size={16} style={{ color: meta.color }} />
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
          </div>
        }
        expandedContent={renderExpandedContent(tool, input, result)}
      />
    </div>
  )
}
