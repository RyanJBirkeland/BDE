import './ConsoleCard.css'
import { formatTime, getToolMeta } from './util'
import { formatToolSummary } from '../../../lib/tool-summaries'
import { CollapsibleBlock } from '../CollapsibleBlock'
import { EditDiffCard } from './EditDiffCard'

interface ToolCallCardProps {
  tool: string
  summary: string
  input?: unknown | undefined
  timestamp: number
  searchClass: string
}

function renderExpandedContent(tool: string, input: unknown): React.JSX.Element | null {
  if (input === undefined) return null

  const toolLower = tool.toLowerCase()
  const toolSummary = formatToolSummary(tool, input)

  // Edit/Write tools: show diff or code block
  if (toolLower === 'edit' || toolLower === 'write') {
    return (
      <div className="console-line__detail">
        {toolSummary && <div className="console-line__tool-summary">{toolSummary}</div>}
        <EditDiffCard input={input} />
      </div>
    )
  }

  // Bash: show command + output as code block
  if (toolLower === 'bash') {
    const inputObj = input as Record<string, unknown>
    const command = inputObj?.command
    return (
      <div className="console-line__detail">
        {toolSummary && <div className="console-line__tool-summary">{toolSummary}</div>}
        {typeof command === 'string' && (
          <pre className="console-line__json">
            <code>{command}</code>
          </pre>
        )}
      </div>
    )
  }

  // Read: no expansion (one-line card)
  if (toolLower === 'read') {
    return null
  }

  // Default: JSON pretty-print
  return (
    <div className="console-line__detail">
      {toolSummary && <div className="console-line__tool-summary">{toolSummary}</div>}
      <div className="console-line__detail-label">Input</div>
      <pre className="console-line__json">
        <code>{JSON.stringify(input, null, 2)}</code>
      </pre>
    </div>
  )
}

export function ToolCallCard({
  tool,
  summary,
  input,
  timestamp,
  searchClass
}: ToolCallCardProps): React.JSX.Element {
  const meta = getToolMeta(tool)
  const expandedContent = renderExpandedContent(tool, input)

  // If there's no expanded content, render a simple one-line card
  if (!expandedContent) {
    return (
      <div className={`console-card ${searchClass}`} data-testid="console-line-tool-call">
        <div className="console-card__header">
          <meta.Icon size={16} style={{ color: meta.color }} />
          <span className="console-prefix console-prefix--tool">[tool]</span>
          <span className="console-line__content">
            {tool} — {summary}
          </span>
          <span className="console-line__timestamp">{formatTime(timestamp)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`console-card ${searchClass}`}>
      <CollapsibleBlock
        testId="console-line-tool-call"
        searchClass=""
        header={
          <div className="console-card__header">
            <meta.Icon size={16} style={{ color: meta.color }} />
            <span className="console-prefix console-prefix--tool">[tool]</span>
            <span className="console-line__content">
              {tool} — {summary}
            </span>
            <span className="console-line__timestamp">{formatTime(timestamp)}</span>
          </div>
        }
        expandedContent={expandedContent}
      />
    </div>
  )
}
