import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useHealthCheckPolling } from '../useHealthCheck'

// Mock useVisibilityAwareInterval to prevent timer side-effects
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn()
}))

// Mock the healthCheck store
vi.mock('../../stores/healthCheck', () => {
  const setStuckTasks = vi.fn()

  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({ stuckTaskIds: [], dismissedIds: [], setStuckTasks, dismiss: vi.fn() })
  )
  ;(store as any).getState = () => ({ stuckTaskIds: [], dismissedIds: [], setStuckTasks, dismiss: vi.fn() })

  return { useHealthCheckStore: store }
})

describe('useHealthCheckPolling', () => {
  beforeEach(() => {
    vi.mocked(window.api.sprint.healthCheck).mockResolvedValue([])
  })

  it('calls healthCheck IPC on mount', async () => {
    renderHook(() => useHealthCheckPolling())

    await waitFor(() => {
      expect(window.api.sprint.healthCheck).toHaveBeenCalled()
    })
  })

  it('returns void (no return value)', () => {
    const { result } = renderHook(() => useHealthCheckPolling())
    expect(result.current).toBeUndefined()
  })

  it('handles healthCheck IPC error gracefully', async () => {
    vi.mocked(window.api.sprint.healthCheck).mockRejectedValue(new Error('network error'))

    expect(() => {
      renderHook(() => useHealthCheckPolling())
    }).not.toThrow()
  })
})
