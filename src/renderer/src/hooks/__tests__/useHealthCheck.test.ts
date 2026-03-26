import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHealthCheck } from '../useHealthCheck'
import type { SprintTask } from '../../../../shared/types'

// Mock useVisibilityAwareInterval to prevent timer side-effects
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn()
}))

// Mock the healthCheck store
vi.mock('../../stores/healthCheck', () => {
  let stuckTaskIds: string[] = []
  const dismissedIds: string[] = []
  const setStuckTasks = vi.fn((ids: string[]) => {
    stuckTaskIds = [...ids]
  })
  const dismiss = vi.fn()

  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({ stuckTaskIds, dismissedIds, setStuckTasks, dismiss })
  )
  ;(store as any).getState = () => ({ stuckTaskIds, dismissedIds, setStuckTasks, dismiss })

  return { useHealthCheckStore: store }
})

function makeTask(id: string): SprintTask {
  return {
    id,
    title: `Task ${id}`,
    repo: 'bde',
    priority: 5,
    status: 'active',
    notes: null,
    spec: null,
    prompt: null,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_mergeable_state: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    retry_count: 0,
    fast_fail_count: 0,
    template_name: null,
    depends_on: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  }
}

describe('useHealthCheck', () => {
  beforeEach(() => {
    vi.mocked(window.api.sprint.healthCheck).mockResolvedValue([])
  })

  it('renders without error and calls healthCheck IPC on mount', async () => {
    const tasks = [makeTask('task-1'), makeTask('task-2')]
    const { result } = renderHook(() => useHealthCheck(tasks))

    await waitFor(() => {
      expect(window.api.sprint.healthCheck).toHaveBeenCalled()
    })

    expect(result.current).toHaveProperty('visibleStuckTasks')
    expect(result.current).toHaveProperty('dismissTask')
  })

  it('returns empty visibleStuckTasks when no tasks are stuck', async () => {
    vi.mocked(window.api.sprint.healthCheck).mockResolvedValue([])
    const tasks = [makeTask('task-1')]

    const { result } = renderHook(() => useHealthCheck(tasks))

    await waitFor(() => {
      expect(window.api.sprint.healthCheck).toHaveBeenCalled()
    })

    expect(result.current.visibleStuckTasks).toHaveLength(0)
  })

  it('returns dismissTask function', () => {
    const { result } = renderHook(() => useHealthCheck([]))
    expect(typeof result.current.dismissTask).toBe('function')
  })

  it('handles healthCheck IPC error gracefully', async () => {
    vi.mocked(window.api.sprint.healthCheck).mockRejectedValue(new Error('network error'))

    expect(() => {
      renderHook(() => useHealthCheck([]))
    }).not.toThrow()
  })
})
