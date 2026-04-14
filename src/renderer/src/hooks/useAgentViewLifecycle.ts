import { useEffect, useRef } from 'react'

interface UseAgentViewLifecycleParams {
  activeView: string
  activeId: string | null
  initEvents: () => () => void
  fetchAgents: () => void
  loadHistory: (agentId: string) => void
  setShowLaunchpad: (show: boolean) => void
  setShowScratchpadBanner: (show: boolean) => void
}

export function useAgentViewLifecycle({
  activeView,
  activeId,
  initEvents,
  fetchAgents,
  loadHistory,
  setShowLaunchpad,
  setShowScratchpadBanner
}: UseAgentViewLifecycleParams): void {
  const cleanupRef = useRef<(() => void) | null>(null)

  // Initialize agent event listener once
  useEffect(() => {
    cleanupRef.current = initEvents()
    return () => cleanupRef.current?.()
  }, [initEvents])

  // Fetch agent history when view becomes active
  useEffect(() => {
    if (activeView !== 'agents') return
    fetchAgents()
  }, [fetchAgents, activeView])

  // Load event history when selection changes
  useEffect(() => {
    if (activeId) {
      loadHistory(activeId)
    }
  }, [activeId, loadHistory])

  // Listen for spawn modal trigger from CommandPalette
  useEffect(() => {
    const handler = (): void => setShowLaunchpad(true)
    window.addEventListener('bde:open-spawn-modal', handler)
    return () => window.removeEventListener('bde:open-spawn-modal', handler)
  }, [setShowLaunchpad])

  // Check if scratchpad banner has been dismissed
  useEffect(() => {
    window.api.settings.get('scratchpad.noticeDismissed').then((val) => {
      if (!val) {
        setShowScratchpadBanner(true)
      }
    })
  }, [setShowScratchpadBanner])
}
