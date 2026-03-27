/**
 * AgentConsole — Terminal-style detail pane replacing AgentDetail.
 * Uses virtual scrolling for performance with 500+ events.
 */
import { useRef, useEffect, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown } from 'lucide-react'
import { pairEvents } from '../../lib/pair-events'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import { ConsoleHeader } from './ConsoleHeader'
import { ConsoleLine } from './ConsoleLine'
import { CommandBar } from './CommandBar'

const EMPTY_EVENTS: never[] = []

interface AgentConsoleProps {
  agentId: string
  onSteer: (message: string) => void
  onCommand: (cmd: string, args?: string) => void
}

export function AgentConsole({ agentId, onSteer, onCommand }: AgentConsoleProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [showJumpButton, setShowJumpButton] = useState(false)

  // Load agent meta and events
  const agents = useAgentHistoryStore((s) => s.agents)
  const agent = agents.find((a) => a.id === agentId)
  const events = useAgentEventsStore((s) => s.events[agentId] ?? EMPTY_EVENTS)

  const blocks = useMemo(() => pairEvents(events), [events])

  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10
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
      <div className="agent-console">
        <div style={{ padding: '16px', color: 'var(--neon-text-dim, rgba(255,255,255,0.3))', textAlign: 'center' }}>
          Agent not found
        </div>
      </div>
    )
  }

  return (
    <div className="agent-console">
      <ConsoleHeader agent={agent} events={events} />

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div ref={parentRef} onScroll={handleScroll} className="console-body">
          {blocks.length > 0 ? (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative'
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
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <ConsoleLine block={blocks[virtualRow.index]} />
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{ padding: '16px', color: 'var(--neon-text-dim, rgba(255,255,255,0.3))', textAlign: 'center' }}
            >
              No events available
            </div>
          )}
        </div>

        {showJumpButton && (
          <button onClick={handleJumpToLatest} className="console-jump-to-latest">
            Jump to latest
            <ChevronDown size={16} />
          </button>
        )}
      </div>

      {/* CommandBar */}
      <CommandBar
        onSend={onSteer}
        onCommand={onCommand}
        disabled={agent.status !== 'running'}
        disabledReason={agent.status !== 'running' ? 'Agent not running' : undefined}
      />
    </div>
  )
}
