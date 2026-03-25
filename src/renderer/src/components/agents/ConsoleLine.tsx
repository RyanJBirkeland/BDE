/**
 * ConsoleLine — Renders a single agent event as a terminal-style line with colored prefix.
 * Supports collapsible content for thinking, tool_call, and tool_pair blocks.
 * Uses CSS classes from agents-neon.css for styling.
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ChatBlock } from '../../lib/pair-events'

interface ConsoleLineProps {
  block: ChatBlock
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

export function ConsoleLine({ block }: ConsoleLineProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  switch (block.type) {
    case 'started':
      return (
        <div className="console-line" data-testid="console-line-started">
          <span className="console-line__prefix console-prefix--agent">[agent]</span>
          <span className="console-line__content">Started with model {block.model}</span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'text':
      return (
        <div className="console-line" data-testid="console-line-text">
          <span className="console-line__prefix console-prefix--agent">[agent]</span>
          <span className="console-line__content">{block.text}</span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'user_message':
      return (
        <div className="console-line" data-testid="console-line-user">
          <span className="console-line__prefix console-prefix--user">[user]</span>
          <span className="console-line__content">{block.text}</span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'thinking': {
      return (
        <div
          className={`console-line console-line--collapsible ${expanded ? 'console-line--expanded' : ''}`}
          data-testid="console-line-thinking"
        >
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              width: '100%',
              textAlign: 'left',
            }}
            aria-label={expanded ? 'Collapse thinking' : 'Expand thinking'}
          >
            <ChevronRight
              size={14}
              style={{
                color: 'var(--neon-purple)',
                transition: '150ms ease',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                flexShrink: 0,
              }}
            />
            <span className="console-line__prefix console-prefix--think">[think]</span>
            <span className="console-line__content">
              Thinking...{' '}
              <span
                style={{
                  background: 'rgba(138, 43, 226, 0.2)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  marginLeft: '4px',
                }}
              >
                {block.tokenCount.toLocaleString()} tokens
              </span>
            </span>
            <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
          </button>
          {expanded && block.text && (
            <div
              style={{
                paddingLeft: '32px',
                fontFamily: 'var(--bde-font-code)',
                fontSize: '12px',
                color: 'rgba(255, 255, 255, 0.6)',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                maxHeight: '300px',
                overflowY: 'auto',
                marginTop: '4px',
              }}
            >
              {block.text}
            </div>
          )}
        </div>
      )
    }

    case 'tool_call': {
      return (
        <div
          className={`console-line console-line--collapsible ${expanded ? 'console-line--expanded' : ''}`}
          data-testid="console-line-tool-call"
        >
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              width: '100%',
              textAlign: 'left',
            }}
            aria-label={expanded ? 'Collapse tool call' : 'Expand tool call'}
          >
            <ChevronRight
              size={14}
              style={{
                color: 'var(--neon-blue)',
                transition: '150ms ease',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                flexShrink: 0,
              }}
            />
            <span className="console-line__prefix console-prefix--tool">[tool]</span>
            <span className="console-line__content">
              {block.tool} — {block.summary}
            </span>
            <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
          </button>
          {expanded && block.input !== undefined && (
            <div style={{ paddingLeft: '32px', marginTop: '4px' }}>
              <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.4)', marginBottom: '4px' }}>Input</div>
              <pre
                style={{
                  margin: 0,
                  padding: '8px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: 'rgba(255, 255, 255, 0.7)',
                  overflow: 'auto',
                  maxHeight: '240px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <code>{JSON.stringify(block.input, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      )
    }

    case 'tool_pair': {
      const badgeStyle: React.CSSProperties = {
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '10px',
        marginLeft: '8px',
        flexShrink: 0,
      }

      const successBadge = (
        <span
          style={{
            ...badgeStyle,
            background: block.result.success ? 'rgba(0, 255, 170, 0.2)' : 'rgba(255, 68, 68, 0.2)',
            color: block.result.success ? '#00ffaa' : '#ff4444',
          }}
        >
          {block.result.success ? 'success' : 'failed'}
        </span>
      )

      return (
        <div
          className={`console-line console-line--collapsible ${expanded ? 'console-line--expanded' : ''}`}
          data-testid="console-line-tool-pair"
        >
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              width: '100%',
              textAlign: 'left',
            }}
            aria-label={expanded ? 'Collapse tool pair' : 'Expand tool pair'}
          >
            <ChevronRight
              size={14}
              style={{
                color: 'var(--neon-blue)',
                transition: '150ms ease',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                flexShrink: 0,
              }}
            />
            <span className="console-line__prefix console-prefix--tool">[tool]</span>
            <span className="console-line__content">
              {block.tool} — {block.summary}
            </span>
            {successBadge}
            <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
          </button>
          {expanded && (
            <div style={{ paddingLeft: '32px', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              {block.input !== undefined && (
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.4)', marginBottom: '4px' }}>Input</div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '8px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      borderRadius: '6px',
                      fontSize: '11px',
                      color: 'rgba(255, 255, 255, 0.7)',
                      overflow: 'auto',
                      maxHeight: '240px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    <code>{JSON.stringify(block.input, null, 2)}</code>
                  </pre>
                </div>
              )}
              {block.result.output !== undefined && (
                <div>
                  <div style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.4)', marginBottom: '4px' }}>Output</div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '8px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      borderRadius: '6px',
                      fontSize: '11px',
                      color: 'rgba(255, 255, 255, 0.7)',
                      overflow: 'auto',
                      maxHeight: '240px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    <code>{JSON.stringify(block.result.output, null, 2)}</code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    case 'error':
      return (
        <div className="console-line" data-testid="console-line-error">
          <span className="console-line__prefix console-prefix--error">[error]</span>
          <span className="console-line__content">{block.message}</span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'rate_limited':
      return (
        <div className="console-line" data-testid="console-line-rate-limited">
          <span className="console-line__prefix console-prefix--rate">[rate]</span>
          <span className="console-line__content">
            Rate limited, retry in {Math.ceil(block.retryDelayMs / 1000)}s (attempt {block.attempt})
          </span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'completed':
      return (
        <div className="console-line" data-testid="console-line-completed">
          <span className="console-line__prefix console-prefix--done">[done]</span>
          <span className="console-line__content">
            ${block.costUsd.toFixed(4)} • {block.tokensIn + block.tokensOut} tokens • {(block.durationMs / 1000).toFixed(2)}s
          </span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'playground':
      return (
        <div className="console-line" data-testid="console-line-playground">
          <span className="console-line__prefix console-prefix--play">[play]</span>
          <span className="console-line__content">
            {block.filename} ({Math.ceil(block.sizeBytes / 1024)}KB) — clickable
          </span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    default:
      return (
        <div className="console-line" data-testid="console-line-unknown">
          <span className="console-line__prefix console-prefix--error">[unknown]</span>
          <span className="console-line__content">Unknown block type</span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )
  }
}
