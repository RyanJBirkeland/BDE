import { useCallback, useEffect, useState } from 'react'
import { useCostDataStore } from '../stores/costData'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { usePendingReviewStore } from '../stores/pendingReview'
import { useFilterPresets } from '../stores/filterPresets'
import { useKeybindingsStore } from '../stores/keybindings'
import { useAgentEventsStore } from '../stores/agentEvents'
import { useTaskWorkbenchStore } from '../stores/taskWorkbench'

const PENDING_FIRST_TASK_KEY = 'fleet:pending-first-task'

interface PendingFirstTask {
  title: string
  spec: string
  repo: string
  specType: string
}

function isPendingFirstTask(value: unknown): value is PendingFirstTask {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.spec === 'string' &&
    typeof candidate.repo === 'string' &&
    typeof candidate.specType === 'string'
  )
}

/**
 * Hydrates the Task Workbench from a payload an upstream onboarding flow may
 * have stashed in localStorage, then navigates to the planner so the user lands
 * inside the spec they were drafting.
 */
function consumePendingFirstTask(): void {
  const raw = localStorage.getItem(PENDING_FIRST_TASK_KEY)
  if (!raw) return
  try {
    const parsed: unknown = JSON.parse(raw)
    localStorage.removeItem(PENDING_FIRST_TASK_KEY)
    if (!isPendingFirstTask(parsed)) {
      console.warn('Discarding malformed fleet:pending-first-task payload')
      return
    }
    const wb = useTaskWorkbenchStore.getState()
    wb.setTitle(parsed.title)
    wb.setSpec(parsed.spec)
    wb.setRepo(parsed.repo)
    wb.setSpecType(parsed.specType as Parameters<typeof wb.setSpecType>[0])
    usePanelLayoutStore.getState().setView('planner')
  } catch {
    localStorage.removeItem(PENDING_FIRST_TASK_KEY)
  }
}

export interface AppInitialization {
  featureGuideOpen: boolean
  closeFeatureGuide: () => void
}

/**
 * Handles app initialization — panel layout restoration, cost data loading,
 * pending review state, filter presets, keybindings, the live agent-events
 * subscription, the feature-guide modal opener, and one-shot hydration of any
 * pending first task. The agent-events subscription is established here
 * (rather than in AgentsView) so switching between panel tabs does not drop
 * events for running agents.
 *
 * Returns the feature-guide modal's open state and a stable closer so App.tsx
 * can render the modal without owning the underlying event wiring.
 */
export function useAppInitialization(): AppInitialization {
  const fetchLocalAgents = useCostDataStore((s) => s.fetchLocalAgents)
  const loadLayout = usePanelLayoutStore((s) => s.loadSavedLayout)
  const restorePendingReview = usePendingReviewStore((s) => s.restoreFromStorage)
  const restoreFilterPresets = useFilterPresets((s) => s.restoreFromStorage)
  const initKeybindings = useKeybindingsStore((s) => s.init)
  const initAgentEvents = useAgentEventsStore((s) => s.init)

  const [featureGuideOpen, setFeatureGuideOpen] = useState(false)
  const closeFeatureGuide = useCallback(() => setFeatureGuideOpen(false), [])

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

  useEffect(() => {
    consumePendingFirstTask()
  }, [])

  useEffect(() => {
    const openFeatureGuide = (): void => setFeatureGuideOpen(true)
    window.addEventListener('fleet:open-feature-guide', openFeatureGuide)
    return () => window.removeEventListener('fleet:open-feature-guide', openFeatureGuide)
  }, [])

  return { featureGuideOpen, closeFeatureGuide }
}
