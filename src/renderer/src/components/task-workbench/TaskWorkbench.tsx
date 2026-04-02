import { useCallback, useRef, useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { WorkbenchForm } from './WorkbenchForm'
import { WorkbenchCopilot } from './WorkbenchCopilot'
import '../../assets/task-workbench-neon.css'

export function TaskWorkbench() {
  const copilotVisible = useTaskWorkbenchStore((s) => s.copilotVisible)
  const toggleCopilot = useTaskWorkbenchStore((s) => s.toggleCopilot)
  const containerRef = useRef<HTMLDivElement>(null)

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
  const setCopilotLoading = useTaskWorkbenchStore((s) => s.setCopilotLoading)
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)

  const handleSendFromForm = useCallback(
    async (text: string) => {
      // If copilot is hidden, show it
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
      setCopilotLoading(true)

      try {
        const result = await window.api.workbench.chat({
          messages: [{ role: 'user', content: text }],
          formContext: { title, repo, spec }
        })
        addMessage({
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
          insertable: true
        })
      } catch {
        addMessage({
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Failed to reach Claude. Check your connection and try again.',
          timestamp: Date.now()
        })
      } finally {
        setCopilotLoading(false)
      }
    },
    [title, repo, spec, toggleCopilot, addMessage, setCopilotLoading]
  )

  return (
    <div ref={containerRef} className="wb">
      {/* Toggle copilot button when hidden */}
      {!copilotVisible && (
        <div className="wb__copilot-toggle">
          <button onClick={toggleCopilot}>AI Copilot</button>
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
