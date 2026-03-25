/**
 * ConsoleLine — single line in the terminal-style agent console.
 * Maps ChatBlock types to terminal prefixes and colors (CSS classes).
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ChatBlock } from '../../lib/pair-events'

interface ConsoleLineProps {
  block: ChatBlock
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

export function ConsoleLine({ block }: ConsoleLineProps) {
  const [expanded, setExpanded] = useState(false)

  switch (block.type) {
    case 'started':
      return (
        <div className="console-line">
          <span className="console-line__prefix console-prefix--agent">START</span>
          <span className="console-line__content">
            Agent started with {block.model}
          </span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )

    case 'text':
      return (
        <div className="console-line">
          <span className="console-line__prefix console-prefix--agent">AGENT</span>
          <span className="console-line__content">{block.text}</span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )

    case 'user_message':
      return (
        <div className="console-line">
          <span className="console-line__prefix console-prefix--user">USER</span>
          <span className="console-line__content">{block.text}</span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )

    case 'thinking': {
      const hasContent = block.text && block.text.trim().length > 0
      return (
        <div
          className={`console-line ${hasContent ? 'console-line--collapsible' : ''} ${expanded ? 'console-line--expanded' : ''}`}
          onClick={hasContent ? () => setExpanded(!expanded) : undefined}
        >
          <span className="console-line__prefix console-prefix--think">
            {hasContent && (
              <ChevronRight size={12} className="console-line__chevron" />
            )}
            THINK
          </span>
          <span className="console-line__content">
            {block.tokenCount} tokens
            {hasContent && expanded && (
              <div className="console-line__collapsed-content">
                <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: 'inherit', whiteSpace: 'pre-wrap' }}>
                  {block.text}
                </pre>
              </div>
            )}
          </span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )
    }

    case 'tool_call':
      return (
        <div className="console-line">
          <span className="console-line__prefix console-prefix--tool">TOOL</span>
          <span className="console-line__content">
            {block.tool} • {block.summary}
          </span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )

    case 'tool_pair': {
      const hasInput = block.input !== undefined
      const hasOutput = block.result.output !== undefined
      const isCollapsible = hasInput || hasOutput

      return (
        <div
          className={`console-line ${isCollapsible ? 'console-line--collapsible' : ''} ${expanded ? 'console-line--expanded' : ''}`}
          onClick={isCollapsible ? () => setExpanded(!expanded) : undefined}
        >
          <span className="console-line__prefix console-prefix--tool">
            {isCollapsible && (
              <ChevronRight size={12} className="console-line__chevron" />
            )}
            TOOL
          </span>
          <span className="console-line__content">
            {block.tool} • {block.summary}
            {!block.result.success && ' ⚠️ Failed'}
            {isCollapsible && expanded && (
              <div className="console-line__collapsed-content">
                {hasInput && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--neon-blue)' }}>Input:</div>
                    <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: 'inherit', whiteSpace: 'pre-wrap' }}>
                      {typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2)}
                    </pre>
                  </div>
                )}
                {hasOutput && (
                  <div style={{ marginTop: hasInput ? '8px' : 0 }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--neon-cyan)' }}>Output:</div>
                    <pre style={{ margin: 0, fontFamily: 'inherit', fontSize: 'inherit', whiteSpace: 'pre-wrap' }}>
                      {typeof block.result.output === 'string' ? block.result.output : JSON.stringify(block.result.output, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )
    }

    case 'error':
      return (
        <div className="console-line">
          <span className="console-line__prefix console-prefix--error">ERROR</span>
          <span className="console-line__content">{block.message}</span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )

    case 'rate_limited':
      return (
        <div className="console-line">
          <span className="console-line__prefix console-prefix--rate">RATE</span>
          <span className="console-line__content">
            Rate limited (attempt {block.attempt}) — retrying in {(block.retryDelayMs / 1000).toFixed(0)}s
          </span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )

    case 'completed': {
      const durationSec = (block.durationMs / 1000).toFixed(1)
      const status = block.exitCode === 0 ? 'Completed' : `Failed (exit ${block.exitCode})`
      return (
        <div className="console-line">
          <span className="console-line__prefix console-prefix--done">DONE</span>
          <span className="console-line__content">
            {status} • ${block.costUsd.toFixed(4)} • {durationSec}s • {block.tokensIn + block.tokensOut} tokens
          </span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )
    }

    case 'playground':
      return (
        <div className="console-line">
          <span className="console-line__prefix console-prefix--play">PLAY</span>
          <span className="console-line__content">
            {truncate(block.filename, 60)} ({(block.sizeBytes / 1024).toFixed(1)} KB)
          </span>
          <span className="console-line__timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      )

    default:
      return null
  }
}
