/**
 * AgentConsole — Coordinator for the terminal-style agent detail pane.
 * Manages state (search, pending messages, playground) and delegates
 * rendering to AgentConsoleHeader, AgentConsoleStream, and AgentComposer.
 */
import { useEffect, useMemo, useState, useCallback, startTransition } from 'react'
import './AgentConsole.css'
import type { ChatBlock } from '../../lib/pair-events'
import { pairEvents } from '../../lib/pair-events'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import { AgentConsoleHeader } from './AgentConsoleHeader'
import { AgentConsoleStream } from './AgentConsoleStream'
import { AgentComposer } from './AgentComposer'
import { PlaygroundModal } from './PlaygroundModal'
import { ConsoleSearchBar } from './ConsoleSearchBar'
import type { Attachment, PlaygroundContentType } from '../../../../shared/types'

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
  const [playgroundBlock, setPlaygroundBlock] = useState<{
    filename: string
    html: string
    contentType: PlaygroundContentType
    sizeBytes: number
  } | null>(null)
  const [pendingMessages, setPendingMessages] = useState<{ text: string; timestamp: number }[]>([])

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

  // Inject pending messages at the end — timestamps captured at send time, not during render
  const blocks = useMemo(() => {
    const pendingBlocks: ChatBlock[] = pendingMessages.map(({ text, timestamp }) => ({
      type: 'user_message',
      text,
      timestamp,
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

  // Compute matching block indices — array for ordered navigation, Set for O(1) per-row lookup.
  const { matchingIndicesArray, matchingIndicesSet } = useMemo(() => {
    if (!searchQuery) return { matchingIndicesArray: [], matchingIndicesSet: new Set<number>() }
    const arr = blocks
      .map((block, i) => (blockMatchesQuery(block, searchQuery) ? i : -1))
      .filter((i) => i !== -1)
    return { matchingIndicesArray: arr, matchingIndicesSet: new Set(arr) }
  }, [blocks, searchQuery, blockMatchesQuery])

  // Remove pending messages when real user_message events arrive.
  // startTransition defers the state update so it doesn't run synchronously inside the effect.
  useEffect(() => {
    const hasUserMessage = events.some((e) => e.type === 'agent:user_message')
    if (hasUserMessage && pendingMessages.length > 0) {
      startTransition(() => {
        setPendingMessages((prev) => prev.slice(1))
      })
    }
  }, [events, pendingMessages.length])

  const handleSteer = (message: string, attachment?: Attachment): void => {
    setPendingMessages((prev) => [...prev, { text: message, timestamp: Date.now() }])
    onSteer(message, attachment)
  }

  // Search handlers
  const handleSearchChange = (query: string): void => {
    setSearchQuery(query)
    setActiveMatchIndex(0)
  }

  const handleSearchNext = (): void => {
    if (matchingIndicesArray.length === 0) return
    setActiveMatchIndex((prev) => (prev + 1) % matchingIndicesArray.length)
  }

  const handleSearchPrev = (): void => {
    if (matchingIndicesArray.length === 0) return
    setActiveMatchIndex((prev) =>
      prev === 0 ? matchingIndicesArray.length - 1 : prev - 1
    )
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
        <div style={{ padding: 'var(--s-4)', color: 'var(--fg-3)', textAlign: 'center' }}>
          Agent not found
        </div>
      </div>
    )
  }

  return (
    <div className="agent-console">
      <AgentConsoleHeader agent={agent} events={events} />

      {wasEvicted && (
        <div className="console-cap-banner">Older events were trimmed (showing last 2,000)</div>
      )}

      {searchOpen && (
        <ConsoleSearchBar
          value={searchQuery}
          onSearch={handleSearchChange}
          onClose={handleSearchClose}
          matchCount={matchingIndicesArray.length}
          activeMatch={matchingIndicesArray.length > 0 ? activeMatchIndex + 1 : 0}
          onNext={handleSearchNext}
          onPrev={handleSearchPrev}
        />
      )}

      <AgentConsoleStream
        blocks={blocks}
        matchingIndicesSet={matchingIndicesSet}
        matchingIndicesArray={matchingIndicesArray}
        activeMatchIndex={activeMatchIndex}
        onPlaygroundClick={setPlaygroundBlock}
        isRunning={agent.status === 'running'}
      />

      <AgentComposer
        onSend={handleSteer}
        onCommand={onCommand}
        disabled={agent.status !== 'running'}
        streaming={false}
        model={agent.model}
      />

      {playgroundBlock && (
        <PlaygroundModal
          html={playgroundBlock.html}
          filename={playgroundBlock.filename}
          contentType={playgroundBlock.contentType}
          sizeBytes={playgroundBlock.sizeBytes}
          onClose={() => setPlaygroundBlock(null)}
        />
      )}
    </div>
  )
}
