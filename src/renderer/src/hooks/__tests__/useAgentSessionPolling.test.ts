import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAgentSessionPolling } from '../useAgentSessionPolling'

// Mock useVisibilityAwareInterval to prevent timer side-effects
const mockUseVisibilityAwareInterval = vi.fn()
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: (...args: unknown[]) => mockUseVisibilityAwareInterval(...args)
}))

// Mock the agentHistory store
const mockFetchAgents = vi.fn().mockResolvedValue(undefined)

vi.mock('../../stores/agentHistory', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) => sel({ fetchAgents: mockFetchAgents }))
  ;(store as any).getState = () => ({ fetchAgents: mockFetchAgents })
  return { useAgentHistoryStore: store }
})

describe('useAgentSessionPolling', () => {
  beforeEach(() => {
    mockFetchAgents.mockClear()
    mockUseVisibilityAwareInterval.mockClear()
  })

  it('renders without error', () => {
    expect(() => {
      renderHook(() => useAgentSessionPolling())
    }).not.toThrow()
  })

  it('calls fetchAgents on mount', () => {
    renderHook(() => useAgentSessionPolling())
    expect(mockFetchAgents).toHaveBeenCalledTimes(1)
  })

  it('registers useVisibilityAwareInterval with fetchAgents and POLL_SESSIONS_INTERVAL', () => {
    renderHook(() => useAgentSessionPolling())
    expect(mockUseVisibilityAwareInterval).toHaveBeenCalledWith(mockFetchAgents, 10_000)
  })
})
