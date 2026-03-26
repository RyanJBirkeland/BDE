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
  background: tokens.color.surface,
  borderRadius: tokens.radius.sm,
  fontSize: tokens.size.xs,
  fontFamily: tokens.font.code,
  color: tokens.color.textMuted,
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[1],
        padding: `${tokens.space[2]} ${tokens.space[3]}`,
        borderRadius: tokens.radius.sm,
        fontSize: tokens.size.sm,
        borderLeft: `3px solid ${tokens.color.info}`
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
          style={{
            color: tokens.color.info,
            transition: tokens.transition.fast,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0
          }}
        />
        <span
          style={{
            background: tokens.color.infoDim,
            color: tokens.color.info,
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
          style={{
            color: tokens.color.text,
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
            style={{
              background: result.success ? tokens.color.accentDim : tokens.color.dangerDim,
              color: result.success ? tokens.color.success : tokens.color.danger,
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
          style={{
            color: tokens.color.textDim,
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
                style={{
                  fontSize: tokens.size.xs,
                  color: tokens.color.textDim,
                  marginBottom: tokens.space[1]
                }}
              >
                Input
              </div>
              <pre style={jsonBlockStyle}>
                <code>{JSON.stringify(input, null, 2)}</code>
              </pre>
            </div>
          )}
          {result?.output !== undefined && (
            <div>
              <div
                style={{
                  fontSize: tokens.size.xs,
                  color: tokens.color.textDim,
                  marginBottom: tokens.space[1]
                }}
              >
                Output
              </div>
              <pre style={jsonBlockStyle}>
                <code>{JSON.stringify(result.output, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
