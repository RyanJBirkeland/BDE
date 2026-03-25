/**
 * AgentConsole — Terminal-style detail pane replacing AgentDetail.
 * Uses virtual scrolling for performance with 500+ events.
 */
import { useRef, useEffect, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown } from 'lucide-react'
import type { AgentEvent } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { pairEvents } from '../../lib/pair-events'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import { ConsoleHeader } from './ConsoleHeader'
import { ConsoleLine } from './ConsoleLine'

interface AgentConsoleProps {
  agentId: string
  onSteer: (message: string) => void
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: tokens.color.background,
}

const scrollAreaStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  contain: 'strict',
  minHeight: 0,
}

const jumpButtonStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: tokens.space[3],
  left: '50%',
  transform: 'translateX(-50%)',
  background: tokens.color.accent,
  color: tokens.color.background,
  border: 'none',
  borderRadius: tokens.radius.full,
  padding: `${tokens.space[1]} ${tokens.space[3]}`,
  fontSize: tokens.size.sm,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: tokens.space[1],
  boxShadow: `0 2px 8px ${tokens.color.shadow}`,
  transition: tokens.transition.fast,
  zIndex: 10,
}

const commandBarPlaceholderStyle: React.CSSProperties = {
  height: '48px',
  borderTop: `1px solid ${tokens.color.border}`,
  display: 'flex',
  alignItems: 'center',
  padding: `0 ${tokens.space[3]}`,
  color: tokens.color.textDim,
  fontSize: tokens.size.sm,
  flexShrink: 0,
}

export function AgentConsole({ agentId, onSteer }: AgentConsoleProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [showJumpButton, setShowJumpButton] = useState(false)

  // Load agent meta and events
  const agents = useAgentHistoryStore((s) => s.agents)
  const agent = agents.find((a) => a.id === agentId)
  const events = useAgentEventsStore((s) => s.events[agentId] ?? [])

  const blocks = useMemo(() => pairEvents(events), [events])

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
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    isAtBottomRef.current = atBottom
    setShowJumpButton(!atBottom && blocks.length > 0)
  }

  const handleJumpToLatest = () => {
    if (blocks.length > 0) {
      virtualizer.scrollToIndex(blocks.length - 1, { align: 'end' })
      isAtBottomRef.current = true
      setShowJumpButton(false)
    }
  }

  if (!agent) {
    return (
      <div style={containerStyle}>
        <div style={{ padding: tokens.space[4], color: tokens.color.textDim, textAlign: 'center' }}>
          Agent not found
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle} className="agent-console">
      <ConsoleHeader agent={agent} events={events} />

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={parentRef} onScroll={handleScroll} style={scrollAreaStyle}>
          {blocks.length > 0 ? (
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
                  }}
                >
                  <ConsoleLine block={blocks[virtualRow.index]} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: tokens.space[4], color: tokens.color.textDim, textAlign: 'center' }}>
              No events available
            </div>
          )}
        </div>

        {showJumpButton && (
          <button
            onClick={handleJumpToLatest}
            style={jumpButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateX(-50%) scale(1.05)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateX(-50%) scale(1)'
            }}
          >
            Jump to latest
            <ChevronDown size={16} />
          </button>
        )}
      </div>

      {/* CommandBar placeholder — will be implemented in Task 5 */}
      <div style={commandBarPlaceholderStyle}>
        {agent.status === 'running' ? 'Command bar (coming soon)...' : ''}
      </div>
    </div>
  )
}
