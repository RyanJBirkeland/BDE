/**
 * Collapsible block showing a single tool call with its input/output JSON.
 * Used in agent activity feeds to display tool invocations.
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

interface ToolCallBlockProps {
  tool: string
  summary: string
  input?: unknown
  result?: { success: boolean; summary: string; output?: unknown }
  timestamp: number
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return ''
  }
}

const jsonBlockStyle: React.CSSProperties = {
  margin: 0,
  padding: tokens.space[2],
  borderRadius: tokens.radius.sm,
  fontSize: tokens.size.xs,
  fontFamily: tokens.font.code,
  overflow: 'auto',
  maxHeight: '240px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word'
}

export function ToolCallBlock({
  tool,
  summary,
  input,
  result,
  timestamp
}: ToolCallBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="tool-block"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[1],
        padding: `${tokens.space[2]} ${tokens.space[3]}`,
        borderRadius: tokens.radius.sm,
        fontSize: tokens.size.sm
      }}
      data-testid="tool-call-block"
    >
      {/* Clickable header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          width: '100%',
          textAlign: 'left'
        }}
        aria-label={expanded ? 'Collapse tool call' : 'Expand tool call'}
      >
        <ChevronRight
          size={14}
          className="tool-block__chevron"
          style={{
            transition: tokens.transition.fast,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0
          }}
        />
        <span
          className="tool-block__badge"
          style={{
            padding: `0 ${tokens.space[1]}`,
            borderRadius: tokens.radius.sm,
            fontSize: tokens.size.xs,
            fontFamily: tokens.font.code,
            flexShrink: 0
          }}
        >
          {tool}
        </span>
        <span
          className="tool-block__summary"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0
          }}
        >
          {summary}
        </span>
        {result && (
          <span
            className={
              result.success
                ? 'tool-block__status-badge--success'
                : 'tool-block__status-badge--danger'
            }
            style={{
              padding: `0 ${tokens.space[1]}`,
              borderRadius: tokens.radius.sm,
              fontSize: tokens.size.xs,
              flexShrink: 0
            }}
          >
            {result.success ? 'success' : 'failed'}
          </span>
        )}
        <span
          className="tool-block__timestamp"
          style={{
            fontSize: tokens.size.xs,
            flexShrink: 0,
            marginLeft: 'auto'
          }}
        >
          {formatTime(timestamp)}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: tokens.space[2],
            paddingLeft: tokens.space[4]
          }}
        >
          {input !== undefined && (
            <div>
              <div
                className="tool-block__label"
                style={{
                  fontSize: tokens.size.xs,
                  marginBottom: tokens.space[1]
                }}
              >
                Input
              </div>
              <pre style={jsonBlockStyle} className="tool-block__json-block">
                <code>{JSON.stringify(input, null, 2)}</code>
              </pre>
            </div>
          )}
          {result?.output !== undefined && (
            <div>
              <div
                className="tool-block__label"
                style={{
                  fontSize: tokens.size.xs,
                  marginBottom: tokens.space[1]
                }}
              >
                Output
              </div>
              <pre style={jsonBlockStyle} className="tool-block__json-block">
                <code>{JSON.stringify(result.output, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
