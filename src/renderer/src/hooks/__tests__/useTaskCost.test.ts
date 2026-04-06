import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../../stores/costData', () => ({
  useCostDataStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      localAgents: [
        { id: 'agent-1', costUsd: 0.05 },
        { id: 'agent-2', costUsd: 1.23 }
      ]
    })
  )
}))

import { useTaskCost } from '../useTaskCost'

describe('useTaskCost', () => {
  it('returns null cost when agentRunId is null', () => {
    const { result } = renderHook(() => useTaskCost(null))
    expect(result.current.costUsd).toBeNull()
  })

  it('returns null cost when agentRunId is undefined', () => {
    const { result } = renderHook(() => useTaskCost(undefined))
    expect(result.current.costUsd).toBeNull()
  })

  it('returns cost for matching agent', () => {
    const { result } = renderHook(() => useTaskCost('agent-1'))
    expect(result.current.costUsd).toBe(0.05)
  })

  it('returns null cost when agent not found', () => {
    const { result } = renderHook(() => useTaskCost('agent-unknown'))
    expect(result.current.costUsd).toBeNull()
  })
})
