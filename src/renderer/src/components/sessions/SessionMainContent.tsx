/**
 * SessionMainContent — the main content area of the sessions view.
 * Renders log viewers for history/local agents, or the chat UI
 * depending on the current split mode and selection state.
 */
import { useState, useCallback } from 'react'
import type { SplitMode } from '../../stores/splitLayout'
import { useSplitLayoutStore } from '../../stores/splitLayout'
import type { AgentSession, SubAgent } from '../../stores/sessions'
import { AgentLogViewer, LocalAgentLogViewer } from './LocalAgentLogViewer'
import { ChatPane } from './ChatPane'
import { MiniChatPane } from './MiniChatPane'
import { SessionHeader } from './SessionHeader'
import { ChatThread } from './ChatThread'
import { MessageInput } from './MessageInput'
import { EmptyState } from '../ui/EmptyState'

interface SessionMainContentProps {
  selectedHistoryId: string | null
  selectedLocalAgentPid: number | null
  splitMode: SplitMode
  selectedKey: string | null
  selectedSession: AgentSession | null
  selectedSubAgent: SubAgent | null
  selectedUnifiedId: string | null
  sessionMode: 'chat' | 'steer' | 'local'
  localSendPid: number | undefined
}

export function SessionMainContent({
  selectedHistoryId,
  selectedLocalAgentPid,
  splitMode,
  selectedKey,
  selectedSession,
  selectedSubAgent,
  selectedUnifiedId,
  sessionMode,
  localSendPid
}: SessionMainContentProps): React.JSX.Element {
  const splitPanes = useSplitLayoutStore((s) => s.splitPanes)
  const focusedPaneIndex = useSplitLayoutStore((s) => s.focusedPaneIndex)
  const setFocusedPane = useSplitLayoutStore((s) => s.setFocusedPane)
  const setPaneSession = useSplitLayoutStore((s) => s.setPaneSession)

  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [optimisticMessages, setOptimisticMessages] = useState<{ role: 'user'; content: string }[]>([])

  const onBeforeSend = useCallback((message: string) => {
    setOptimisticMessages([{ role: 'user', content: message }])
  }, [])

  const onSent = useCallback(() => {
    setOptimisticMessages([])
    setRefreshTrigger((n) => n + 1)
  }, [])

  const onSendError = useCallback(() => {
    setOptimisticMessages([])
  }, [])

  // If a history or local agent is selected, always show that regardless of split mode
  if (selectedHistoryId) {
    return <AgentLogViewer agentId={selectedHistoryId} />
  }
  if (selectedLocalAgentPid) {
    return <LocalAgentLogViewer pid={selectedLocalAgentPid} />
  }

  if (splitMode === '2-pane') {
    return (
      <div className="sessions-2pane">
        <div className="sessions-2pane__pane">
          <ChatPane
            paneIndex={0}
            sessionKey={splitPanes[0]}
            isFocused={focusedPaneIndex === 0}
            onFocus={() => setFocusedPane(0)}
            onSessionChange={(key) => setPaneSession(0, key)}
          />
        </div>
        <div className="sessions-2pane__handle" />
        <div className="sessions-2pane__pane">
          <ChatPane
            paneIndex={1}
            sessionKey={splitPanes[1]}
            isFocused={focusedPaneIndex === 1}
            onFocus={() => setFocusedPane(1)}
            onSessionChange={(key) => setPaneSession(1, key)}
          />
        </div>
      </div>
    )
  }

  if (splitMode === 'grid-4') {
    return (
      <div className="sessions-grid4">
        {([0, 1, 2, 3] as const).map((i) => (
          <MiniChatPane
            key={i}
            paneIndex={i}
            sessionKey={splitPanes[i]}
            isFocused={focusedPaneIndex === i}
            onFocus={() => setFocusedPane(i)}
            onSessionChange={(key) => setPaneSession(i, key)}
          />
        ))}
      </div>
    )
  }

  // single mode — original layout
  if (selectedKey && (selectedSession || selectedSubAgent)) {
    return (
      <>
        <SessionHeader session={selectedSession ?? null} subAgent={selectedSubAgent} />
        <div className="sessions-chat__thread">
          <ChatThread
            sessionKey={selectedKey}
            updatedAt={selectedSession?.updatedAt ?? selectedSubAgent?.startedAt ?? 0}
            refreshTrigger={refreshTrigger}
            optimisticMessages={optimisticMessages}
          />
        </div>
        {selectedUnifiedId?.startsWith('history:') ? null : (
          <div className="sessions-chat__input">
            <MessageInput sessionKey={selectedKey} sessionMode={sessionMode} localPid={localSendPid} onSent={onSent} onBeforeSend={onBeforeSend} onSendError={onSendError} />
          </div>
        )}
      </>
    )
  }

  return (
    <EmptyState
      title="Select a session"
      description="Choose a session from the list to start chatting"
    />
  )
}
