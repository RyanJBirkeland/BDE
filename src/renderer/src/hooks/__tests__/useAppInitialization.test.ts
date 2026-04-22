import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockFetchLocalAgents = vi.fn().mockResolvedValue(undefined)
const mockLoadLayout = vi.fn().mockResolvedValue(undefined)
const mockRestorePendingReview = vi.fn()
const mockRestoreFilterPresets = vi.fn()
const mockInitKeybindings = vi.fn()
const mockInitAgentEvents = vi.fn().mockReturnValue(() => {})

vi.mock('../../stores/costData', () => ({
  useCostDataStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ fetchLocalAgents: mockFetchLocalAgents })),
    { getState: () => ({ fetchLocalAgents: mockFetchLocalAgents }) }
  )
}))
vi.mock('../../stores/panelLayout', () => ({
  usePanelLayoutStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ loadSavedLayout: mockLoadLayout })),
    { getState: () => ({ loadSavedLayout: mockLoadLayout }) }
  )
}))
vi.mock('../../stores/pendingReview', () => ({
  usePendingReviewStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ restoreFromStorage: mockRestorePendingReview })),
    { getState: () => ({ restoreFromStorage: mockRestorePendingReview }) }
  )
}))
vi.mock('../../stores/filterPresets', () => ({
  useFilterPresets: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ restoreFromStorage: mockRestoreFilterPresets })),
    { getState: () => ({ restoreFromStorage: mockRestoreFilterPresets }) }
  )
}))
vi.mock('../../stores/keybindings', () => ({
  useKeybindingsStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ init: mockInitKeybindings })),
    { getState: () => ({ init: mockInitKeybindings }) }
  )
}))
vi.mock('../../stores/agentEvents', () => ({
  useAgentEventsStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ init: mockInitAgentEvents })),
    { getState: () => ({ init: mockInitAgentEvents }) }
  )
}))

import { useAppInitialization } from '../useAppInitialization'

describe('useAppInitialization', () => {
  beforeEach(() => {
    mockFetchLocalAgents.mockClear()
    mockLoadLayout.mockClear()
    mockRestorePendingReview.mockClear()
    mockRestoreFilterPresets.mockClear()
    mockInitKeybindings.mockClear()
    mockInitAgentEvents.mockClear()
  })

  it('subscribes the agent-events store on mount', () => {
    renderHook(() => useAppInitialization())
    expect(mockInitAgentEvents).toHaveBeenCalledTimes(1)
  })

  it('does not tear down the agent-events subscription on unmount', () => {
    const teardown = vi.fn()
    mockInitAgentEvents.mockReturnValueOnce(teardown)
    const { unmount } = renderHook(() => useAppInitialization())
    unmount()
    expect(teardown).not.toHaveBeenCalled()
  })
})
