/**
 * ConsoleLine — Renders a single agent event as a terminal-style line with colored prefix.
 * Supports collapsible content for thinking, tool_call, and tool_pair blocks.
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { tokens } from '../../design-system/tokens'
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
  wordBreak: 'break-word',
}

const lineStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: tokens.space[2],
  fontSize: tokens.size.sm,
  fontFamily: tokens.font.code,
  padding: `${tokens.space[1]} ${tokens.space[2]}`,
}

const prefixStyle = (color: string): React.CSSProperties => ({
  color,
  fontWeight: 700,
  flexShrink: 0,
  fontFamily: tokens.font.code,
})

const contentStyle: React.CSSProperties = {
  flex: 1,
  color: tokens.color.text,
  minWidth: 0,
  wordBreak: 'break-word',
}

const timestampStyle: React.CSSProperties = {
  color: tokens.color.textDim,
  fontSize: tokens.size.xs,
  flexShrink: 0,
  marginLeft: 'auto',
}

const badgeStyle = (color: string, bgColor: string): React.CSSProperties => ({
  background: bgColor,
  color,
  padding: `0 ${tokens.space[1]}`,
  borderRadius: tokens.radius.sm,
  fontSize: tokens.size.xs,
  marginLeft: tokens.space[2],
  flexShrink: 0,
})

export function ConsoleLine({ block }: ConsoleLineProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  switch (block.type) {
    case 'started':
      return (
        <div style={lineStyle} data-testid="console-line-started">
          <span style={prefixStyle(tokens.color.info)}>[agent]</span>
          <span style={contentStyle}>Started with model {block.model}</span>
          <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'text':
      return (
        <div style={lineStyle} data-testid="console-line-text">
          <span style={prefixStyle(tokens.color.info)}>[agent]</span>
          <span style={contentStyle}>{block.text}</span>
          <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'user_message':
      return (
        <div style={lineStyle} data-testid="console-line-user">
          <span style={prefixStyle('#ff69b4')}>[user]</span>
          <span style={contentStyle}>{block.text}</span>
          <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'thinking': {
      return (
        <div style={{ ...lineStyle, flexDirection: 'column', gap: tokens.space[1] }} data-testid="console-line-thinking">
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
              textAlign: 'left',
            }}
            aria-label={expanded ? 'Collapse thinking' : 'Expand thinking'}
          >
            <ChevronRight
              size={14}
              style={{
                color: 'var(--bde-purple)',
                transition: tokens.transition.fast,
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                flexShrink: 0,
              }}
            />
            <span style={prefixStyle('var(--bde-purple)')}>[think]</span>
            <span style={contentStyle}>Thinking...</span>
            <span style={badgeStyle('var(--bde-purple)', 'var(--bde-purple-dim)')}>
              {block.tokenCount.toLocaleString()} tokens
            </span>
            <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
          </button>
          {expanded && block.text && (
            <div
              style={{
                paddingLeft: tokens.space[6],
                fontFamily: tokens.font.code,
                fontSize: tokens.size.sm,
                color: tokens.color.textMuted,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                maxHeight: '300px',
                overflowY: 'auto',
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
        <div style={{ ...lineStyle, flexDirection: 'column', gap: tokens.space[1] }} data-testid="console-line-tool-call">
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
              textAlign: 'left',
            }}
            aria-label={expanded ? 'Collapse tool call' : 'Expand tool call'}
          >
            <ChevronRight
              size={14}
              style={{
                color: tokens.color.info,
                transition: tokens.transition.fast,
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                flexShrink: 0,
              }}
            />
            <span style={prefixStyle(tokens.color.info)}>[tool]</span>
            <span style={contentStyle}>
              {block.tool} — {block.summary}
            </span>
            <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
          </button>
          {expanded && block.input !== undefined && (
            <div style={{ paddingLeft: tokens.space[6] }}>
              <div style={{ fontSize: tokens.size.xs, color: tokens.color.textDim, marginBottom: tokens.space[1] }}>
                Input
              </div>
              <pre style={jsonBlockStyle}>
                <code>{JSON.stringify(block.input, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      )
    }

    case 'tool_pair': {
      return (
        <div style={{ ...lineStyle, flexDirection: 'column', gap: tokens.space[1] }} data-testid="console-line-tool-pair">
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
              textAlign: 'left',
            }}
            aria-label={expanded ? 'Collapse tool pair' : 'Expand tool pair'}
          >
            <ChevronRight
              size={14}
              style={{
                color: tokens.color.info,
                transition: tokens.transition.fast,
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                flexShrink: 0,
              }}
            />
            <span style={prefixStyle(tokens.color.info)}>[tool]</span>
            <span style={contentStyle}>
              {block.tool} — {block.summary}
            </span>
            <span
              style={badgeStyle(
                block.result.success ? tokens.color.success : tokens.color.danger,
                block.result.success ? tokens.color.accentDim : tokens.color.dangerDim
              )}
            >
              {block.result.success ? 'success' : 'failed'}
            </span>
            <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
          </button>
          {expanded && (
            <div style={{ paddingLeft: tokens.space[6], display: 'flex', flexDirection: 'column', gap: tokens.space[2] }}>
              {block.input !== undefined && (
                <div>
                  <div style={{ fontSize: tokens.size.xs, color: tokens.color.textDim, marginBottom: tokens.space[1] }}>
                    Input
                  </div>
                  <pre style={jsonBlockStyle}>
                    <code>{JSON.stringify(block.input, null, 2)}</code>
                  </pre>
                </div>
              )}
              {block.result.output !== undefined && (
                <div>
                  <div style={{ fontSize: tokens.size.xs, color: tokens.color.textDim, marginBottom: tokens.space[1] }}>
                    Output
                  </div>
                  <pre style={jsonBlockStyle}>
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
        <div style={lineStyle} data-testid="console-line-error">
          <span style={prefixStyle(tokens.color.danger)}>[error]</span>
          <span style={contentStyle}>{block.message}</span>
          <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'rate_limited':
      return (
        <div style={lineStyle} data-testid="console-line-rate-limited">
          <span style={prefixStyle(tokens.color.warning)}>[rate]</span>
          <span style={contentStyle}>
            Rate limited, retry in {Math.ceil(block.retryDelayMs / 1000)}s (attempt {block.attempt})
          </span>
          <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'completed':
      return (
        <div style={lineStyle} data-testid="console-line-completed">
          <span style={prefixStyle(tokens.color.info)}>[done]</span>
          <span style={contentStyle}>
            ${block.costUsd.toFixed(4)} • {block.tokensIn + block.tokensOut} tokens • {(block.durationMs / 1000).toFixed(2)}s
          </span>
          <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'playground':
      return (
        <div style={lineStyle} data-testid="console-line-playground">
          <span style={prefixStyle(tokens.color.info)}>[play]</span>
          <span style={contentStyle}>
            {block.filename} ({Math.ceil(block.sizeBytes / 1024)}KB) — clickable
          </span>
          <span style={timestampStyle}>{formatTime(block.timestamp)}</span>
        </div>
      )
  }
}
