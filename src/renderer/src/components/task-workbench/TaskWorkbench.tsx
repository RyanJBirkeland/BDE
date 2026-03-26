import { useCallback, useRef, useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useTaskWorkbenchStore } from '../../stores/taskWorkbench'
import { WorkbenchForm } from './WorkbenchForm'
import { WorkbenchCopilot } from './WorkbenchCopilot'
import { tokens } from '../../design-system/tokens'

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
    <div
      ref={containerRef}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}
    >
      {/* Toggle copilot button when hidden */}
      {!copilotVisible && (
        <div
          style={{
            position: 'absolute',
            top: tokens.space[3],
            right: tokens.space[3],
            zIndex: 10
          }}
        >
          <button
            onClick={toggleCopilot}
            style={{
              background: tokens.color.accentDim,
              border: `1px solid ${tokens.color.accent}`,
              borderRadius: tokens.radius.md,
              color: tokens.color.accent,
              padding: `${tokens.space[1]} ${tokens.space[3]}`,
              fontSize: tokens.size.sm,
              cursor: 'pointer'
            }}
          >
            AI Copilot
          </button>
        </div>
      )}

      <Group orientation="horizontal" style={{ flex: 1 }}>
        <Panel defaultSize={copilotVisible ? 65 : 100} minSize={40}>
          <WorkbenchForm onSendCopilotMessage={handleSendFromForm} />
        </Panel>

        {copilotVisible && (
          <>
            <Separator
              style={{
                width: 1,
                background: tokens.color.border,
                cursor: 'col-resize'
              }}
            />
            <Panel defaultSize={35} minSize={20}>
              <WorkbenchCopilot onClose={toggleCopilot} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  )
}
