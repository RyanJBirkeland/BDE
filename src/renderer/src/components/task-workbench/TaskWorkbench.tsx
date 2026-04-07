import { useCallback, useRef, useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { X, Sparkles } from 'lucide-react'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { WorkbenchForm } from './WorkbenchForm'
import { WorkbenchCopilot } from './WorkbenchCopilot'
import '../../assets/task-workbench-neon.css'

const COPILOT_HINT_SEEN_KEY = 'bde:copilot-hint-seen'

function shouldShowHint(): boolean {
  try {
    return !localStorage.getItem(COPILOT_HINT_SEEN_KEY)
  } catch {
    return false
  }
}

export function TaskWorkbench(): React.JSX.Element {
  const copilotVisible = useTaskWorkbenchStore((s) => s.copilotVisible)
  const toggleCopilot = useTaskWorkbenchStore((s) => s.toggleCopilot)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showHint, setShowHint] = useState(shouldShowHint)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      const store = useTaskWorkbenchStore.getState()
      if (width < 600 && store.copilotVisible) {
        store.toggleCopilot()
      }
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const addMessage = useTaskWorkbenchStore((s) => s.addCopilotMessage)
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)

  const dismissHint = useCallback(() => {
    setShowHint(false)
    try {
      localStorage.setItem(COPILOT_HINT_SEEN_KEY, 'true')
    } catch {
      // Ignore localStorage errors
    }
  }, [])

  const handleSendFromForm = useCallback(
    async (text: string) => {
      // If copilot is hidden, show it so the streaming listener is mounted
      if (!useTaskWorkbenchStore.getState().copilotVisible) {
        toggleCopilot()
      }

      // Add user message
      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        content: text,
        timestamp: Date.now()
      }
      addMessage(userMsg)

      // Create empty assistant message and start streaming state
      const msgId = `assistant-${Date.now()}`
      addMessage({
        id: msgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        insertable: true
      })
      useTaskWorkbenchStore.getState().startStreaming(msgId, '') // placeholder streamId

      try {
        await window.api.workbench.chatStream({
          messages: [{ role: 'user', content: text }],
          formContext: { title, repo, spec }
        })
        // Real streamId is set by the WorkbenchCopilot chunk listener
      } catch {
        useTaskWorkbenchStore.setState((s) => ({
          copilotMessages: s.copilotMessages.map((m) =>
            m.id === msgId
              ? { ...m, content: 'Failed to reach Claude. Check your connection and try again.' }
              : m
          ),
          copilotLoading: false,
          streamingMessageId: null,
          activeStreamId: null
        }))
      }
    },
    [title, repo, spec, toggleCopilot, addMessage]
  )

  return (
    <div ref={containerRef} className="wb">
      {/* Toggle copilot button when hidden */}
      {!copilotVisible && (
        <div className="wb__copilot-toggle">
          <button onClick={toggleCopilot}>AI Copilot</button>
          {showHint && (
            <div className="wb__copilot-hint">
              <div className="wb__copilot-hint-content">
                <Sparkles size={16} className="wb__copilot-hint-icon" />
                <div className="wb__copilot-hint-text">
                  <strong>Need help writing your task spec?</strong>
                  <p>The AI Copilot can research your codebase and suggest approaches.</p>
                </div>
                <button
                  className="wb__copilot-hint-close"
                  onClick={dismissHint}
                  aria-label="Dismiss hint"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="wb__copilot-hint-arrow" />
            </div>
          )}
        </div>
      )}

      <Group orientation="horizontal" style={{ flex: 1 }}>
        <Panel defaultSize={copilotVisible ? 65 : 100} minSize={40}>
          <WorkbenchForm onSendCopilotMessage={handleSendFromForm} />
        </Panel>

        {copilotVisible && (
          <>
            <Separator className="wb__separator" />
            <Panel defaultSize={35} minSize={20}>
              <WorkbenchCopilot onClose={toggleCopilot} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  )
}
