import { useEffect, useRef, useState } from 'react'
import { useFloatingAgentStore } from '../../stores/floatingAgent'
import { FloatingAgentMessage } from './FloatingAgentMessage'
import type { AgentEvent } from '../../../../shared/types'

interface Props {
  onClose: () => void
}

const PLACEHOLDER_REPO = 'bde'

export function FloatingAgentPanel({ onClose }: Props): React.JSX.Element {
  const { messages, estimatedTokens, sessionId, agentId } = useFloatingAgentStore()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const tokenPct = Math.min(100, Math.round((estimatedTokens / 50_000) * 100))

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Listen for agent events scoped to our floating agent session
  useEffect(() => {
    if (!agentId) return
    const unsubscribe = window.api.agents.events.onEvent(
      (payload: { agentId: string; event: AgentEvent }) => {
        if (payload.agentId !== agentId) return
        const { event } = payload
        if (event.type === 'agent:text') {
          useFloatingAgentStore.getState().appendAssistantChunk(event.text)
        }
        if (event.type === 'agent:completed' || event.type === 'agent:error') {
          useFloatingAgentStore.setState({ streamingMessageId: null })
          setSending(false)
        }
      }
    )
    return unsubscribe
  }, [agentId])

  const handleSend = async (): Promise<void> => {
    if (!input.trim() || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)

    const store = useFloatingAgentStore.getState()
    store.addMessage({ role: 'user', content: text })

    try {
      if (store.agentId) {
        // Resume existing session via steer
        const result = await window.api.agents.steer(store.agentId, text)
        if (!result.ok) {
          store.addMessage({ role: 'assistant', content: 'Failed to reach agent. Try again.' })
          setSending(false)
        }
      } else {
        // Spawn a new adhoc session
        const sessionId = `bde-floating-${crypto.randomUUID()}`
        store.setSessionId(sessionId)

        const repoPaths = await window.api.git.getRepoPaths()
        const repoPath =
          Object.values(repoPaths)[0] ??
          `/Users/${window.process?.env?.USER ?? 'user'}/projects/${PLACEHOLDER_REPO}`

        const result = await window.api.agents.spawnLocal({
          task: text,
          repoPath,
          assistant: true
        })
        store.setAgentId(result.id)
        // setSending will be cleared by agent:completed event
      }
    } catch (err) {
      store.addMessage({
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to reach agent'}`
      })
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleNewChat = (): void => {
    useFloatingAgentStore.getState().resetSession()
    setSending(false)
  }

  // ⌘. resets the session while panel is open
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key === '.') {
        handleNewChat()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <div
      className="fa-panel"
      role="complementary"
      aria-label="BDE Advisor"
      data-session={sessionId ?? undefined}
    >
      <div className="fa-panel__header">
        <span className="fa-panel__title">BDE Advisor</span>
        <div className="fa-panel__header-right">
          <span
            className="fa-panel__token-bar"
            title={`~${estimatedTokens.toLocaleString()} / 50,000 tokens`}
          >
            <span className="fa-panel__token-fill" style={{ width: `${tokenPct}%` }} />
          </span>
          <button
            className="fa-panel__new-chat"
            onClick={handleNewChat}
            title="New conversation (⌘.)"
            aria-label="Start new conversation"
          >
            ↺
          </button>
          <button className="fa-panel__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="fa-panel__messages" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="fa-panel__empty">
            Ask about your sprint, pipeline health, agent errors, or anything BDE-related.
          </div>
        )}
        {messages.map((m) => (
          <FloatingAgentMessage key={m.id} message={m} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="fa-panel__input-row">
        <textarea
          className="fa-panel__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask BDE Advisor..."
          rows={2}
          disabled={sending}
          aria-label="Message BDE Advisor"
        />
        <button
          className="fa-panel__send"
          onClick={() => void handleSend()}
          disabled={sending || !input.trim()}
          aria-label="Send message"
        >
          {sending ? '…' : '↑'}
        </button>
      </div>
    </div>
  )
}
