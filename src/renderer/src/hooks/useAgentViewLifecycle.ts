import { useEffect } from 'react'

interface UseAgentViewLifecycleParams {
  activeView: string
  activeId: string | null
  fetchAgents: () => void
  loadHistory: (agentId: string) => Promise<void>
  setShowLaunchpad: (show: boolean) => void
  /**
   * Optional. V1 wires this to expose the scratchpad notice flag to the view.
   * V2 owns the read/dismiss pair via `useScratchpadNotice` and omits it.
   */
  setShowScratchpadBanner?: ((show: boolean) => void) | undefined
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
      loadHistory(activeId).catch((err) => console.error('Failed to load agent history:', err))
    }
  }, [activeId, loadHistory])

  useEffect(() => {
    const handler = (): void => setShowLaunchpad(true)
    window.addEventListener('fleet:open-spawn-modal', handler)
    return () => window.removeEventListener('fleet:open-spawn-modal', handler)
  }, [setShowLaunchpad])

  useEffect(() => {
    if (!setShowScratchpadBanner) return
    window.api.settings
      .get('scratchpad.noticeDismissed')
      .then((val) => {
        if (!val) setShowScratchpadBanner(true)
      })
      .catch((err) => console.error('Failed to get scratchpad setting:', err))
  }, [setShowScratchpadBanner])
}
