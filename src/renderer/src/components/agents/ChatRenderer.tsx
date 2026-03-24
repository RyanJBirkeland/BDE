/**
 * ChatRenderer — hybrid event renderer with tool-call pairing and virtualization.
 * Pre-processes AgentEvent[] into ChatBlock[] (pairing tool_call + tool_result),
 * then renders via @tanstack/react-virtual for performance with 500+ events.
 */
import { useRef, useEffect, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { AgentEvent } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { ChatBubble } from './ChatBubble'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { PlaygroundCard } from './PlaygroundCard'

// --- Chat Block Types (discriminated union) ---

export type ChatBlock =
  | { type: 'started'; model: string; timestamp: number }
  | { type: 'text'; text: string; timestamp: number }
  | { type: 'user_message'; text: string; timestamp: number }
  | { type: 'thinking'; tokenCount: number; text?: string; timestamp: number }
  | { type: 'tool_call'; tool: string; summary: string; input?: unknown; timestamp: number }
  | { type: 'tool_pair'; tool: string; summary: string; input?: unknown; result: { success: boolean; summary: string; output?: unknown }; timestamp: number }
  | { type: 'error'; message: string; timestamp: number }
  | { type: 'rate_limited'; retryDelayMs: number; attempt: number; timestamp: number }
  | { type: 'completed'; exitCode: number; costUsd: number; tokensIn: number; tokensOut: number; durationMs: number; timestamp: number }
  | { type: 'playground'; filename: string; html: string; sizeBytes: number; timestamp: number }

// --- Event Pairing Logic ---

export function pairEvents(events: AgentEvent[]): ChatBlock[] {
  const blocks: ChatBlock[] = []

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]

    switch (ev.type) {
      case 'agent:started':
        blocks.push({ type: 'started', model: ev.model, timestamp: ev.timestamp })
        break

      case 'agent:text':
        blocks.push({ type: 'text', text: ev.text, timestamp: ev.timestamp })
        break

      case 'agent:user_message':
        blocks.push({ type: 'user_message', text: ev.text, timestamp: ev.timestamp })
        break

      case 'agent:thinking':
        blocks.push({ type: 'thinking', tokenCount: ev.tokenCount, text: ev.text, timestamp: ev.timestamp })
        break

      case 'agent:tool_call': {
        // Look ahead for a matching tool_result
        const next = events[i + 1]
        if (next?.type === 'agent:tool_result' && next.tool === ev.tool) {
          blocks.push({
            type: 'tool_pair',
            tool: ev.tool,
            summary: ev.summary,
            input: ev.input,
            result: { success: next.success, summary: next.summary, output: next.output },
            timestamp: ev.timestamp,
          })
          i++ // Skip the paired result
        } else {
          blocks.push({ type: 'tool_call', tool: ev.tool, summary: ev.summary, input: ev.input, timestamp: ev.timestamp })
        }
        break
      }

      case 'agent:tool_result':
        // Orphaned result (no preceding call) — render as-is
        blocks.push({
          type: 'tool_call',
          tool: ev.tool,
          summary: ev.summary,
          timestamp: ev.timestamp,
        })
        break

      case 'agent:error':
        blocks.push({ type: 'error', message: ev.message, timestamp: ev.timestamp })
        break

      case 'agent:rate_limited':
        blocks.push({ type: 'rate_limited', retryDelayMs: ev.retryDelayMs, attempt: ev.attempt, timestamp: ev.timestamp })
        break

      case 'agent:completed':
        blocks.push({
          type: 'completed',
          exitCode: ev.exitCode,
          costUsd: ev.costUsd,
          tokensIn: ev.tokensIn,
          tokensOut: ev.tokensOut,
          durationMs: ev.durationMs,
          timestamp: ev.timestamp,
        })
        break

      case 'agent:playground':
        blocks.push({
          type: 'playground',
          filename: ev.filename,
          html: ev.html,
          sizeBytes: ev.sizeBytes,
          timestamp: ev.timestamp,
        })
        break
    }
  }

  return blocks
}

// --- Block Renderers ---

function StartedBlock({ model, timestamp }: { model: string; timestamp: number }) {
  return (
    <div style={{ padding: tokens.space[2], color: tokens.color.textMuted, fontSize: tokens.size.xs, textAlign: 'center' }}>
      Agent started {model ? `(${model})` : ''} at {new Date(timestamp).toLocaleTimeString()}
    </div>
  )
}

function CompletedBlock({ exitCode, costUsd, durationMs }: { exitCode: number; costUsd: number; durationMs: number }) {
  const durationSec = (durationMs / 1000).toFixed(1)
  const color = exitCode === 0 ? tokens.color.success : tokens.color.danger
  return (
    <div style={{
      padding: tokens.space[2],
      fontSize: tokens.size.xs,
      textAlign: 'center',
      color,
    }}>
      {exitCode === 0 ? 'Completed' : `Failed (exit ${exitCode})`}
      {' — '}${costUsd.toFixed(4)} · {durationSec}s
    </div>
  )
}

function RateLimitedBlock({ attempt, retryDelayMs }: { attempt: number; retryDelayMs: number }) {
  return (
    <div style={{
      padding: tokens.space[2],
      fontSize: tokens.size.xs,
      textAlign: 'center',
      color: tokens.color.warning,
      background: tokens.color.warningDim,
      borderRadius: tokens.radius.sm,
    }}>
      Rate limited (attempt {attempt}) — retrying in {(retryDelayMs / 1000).toFixed(0)}s
    </div>
  )
}

function renderBlock(block: ChatBlock) {
  switch (block.type) {
    case 'started':
      return <StartedBlock model={block.model} timestamp={block.timestamp} />
    case 'text':
      return <ChatBubble variant="agent" text={block.text} timestamp={block.timestamp} />
    case 'user_message':
      return <ChatBubble variant="user" text={block.text} timestamp={block.timestamp} />
    case 'thinking':
      return <ThinkingBlock tokenCount={block.tokenCount} text={block.text} />
    case 'tool_call':
      return <ToolCallBlock tool={block.tool} summary={block.summary} input={block.input} timestamp={block.timestamp} />
    case 'tool_pair':
      return <ToolCallBlock tool={block.tool} summary={block.summary} input={block.input} result={block.result} timestamp={block.timestamp} />
    case 'error':
      return <ChatBubble variant="error" text={block.message} timestamp={block.timestamp} />
    case 'rate_limited':
      return <RateLimitedBlock attempt={block.attempt} retryDelayMs={block.retryDelayMs} />
    case 'completed':
      return <CompletedBlock exitCode={block.exitCode} costUsd={block.costUsd} durationMs={block.durationMs} />
    case 'playground':
      return <PlaygroundCard filename={block.filename} html={block.html} sizeBytes={block.sizeBytes} timestamp={block.timestamp} />
  }
}

// --- Virtualized ChatRenderer ---

interface ChatRendererProps {
  events: AgentEvent[]
}

export function ChatRenderer({ events }: ChatRendererProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const blocks = useMemo(() => pairEvents(events), [events])
  const isAtBottomRef = useRef(true)

  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  })

  // Auto-scroll: follow tail when at bottom
  useEffect(() => {
    if (isAtBottomRef.current && blocks.length > 0) {
      virtualizer.scrollToIndex(blocks.length - 1, { align: 'end' })
    }
  }, [blocks.length, virtualizer])

  const handleScroll = () => {
    const el = parentRef.current
    if (!el) return
    const threshold = 100
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      style={{
        height: '100%',
        overflow: 'auto',
        contain: 'strict',
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
              padding: `${tokens.space[1]} ${tokens.space[3]}`,
            }}
          >
            {renderBlock(blocks[virtualRow.index])}
          </div>
        ))}
      </div>
    </div>
  )
}
