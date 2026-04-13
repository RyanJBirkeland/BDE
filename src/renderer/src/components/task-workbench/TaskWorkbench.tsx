import { useCallback, useRef, useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { useCopilotStore } from '../../stores/copilot'
import { WorkbenchForm } from './WorkbenchForm'
import { WorkbenchCopilot } from './WorkbenchCopilot'
import { CopilotDiscoveryPopover } from './CopilotDiscoveryPopover'
import './TaskWorkbench.css'

const COPILOT_POPOVER_SEEN_KEY = 'bde:workbench-copilot-popover-seen'

export function TaskWorkbench(): React.JSX.Element {
  const copilotVisible = useCopilotStore((s) => s.visible)
  const toggleCopilot = useCopilotStore((s) => s.toggleVisible)
  const containerRef = useRef<HTMLDivElement>(null)

  // First-run discoverability popover for the AI Copilot toggle.
  // Initialized from localStorage so SSR/hydration isn't a concern.
  const [showCopilotPopover, setShowCopilotPopover] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(COPILOT_POPOVER_SEEN_KEY) == null
  })

  const dismissCopilotPopover = useCallback(() => {
    window.localStorage.setItem(COPILOT_POPOVER_SEEN_KEY, '1')
    setShowCopilotPopover(false)
  }, [])

  // The popover lives next to the "AI Copilot" toggle button. When the user
  // clicks that button we want to both open the copilot AND persist the seen
  // flag so the popover doesn't reappear on the next visit.
  const handleOpenCopilotFromToggle = useCallback(() => {
    dismissCopilotPopover()
    toggleCopilot()
  }, [dismissCopilotPopover, toggleCopilot])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      const copilot = useCopilotStore.getState()
      if (width < 600 && copilot.visible) {
        copilot.toggleVisible()
      }
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const addMessage = useCopilotStore((s) => s.addMessage)
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)

  const handleSendFromForm = useCallback(
    async (text: string) => {
      // If copilot is hidden, show it so the streaming listener is mounted
      if (!useCopilotStore.getState().visible) {
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
      useCopilotStore.getState().startStreaming(msgId, '') // placeholder streamId

      try {
        await window.api.workbench.chatStream({
          messages: [{ role: 'user', content: text }],
          formContext: { title, repo, spec }
        })
        // Real streamId is set by the WorkbenchCopilot chunk listener
      } catch {
        useCopilotStore.setState((s) => ({
          messages: s.messages.map((m) =>
            m.id === msgId
              ? { ...m, content: 'Failed to reach Claude. Check your connection and try again.' }
              : m
          ),
          loading: false,
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
          <button onClick={handleOpenCopilotFromToggle}>AI Copilot</button>
          {showCopilotPopover && <CopilotDiscoveryPopover onDismiss={dismissCopilotPopover} />}
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
