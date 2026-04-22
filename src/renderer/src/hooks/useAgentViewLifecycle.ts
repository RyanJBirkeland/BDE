import { useEffect } from 'react'

interface UseAgentViewLifecycleParams {
  activeView: string
  activeId: string | null
  fetchAgents: () => void
  loadHistory: (agentId: string) => void
  setShowLaunchpad: (show: boolean) => void
  setShowScratchpadBanner: (show: boolean) => void
}

/**
 * Drives the Agents view's non-subscription lifecycle: polling the agent list
 * when the view is active, loading event history on selection change, and
 * wiring the launchpad shortcut. The live agent-events subscription is owned
 * by `useAppInitialization` so it survives panel-tab switches.
 */
export function useAgentViewLifecycle({
  activeView,
  activeId,
  fetchAgents,
  loadHistory,
  setShowLaunchpad,
  setShowScratchpadBanner
}: UseAgentViewLifecycleParams): void {
  useEffect(() => {
    if (activeView !== 'agents') return
    fetchAgents()
  }, [fetchAgents, activeView])

  useEffect(() => {
    if (activeId) {
      loadHistory(activeId)
    }
  }, [activeId, loadHistory])

  useEffect(() => {
    const handler = (): void => setShowLaunchpad(true)
    window.addEventListener('bde:open-spawn-modal', handler)
    return () => window.removeEventListener('bde:open-spawn-modal', handler)
  }, [setShowLaunchpad])

  useEffect(() => {
    window.api.settings.get('scratchpad.noticeDismissed').then((val) => {
      if (!val) {
        setShowScratchpadBanner(true)
      }
    })
  }, [setShowScratchpadBanner])
}
