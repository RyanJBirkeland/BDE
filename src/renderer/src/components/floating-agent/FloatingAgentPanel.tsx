import { useEffect, useRef, useState } from 'react'
import { useFloatingAgentStore } from '../../stores/floatingAgent'
import { FloatingAgentMessage } from './FloatingAgentMessage'
import type { AgentEvent } from '../../../../shared/types'

interface Props {
  onClose: () => void
}

export function FloatingAgentPanel({ onClose }: Props): React.JSX.Element {
  const { messages, estimatedTokens, agentId, isSending } = useFloatingAgentStore()
  const [input, setInput] = useState('')
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
          useFloatingAgentStore.getState().setIsSending(false)
        }
      }
    )
    return unsubscribe
  }, [agentId])

  const spawnNewSession = async (text: string): Promise<void> => {
    const store = useFloatingAgentStore.getState()

    const repoPaths = await window.api.git.getRepoPaths()
    const repoPath = Object.values(repoPaths)[0]

    if (!repoPath) {
      store.addMessage({
        role: 'assistant',
        content:
          'Please configure a repository in Settings → Repositories before using the FLEET Advisor.'
      })
      store.setIsSending(false)
      return
    }

    const sessionId = `fleet-floating-${crypto.randomUUID()}`
    store.setSessionId(sessionId)

    const result = await window.api.agents.spawnLocal({ task: text, repoPath, assistant: true })
    store.setAgentId(result.id)
    // isSending cleared by agent:completed / agent:error event
  }

  const handleSend = async (): Promise<void> => {
    if (!input.trim() || isSending) return
    const text = input.trim()
    setInput('')

    const store = useFloatingAgentStore.getState()
    store.setIsSending(true)
    store.addMessage({ role: 'user', content: text })

    try {
      if (store.agentId) {
        const result = await window.api.agents.steer(store.agentId, text)
        if (!result.ok) {
          // Agent process is gone — clear the stale ID and spawn fresh
          store.setAgentId(null)
          await spawnNewSession(text)
        }
        // isSending cleared by event listener on agent:completed
      } else {
        await spawnNewSession(text)
      }
    } catch (err) {
      store.addMessage({
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to reach agent'}`
      })
      store.setIsSending(false)
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
  }

  // ⌘. resets the session while the panel is mounted
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key === '.') handleNewChat()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <div className="fa-panel" role="complementary" aria-label="FLEET Advisor">
      <div className="fa-panel__header">
        <span className="fa-panel__title">FLEET Advisor</span>
        <div className="fa-panel__header-right">
          <span
            className="fa-panel__token-bar"
            aria-hidden="true"
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
            Ask about your sprint, pipeline health, agent errors, or anything FLEET-related.
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
          placeholder="Ask FLEET Advisor..."
          rows={2}
          disabled={isSending}
          aria-label="Message FLEET Advisor"
        />
        <button
          className="fa-panel__send"
          onClick={() => void handleSend()}
          disabled={isSending || !input.trim()}
          aria-label="Send message"
        >
          {isSending ? '…' : '↑'}
        </button>
      </div>
    </div>
  )
}
