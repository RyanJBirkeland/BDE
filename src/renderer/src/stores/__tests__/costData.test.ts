import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AgentCostRecord } from '../../../../shared/types'
import { useCostDataStore } from '../costData'

const makeRecord = (id: string, costUsd: number | null): AgentCostRecord => ({
  id,
  model: 'claude-3-5-sonnet',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  costUsd,
  tokensIn: 1000,
  tokensOut: 500,
  cacheRead: null,
  cacheCreate: null,
  durationMs: 5000,
  numTurns: 3,
  taskTitle: `Task ${id}`,
  prUrl: null,
  repo: 'bde'
})

const initialState = {
  localAgents: [] as AgentCostRecord[],
  isFetching: false,
  totalCost: 0
}

describe('costData store', () => {
  beforeEach(() => {
    useCostDataStore.setState(initialState)
    vi.clearAllMocks()
    // Reset getAgentHistory mock from test-setup
    ;(
      window.api.cost as unknown as Record<string, ReturnType<typeof vi.fn>>
    ).getAgentHistory.mockResolvedValue([])
  })

  it('starts with empty localAgents, isFetching=false, totalCost=0', () => {
    const state = useCostDataStore.getState()
    expect(state.localAgents).toEqual([])
    expect(state.isFetching).toBe(false)
    expect(state.totalCost).toBe(0)
  })

  it('fetchLocalAgents loads agents and computes total cost', async () => {
    const records = [makeRecord('a1', 0.5), makeRecord('a2', 1.25)]
    ;(
      window.api.cost as unknown as Record<string, ReturnType<typeof vi.fn>>
    ).getAgentHistory.mockResolvedValue(records)

    await useCostDataStore.getState().fetchLocalAgents()

    const state = useCostDataStore.getState()
    expect(state.localAgents).toHaveLength(2)
    expect(state.totalCost).toBeCloseTo(1.75)
    expect(state.isFetching).toBe(false)
  })

  it('totalCost treats null costUsd as 0', async () => {
    const records = [makeRecord('a1', null), makeRecord('a2', 2.0)]
    ;(
      window.api.cost as unknown as Record<string, ReturnType<typeof vi.fn>>
    ).getAgentHistory.mockResolvedValue(records)

    await useCostDataStore.getState().fetchLocalAgents()

    expect(useCostDataStore.getState().totalCost).toBeCloseTo(2.0)
  })

  it('prevents concurrent fetches', async () => {
    const getAgentHistory = (window.api.cost as unknown as Record<string, ReturnType<typeof vi.fn>>)
      .getAgentHistory
    let resolveFirst!: (v: AgentCostRecord[]) => void
    getAgentHistory.mockReturnValueOnce(
      new Promise<AgentCostRecord[]>((res) => {
        resolveFirst = res
      })
    )

    // Start first fetch — don't await yet
    const firstFetch = useCostDataStore.getState().fetchLocalAgents()

    // Attempt second fetch while first is in flight
    await useCostDataStore.getState().fetchLocalAgents()

    // Only one call should have been made
    expect(getAgentHistory).toHaveBeenCalledTimes(1)

    resolveFirst([])
    await firstFetch
  })

  it('sets isFetching to false after error', async () => {
    ;(
      window.api.cost as unknown as Record<string, ReturnType<typeof vi.fn>>
    ).getAgentHistory.mockRejectedValue(new Error('fetch error'))

    await useCostDataStore.getState().fetchLocalAgents()

    expect(useCostDataStore.getState().isFetching).toBe(false)
  })

  it('handles errors gracefully without throwing', async () => {
    ;(
      window.api.cost as unknown as Record<string, ReturnType<typeof vi.fn>>
    ).getAgentHistory.mockRejectedValue(new Error('API down'))

    await expect(useCostDataStore.getState().fetchLocalAgents()).resolves.toBeUndefined()
  })
})
