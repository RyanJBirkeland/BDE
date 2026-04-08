import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mutable state for dynamic per-test control
let mockTasks: unknown[] = []
let mockLocalAgents: unknown[] = []
let mockLoadData: unknown = null
let mockSuccessTrendData: unknown[] = []

vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: unknown) => unknown) => sel({ tasks: mockTasks }))
}))

vi.mock('../../stores/costData', () => ({
  useCostDataStore: vi.fn((sel: (s: unknown) => unknown) => sel({ localAgents: mockLocalAgents }))
}))

vi.mock('../../stores/dashboardData', () => ({
  useDashboardDataStore: vi.fn((sel: (s: unknown) => unknown) =>
    sel({ loadData: mockLoadData, successTrendData: mockSuccessTrendData })
  )
}))

// Mock useVisibilityAwareInterval to prevent timer side-effects
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn()
}))

import { useDashboardMetrics } from '../useDashboardMetrics'

describe('useDashboardMetrics — stuckCount', () => {
  beforeEach(() => {
    mockTasks = []
    mockLocalAgents = []
    mockLoadData = null
    mockSuccessTrendData = []
  })

  it('flags an active task as stuck when (now - started_at) > DEFAULT_STUCK_MS', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString()
    mockTasks = [{ id: 't1', status: 'active', started_at: twoHoursAgo, max_runtime_ms: null }]
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.stuckCount).toBe(1)
  })

  it('respects per-task max_runtime_ms when set', () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString()
    mockTasks = [
      { id: 't1', status: 'active', started_at: thirtyMinAgo, max_runtime_ms: 10 * 60_000 }
    ]
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.stuckCount).toBe(1)
  })

  it('uses DEFAULT_STUCK_MS (1h) as fallback when max_runtime_ms is null', () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString()
    mockTasks = [{ id: 't1', status: 'active', started_at: thirtyMinAgo, max_runtime_ms: null }]
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.stuckCount).toBe(0)
  })

  it('handles null started_at gracefully (not stuck)', () => {
    mockTasks = [{ id: 't1', status: 'active', started_at: null, max_runtime_ms: null }]
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.stuckCount).toBe(0)
  })

  it('does not count non-active tasks', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString()
    mockTasks = [
      { id: 't1', status: 'queued', started_at: twoHoursAgo, max_runtime_ms: null },
      { id: 't2', status: 'done', started_at: twoHoursAgo, max_runtime_ms: null }
    ]
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.stuckCount).toBe(0)
  })
})

describe('useDashboardMetrics — loadSaturated', () => {
  beforeEach(() => {
    mockTasks = []
    mockLocalAgents = []
    mockSuccessTrendData = []
  })

  it('returns null when loadData is null', () => {
    mockLoadData = null
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.loadSaturated).toBeNull()
  })

  it('returns null when load1 < 2 × cpuCount', () => {
    mockLoadData = { samples: [{ t: 1, load1: 10, load5: 10, load15: 10 }], cpuCount: 8 }
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.loadSaturated).toBeNull()
  })

  it('returns populated object when load1 >= 2 × cpuCount', () => {
    mockLoadData = { samples: [{ t: 1, load1: 20, load5: 15, load15: 10 }], cpuCount: 8 }
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.loadSaturated).toEqual({ load1: 20, cpuCount: 8 })
  })

  it('uses the most recent sample', () => {
    mockLoadData = {
      samples: [
        { t: 1, load1: 5, load5: 5, load15: 5 }, // healthy
        { t: 2, load1: 20, load5: 10, load15: 5 } // saturated (latest)
      ],
      cpuCount: 8
    }
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.loadSaturated).toEqual({ load1: 20, cpuCount: 8 })
  })
})

describe('useDashboardMetrics — successRate 7d avg + delta', () => {
  beforeEach(() => {
    mockTasks = []
    mockLocalAgents = []
    mockLoadData = null
  })

  it('computes 7d average from non-null days', () => {
    mockSuccessTrendData = [
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-03-${String(25 + i).padStart(2, '0')}`,
        successRate: 94,
        doneCount: 10,
        failedCount: 1
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        date: `2026-04-${String(1 + i).padStart(2, '0')}`,
        successRate: 98,
        doneCount: 10,
        failedCount: 1
      }))
    ]
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.successRate7dAvg).toBeCloseTo(98)
    expect(result.current.successRateWeekDelta).toBeCloseTo(4)
  })

  it('returns null avg + delta when no non-null days', () => {
    mockSuccessTrendData = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      successRate: null,
      doneCount: 0,
      failedCount: 0
    }))
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.successRate7dAvg).toBeNull()
    expect(result.current.successRateWeekDelta).toBeNull()
  })

  it('returns null delta when either window is empty', () => {
    mockSuccessTrendData = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      successRate: 100,
      doneCount: 10,
      failedCount: 0
    }))
    const { result } = renderHook(() => useDashboardMetrics())
    expect(result.current.successRate7dAvg).toBe(100)
    expect(result.current.successRateWeekDelta).toBeNull()
  })
})
