/**
 * AgentConsole — terminal-style detail pane with virtualized console lines.
 * Replaces AgentDetail with a neon-themed console UI.
 */
import { useRef, useEffect, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown } from 'lucide-react'
import type { AgentMeta } from '../../../../shared/types'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import { pairEvents } from '../../lib/pair-events'
import { ConsoleHeader } from './ConsoleHeader'
import { ConsoleLine } from './ConsoleLine'

interface AgentConsoleProps {
  agentId: string
  onSteer: (message: string) => void
}

export function AgentConsole({ agentId, onSteer }: AgentConsoleProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [showJumpButton, setShowJumpButton] = useState(false)

  // Fetch agent and events
  const agent = useAgentHistoryStore((state) =>
    state.agents.find((a) => a.id === agentId)
  )
  const events = useAgentEventsStore((state) => state.events[agentId] ?? [])

  // Pair events into chat blocks
  const blocks = useMemo(() => pairEvents(events), [events])

  // Virtualization
  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  })

  // Auto-scroll: follow tail when at bottom
  useEffect(() => {
    if (isAtBottomRef.current && blocks.length > 0) {
      virtualizer.scrollToIndex(blocks.length - 1, { align: 'end' })
    }
  }, [blocks.length, virtualizer])

  // Track scroll position to show/hide jump button
  const handleScroll = () => {
    const el = parentRef.current
    if (!el) return

    const threshold = 100
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    isAtBottomRef.current = isAtBottom
    setShowJumpButton(!isAtBottom)
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
      <div className="agent-console">
        <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
          Agent not found
        </div>
      </div>
    )
  }

  return (
    <div className="agent-console">
      <ConsoleHeader agent={agent} events={events} />

      <div
        ref={parentRef}
        className="console-body"
        onScroll={handleScroll}
        style={{ position: 'relative' }}
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
              }}
            >
              <ConsoleLine block={blocks[virtualRow.index]} />
            </div>
          ))}
        </div>

        {showJumpButton && (
          <button
            className="console-jump-to-latest"
            onClick={handleJumpToLatest}
            aria-label="Jump to latest"
          >
            <ChevronDown size={14} style={{ marginRight: '4px' }} />
            Jump to latest
          </button>
        )}
      </div>

      {/* CommandBar placeholder — Task 5 will implement this */}
      <div
        className="command-bar"
        style={{ opacity: 0.5, pointerEvents: 'none' }}
        title="Command bar coming in Task 5"
      >
        <span className="command-bar__prompt">$</span>
        <input
          className="command-bar__input"
          type="text"
          placeholder="Command bar (coming soon)"
          disabled
        />
      </div>
    </div>
  )
}
