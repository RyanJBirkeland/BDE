import { useEffect } from 'react'
import { useCostDataStore } from '../stores/costData'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { usePendingReviewStore } from '../stores/pendingReview'
import { useFilterPresets } from '../stores/filterPresets'
import { useKeybindingsStore } from '../stores/keybindings'
import { useAgentEventsStore } from '../stores/agentEvents'

/**
 * Handles app initialization — panel layout restoration, cost data loading,
 * pending review state, filter presets, keybindings, and the live
 * agent-events subscription. The agent-events subscription is established
 * here (rather than in AgentsView) so switching between panel tabs does not
 * drop events for running agents.
 */
export function useAppInitialization(): void {
  const fetchLocalAgents = useCostDataStore((s) => s.fetchLocalAgents)
  const loadLayout = usePanelLayoutStore((s) => s.loadSavedLayout)
  const restorePendingReview = usePendingReviewStore((s) => s.restoreFromStorage)
  const restoreFilterPresets = useFilterPresets((s) => s.restoreFromStorage)
  const initKeybindings = useKeybindingsStore((s) => s.init)
  const initAgentEvents = useAgentEventsStore((s) => s.init)

  useEffect(() => {
    fetchLocalAgents()
  }, [fetchLocalAgents])

  useEffect(() => {
    initKeybindings()
  }, [initKeybindings])

  useEffect(() => {
    loadLayout()
  }, [loadLayout])

  useEffect(() => {
    restorePendingReview()
  }, [restorePendingReview])

  useEffect(() => {
    restoreFilterPresets()
  }, [restoreFilterPresets])

  useEffect(() => {
    initAgentEvents()
  }, [initAgentEvents])
}
