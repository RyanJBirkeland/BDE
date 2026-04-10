/**
 * AgentConsole — Terminal-style detail pane replacing AgentDetail.
 * Uses virtual scrolling for performance with 500+ events.
 */
import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, Loader } from 'lucide-react'
import './AgentConsole.css'
import type { ChatBlock } from '../../lib/pair-events'
import { pairEvents } from '../../lib/pair-events'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import { ConsoleHeader } from './ConsoleHeader'
import { ConsoleLine } from './ConsoleLine'
import { CommandBar } from './CommandBar'
import { PlaygroundModal } from './PlaygroundModal'
import { ConsoleSearchBar } from './ConsoleSearchBar'
import type { Attachment } from '../../../../shared/types'

const EMPTY_EVENTS: never[] = []

interface AgentConsoleProps {
  agentId: string
  onSteer: (message: string, attachment?: Attachment) => void
  onCommand: (cmd: string, args?: string) => void
}

export function AgentConsole({
  agentId,
  onSteer,
  onCommand
}: AgentConsoleProps): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [showJumpButton, setShowJumpButton] = useState(false)
  const [playgroundBlock, setPlaygroundBlock] = useState<{
    filename: string
    html: string
    sizeBytes: number
  } | null>(null)
  const [pendingMessages, setPendingMessages] = useState<string[]>([])

  // Search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)

  // Load agent meta and events
  const agents = useAgentHistoryStore((s) => s.agents)
  const agent = agents.find((a) => a.id === agentId)
  const events = useAgentEventsStore((s) => s.events[agentId] ?? EMPTY_EVENTS)
  const wasEvicted = useAgentEventsStore((s) => s.evictedAgents[agentId] ?? false)

  const pairedBlocks = useMemo(() => pairEvents(events), [events])

  // Inject pending messages at the end
  const blocks = useMemo(() => {
    const pendingBlocks: ChatBlock[] = pendingMessages.map((text) => ({
      type: 'user_message',
      text,
      timestamp: Date.now(),
      pending: true
    }))
    return [...pairedBlocks, ...pendingBlocks]
  }, [pairedBlocks, pendingMessages])

  // Search helper: check if a block matches the search query
  const blockMatchesQuery = useCallback((block: ChatBlock, query: string): boolean => {
    if (!query) return false
    const lowerQuery = query.toLowerCase()

    switch (block.type) {
      case 'text':
      case 'user_message':
      case 'stderr':
        return block.text.toLowerCase().includes(lowerQuery)
      case 'thinking':
        return block.text?.toLowerCase().includes(lowerQuery) ?? false
      case 'error':
        return block.message.toLowerCase().includes(lowerQuery)
      case 'started':
        return block.model.toLowerCase().includes(lowerQuery)
      case 'tool_call':
      case 'tool_pair':
        return (
          block.summary.toLowerCase().includes(lowerQuery) ||
          block.tool.toLowerCase().includes(lowerQuery)
        )
      case 'tool_group':
        return block.tools.some(
          (t) =>
            t.summary.toLowerCase().includes(lowerQuery) ||
            t.tool.toLowerCase().includes(lowerQuery)
        )
      case 'playground':
        return block.filename.toLowerCase().includes(lowerQuery)
      default:
        return false
    }
  }, [])

  // Compute matching block indices
  const matchingIndices = useMemo(() => {
    if (!searchQuery) return []
    return blocks
      .map((block, i) => (blockMatchesQuery(block, searchQuery) ? i : -1))
      .filter((i) => i !== -1)
  }, [blocks, searchQuery, blockMatchesQuery])

  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10
  })

  // Remove pending messages when real user_message events arrive
  useEffect(() => {
    const userMessageCount = events.filter((e) => e.type === 'agent:user_message').length
    if (userMessageCount > 0 && pendingMessages.length > 0) {
      setPendingMessages((prev) => prev.slice(1))
    }
  }, [events, pendingMessages.length])

  // Auto-scroll: follow tail when at bottom
  useEffect(() => {
    if (isAtBottomRef.current && blocks.length > 0) {
      virtualizer.scrollToIndex(blocks.length - 1, { align: 'end' })
    }
  }, [blocks.length, virtualizer])

  const handleScroll = (): void => {
    const el = parentRef.current
    if (!el) return
    const threshold = 100
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    isAtBottomRef.current = atBottom
    setShowJumpButton(!atBottom && blocks.length > 0)
  }

  const handleJumpToLatest = (): void => {
    if (blocks.length > 0) {
      virtualizer.scrollToIndex(blocks.length - 1, { align: 'end' })
      isAtBottomRef.current = true
      setShowJumpButton(false)
    }
  }

  const handleSteer = (message: string, attachment?: Attachment): void => {
    setPendingMessages((prev) => [...prev, message])
    onSteer(message, attachment)
  }

  // Search handlers
  const handleSearchChange = (query: string): void => {
    setSearchQuery(query)
    setActiveMatchIndex(0)
  }

  const handleSearchNext = (): void => {
    if (matchingIndices.length === 0) return
    const nextIndex = (activeMatchIndex + 1) % matchingIndices.length
    setActiveMatchIndex(nextIndex)
    virtualizer.scrollToIndex(matchingIndices[nextIndex], { align: 'center' })
  }

  const handleSearchPrev = (): void => {
    if (matchingIndices.length === 0) return
    const prevIndex = activeMatchIndex === 0 ? matchingIndices.length - 1 : activeMatchIndex - 1
    setActiveMatchIndex(prevIndex)
    virtualizer.scrollToIndex(matchingIndices[prevIndex], { align: 'center' })
  }

  const handleSearchClose = (): void => {
    setSearchOpen(false)
    setSearchQuery('')
    setActiveMatchIndex(0)
  }

  // Keyboard shortcut for Cmd+F
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (!agent) {
    return (
      <div className="agent-console">
        <div
          style={{
            padding: '16px',
            color: 'var(--bde-text-muted)',
            textAlign: 'center'
          }}
        >
          Agent not found
        </div>
      </div>
    )
  }

  return (
    <div className="agent-console">
      <ConsoleHeader agent={agent} events={events} />

      {wasEvicted && (
        <div className="console-cap-banner">Older events were trimmed (showing last 2,000)</div>
      )}

      {searchOpen && (
        <ConsoleSearchBar
          value={searchQuery}
          onSearch={handleSearchChange}
          onClose={handleSearchClose}
          matchCount={matchingIndices.length}
          activeMatch={matchingIndices.length > 0 ? activeMatchIndex + 1 : 0}
          onNext={handleSearchNext}
          onPrev={handleSearchPrev}
        />
      )}

      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div
          ref={parentRef}
          onScroll={handleScroll}
          className="console-body"
          role="log"
          aria-label="Agent console output"
        >
          {blocks.length > 0 ? (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative'
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const blockIndex = virtualRow.index
                const isMatch = matchingIndices.includes(blockIndex)
                const isActiveMatch = isMatch && matchingIndices[activeMatchIndex] === blockIndex
                const searchHighlight = isActiveMatch ? 'active' : isMatch ? 'match' : undefined

                return (
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
                    <ConsoleLine
                      block={blocks[blockIndex]}
                      onPlaygroundClick={setPlaygroundBlock}
                      searchHighlight={searchHighlight}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="console-empty-state">
              {agent.status === 'running' ? (
                <>
                  <Loader size={20} className="console-empty-state__spinner" />
                  <span>Waiting for agent output…</span>
                </>
              ) : (
                <span>No events recorded for this agent</span>
              )}
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
        onSend={handleSteer}
        onCommand={onCommand}
        disabled={agent.status !== 'running'}
        disabledReason={agent.status !== 'running' ? 'Agent not running' : undefined}
      />

      {playgroundBlock && (
        <PlaygroundModal
          html={playgroundBlock.html}
          filename={playgroundBlock.filename}
          sizeBytes={playgroundBlock.sizeBytes}
          onClose={() => setPlaygroundBlock(null)}
        />
      )}
    </div>
  )
}
