/**
 * ConsoleLine — Renders a single agent event as a terminal-style line.
 * Uses neon CSS classes (agents-neon.css) for all styling.
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ChatBlock } from '../../lib/pair-events'
import { renderAgentMarkdown } from '../../lib/render-agent-markdown'

interface ConsoleLineProps {
  block: ChatBlock
  onPlaygroundClick?: (block: { filename: string; html: string; sizeBytes: number }) => void
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

interface ToolMeta {
  letter: string
  iconClass: string
}

const TOOL_MAP: Record<string, ToolMeta> = {
  bash: { letter: '$', iconClass: 'console-tool-icon--bash' },
  read: { letter: 'R', iconClass: 'console-tool-icon--read' },
  edit: { letter: 'E', iconClass: 'console-tool-icon--edit' },
  write: { letter: 'W', iconClass: 'console-tool-icon--write' },
  grep: { letter: '?', iconClass: 'console-tool-icon--grep' },
  glob: { letter: 'F', iconClass: 'console-tool-icon--glob' },
  agent: { letter: 'A', iconClass: 'console-tool-icon--agent' },
  list: { letter: 'L', iconClass: 'console-tool-icon--default' },
  task: { letter: 'T', iconClass: 'console-tool-icon--default' },
}

function getToolMeta(toolName: string): ToolMeta {
  return TOOL_MAP[toolName.toLowerCase()] ?? { letter: '\u2022', iconClass: 'console-tool-icon--default' }
}

export function ConsoleLine({ block, onPlaygroundClick }: ConsoleLineProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  switch (block.type) {
    case 'started':
      return (
        <div className="console-line" data-testid="console-line-started">
          <span className="console-prefix console-prefix--agent">[agent]</span>
          <span className="console-line__content">Started with model {block.model}</span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'text': {
      const isGrouped = block.text.includes('\n')
      return (
        <div className="console-line" data-testid="console-line-text">
          <span className="console-prefix console-prefix--agent">[agent]</span>
          <span className={`console-line__content${isGrouped ? ' console-line__content--grouped' : ''}`}>
            {renderAgentMarkdown(block.text)}
          </span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )
    }

    case 'user_message':
      return (
        <div className={`console-line${block.pending ? ' console-line--pending' : ''}`} data-testid="console-line-user">
          <span className="console-prefix console-prefix--user">[user]</span>
          <span className="console-line__content">{block.text}</span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'thinking': {
      return (
        <div
          className={`console-line console-line--collapsible${expanded ? ' console-line--expanded' : ''}`}
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
              className="console-line__chevron"
              style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
            <span className="console-prefix console-prefix--think">[think]</span>
            <span className="console-line__content">Thinking...</span>
            <span className="console-badge console-badge--purple">
              {block.tokenCount.toLocaleString()} tokens
            </span>
            <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
          </button>
          {expanded && block.text && (
            <div className="console-line__expanded-content">
              {block.text}
            </div>
          )}
        </div>
      )
    }

    case 'tool_call': {
      const meta = getToolMeta(block.tool)
      return (
        <div
          className={`console-line console-line--collapsible${expanded ? ' console-line--expanded' : ''}`}
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
              className="console-line__chevron"
              style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
            <span className={`console-tool-icon ${meta.iconClass}`} title={block.tool}>{meta.letter}</span>
            <span className="console-prefix console-prefix--tool">[tool]</span>
            <span className="console-line__content">
              {block.tool} — {block.summary}
            </span>
            <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
          </button>
          {expanded && block.input !== undefined && (
            <div className="console-line__detail">
              <div className="console-line__detail-label">Input</div>
              <pre className="console-line__json">
                <code>{JSON.stringify(block.input, null, 2)}</code>
              </pre>
            </div>
          )}
        </div>
      )
    }

    case 'tool_pair': {
      const meta = getToolMeta(block.tool)
      return (
        <div
          className={`console-line console-line--collapsible${expanded ? ' console-line--expanded' : ''}`}
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
              className="console-line__chevron"
              style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
            <span className={`console-tool-icon ${meta.iconClass}`} title={block.tool}>{meta.letter}</span>
            <span className="console-prefix console-prefix--tool">[tool]</span>
            <span className="console-line__content">
              {block.tool} — {block.summary}
            </span>
            <span className={`console-badge ${block.result.success ? 'console-badge--success' : 'console-badge--danger'}`}>
              {block.result.success ? 'success' : 'failed'}
            </span>
            <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
          </button>
          {expanded && (
            <div className="console-line__detail-group">
              {block.input !== undefined && (
                <div className="console-line__detail">
                  <div className="console-line__detail-label">Input</div>
                  <pre className="console-line__json">
                    <code>{JSON.stringify(block.input, null, 2)}</code>
                  </pre>
                </div>
              )}
              {block.result.output !== undefined && (
                <div className="console-line__detail">
                  <div className="console-line__detail-label">Output</div>
                  <pre className="console-line__json">
                    <code>{JSON.stringify(block.result.output, null, 2)}</code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    case 'stderr':
      return (
        <div className="console-line" data-testid="console-line-stderr">
          <span className="console-prefix console-prefix--rate">[stderr]</span>
          <span className="console-line__content console-line__content--stderr">{block.text}</span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'error':
      return (
        <div className="console-line console-line--error" data-testid="console-line-error">
          <span className="console-prefix console-prefix--error">[error]</span>
          <span className="console-line__content">{block.message}</span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'rate_limited':
      return (
        <div className="console-line" data-testid="console-line-rate-limited">
          <span className="console-prefix console-prefix--rate">[rate]</span>
          <span className="console-line__content">
            Rate limited, retry in {Math.ceil(block.retryDelayMs / 1000)}s (attempt {block.attempt})
          </span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )

    case 'completed': {
      const success = block.exitCode === 0
      return (
        <div
          className={`console-completion-card${success ? '' : ' console-completion-card--failed'}`}
          data-testid="console-line-completed"
        >
          <div className={`console-completion-card__header ${success ? 'console-completion-card__header--success' : 'console-completion-card__header--failed'}`}>
            <span>{success ? '\u2713' : '\u2717'}</span>
            <span>
              {success ? 'Agent completed successfully' : `Agent failed (exit code ${block.exitCode})`}
            </span>
          </div>
          <div className="console-completion-card__stats">
            <div className="console-completion-card__stat">
              <div className="console-completion-card__stat-value console-completion-card__stat-value--cyan">
                {formatDuration(block.durationMs)}
              </div>
              <div className="console-completion-card__stat-label">Duration</div>
            </div>
            <div className="console-completion-card__stat">
              <div className={`console-completion-card__stat-value ${success ? 'console-completion-card__stat-value--cyan' : 'console-completion-card__stat-value--red'}`}>
                ${block.costUsd.toFixed(2)}
              </div>
              <div className="console-completion-card__stat-label">Cost</div>
            </div>
            <div className="console-completion-card__stat">
              <div className="console-completion-card__stat-value console-completion-card__stat-value--purple">
                {formatTokenCount(block.tokensIn)}
              </div>
              <div className="console-completion-card__stat-label">Tokens In</div>
            </div>
            <div className="console-completion-card__stat">
              <div className="console-completion-card__stat-value console-completion-card__stat-value--orange">
                {formatTokenCount(block.tokensOut)}
              </div>
              <div className="console-completion-card__stat-label">Tokens Out</div>
            </div>
          </div>
        </div>
      )
    }

    case 'tool_group': {
      const total = block.tools.length
      if (total === 1) {
        return <ConsoleLine block={block.tools[0]} onPlaygroundClick={onPlaygroundClick} />
      }
      const counts: Record<string, number> = {}
      for (const t of block.tools) {
        counts[t.tool] = (counts[t.tool] || 0) + 1
      }
      const breakdown = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${count} ${name}`)
        .join(', ')
      return (
        <div
          className={`console-line console-line--collapsible${expanded ? ' console-line--expanded' : ''}`}
          data-testid="console-line-tool-group"
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
            aria-label={expanded ? 'Collapse tool group' : 'Expand tool group'}
          >
            <ChevronRight
              size={14}
              className="console-line__chevron"
              style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
            <span className="console-prefix console-prefix--tool">[tools]</span>
            <span className="console-line__content">
              {total} tool calls ({breakdown})
            </span>
            <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
          </button>
          {expanded && (
            <div className="console-tool-group__items">
              {block.tools.map((tool, i) => (
                <ConsoleLine key={i} block={tool} onPlaygroundClick={onPlaygroundClick} />
              ))}
            </div>
          )}
        </div>
      )
    }

    case 'playground':
      return (
        <div
          className="console-line console-line--playground"
          data-testid="console-line-playground"
          role="button"
          tabIndex={0}
          onClick={() => onPlaygroundClick?.(block)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlaygroundClick?.(block) } }}
          style={{ cursor: onPlaygroundClick ? 'pointer' : undefined }}
        >
          <span className="console-prefix console-prefix--play">[play]</span>
          <span className="console-line__content">
            {block.filename} ({Math.ceil(block.sizeBytes / 1024)}KB)
          </span>
          <span className="console-line__timestamp">{formatTime(block.timestamp)}</span>
        </div>
      )
  }
}
