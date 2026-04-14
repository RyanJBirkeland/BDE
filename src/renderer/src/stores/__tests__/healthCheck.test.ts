import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHealthCheckStore } from '../healthCheck'
import { useVisibleStuckTasks } from '../../hooks/useVisibleStuckTasks'
import { useSprintTasks } from '../sprintTasks'
import type { SprintTask } from '../../../../shared/types'
import { nowIso } from '../../../../shared/time'

vi.mock('../sprintTasks', () => {
  const { create } = require('zustand')
  const store = create(() => ({ tasks: [] as SprintTask[] }))
  return { useSprintTasks: store }
})

function makeTask(id: string, status: SprintTask['status'] = 'active'): SprintTask {
  return {
    id,
    title: `Task ${id}`,
    repo: 'bde',
    priority: 5,
    status,
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
    updated_at: nowIso(),
    created_at: nowIso()
  }
}

const initialState = {
  stuckTaskIds: [] as string[],
  dismissedIds: [] as string[]
}

describe('healthCheck store', () => {
  beforeEach(() => {
    useHealthCheckStore.setState(initialState)
  })

  it('starts with empty arrays', () => {
    const state = useHealthCheckStore.getState()
    expect(state.stuckTaskIds.length).toBe(0)
    expect(state.dismissedIds.length).toBe(0)
    expect(Array.isArray(state.stuckTaskIds)).toBe(true)
    expect(Array.isArray(state.dismissedIds)).toBe(true)
  })

  it('setStuckTasks populates stuckTaskIds', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1', 'task-2'])
    const ids = useHealthCheckStore.getState().stuckTaskIds
    expect(ids.includes('task-1')).toBe(true)
    expect(ids.includes('task-2')).toBe(true)
    expect(ids.length).toBe(2)
  })

  it('setStuckTasks replaces previous array', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1', 'task-2'])
    useHealthCheckStore.getState().setStuckTasks(['task-3'])
    const ids = useHealthCheckStore.getState().stuckTaskIds
    expect(ids.includes('task-1')).toBe(false)
    expect(ids.includes('task-3')).toBe(true)
    expect(ids.length).toBe(1)
  })

  it('setStuckTasks is a no-op when contents are identical (returns same state reference)', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1'])
    const stateBefore = useHealthCheckStore.getState()
    useHealthCheckStore.getState().setStuckTasks(['task-1'])
    const stateAfter = useHealthCheckStore.getState()
    // Same array reference means no re-render was triggered
    expect(stateAfter.stuckTaskIds).toBe(stateBefore.stuckTaskIds)
  })

  it('dismiss adds taskId to dismissedIds', () => {
    useHealthCheckStore.getState().dismiss('task-1')
    expect(useHealthCheckStore.getState().dismissedIds.includes('task-1')).toBe(true)
  })

  it('dismiss accumulates multiple dismissals', () => {
    useHealthCheckStore.getState().dismiss('task-1')
    useHealthCheckStore.getState().dismiss('task-2')
    const ids = useHealthCheckStore.getState().dismissedIds
    expect(ids.includes('task-1')).toBe(true)
    expect(ids.includes('task-2')).toBe(true)
  })

  it('clearDismissed empties the dismissedIds array', () => {
    useHealthCheckStore.getState().dismiss('task-1')
    useHealthCheckStore.getState().dismiss('task-2')
    useHealthCheckStore.getState().clearDismissed()
    expect(useHealthCheckStore.getState().dismissedIds.length).toBe(0)
  })

  it('clearDismissed does not affect stuckTaskIds', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1'])
    useHealthCheckStore.getState().dismiss('task-1')
    useHealthCheckStore.getState().clearDismissed()
    expect(useHealthCheckStore.getState().stuckTaskIds.includes('task-1')).toBe(true)
  })
})

describe('useVisibleStuckTasks', () => {
  beforeEach(() => {
    useHealthCheckStore.setState({ stuckTaskIds: [], dismissedIds: [] })
    ;(useSprintTasks as any).setState({ tasks: [] })
  })

  it('returns empty array when no tasks are stuck', () => {
    ;(useSprintTasks as any).setState({ tasks: [makeTask('task-1')] })
    const { result } = renderHook(() => useVisibleStuckTasks())
    expect(result.current.visibleStuckTasks).toHaveLength(0)
  })

  it('returns stuck tasks that are in the task list', () => {
    ;(useSprintTasks as any).setState({ tasks: [makeTask('task-1'), makeTask('task-2')] })
    useHealthCheckStore.setState({ stuckTaskIds: ['task-1'] })
    const { result } = renderHook(() => useVisibleStuckTasks())
    expect(result.current.visibleStuckTasks).toHaveLength(1)
    expect(result.current.visibleStuckTasks[0].id).toBe('task-1')
  })

  it('excludes dismissed tasks', () => {
    ;(useSprintTasks as any).setState({ tasks: [makeTask('task-1'), makeTask('task-2')] })
    useHealthCheckStore.setState({ stuckTaskIds: ['task-1', 'task-2'], dismissedIds: ['task-1'] })
    const { result } = renderHook(() => useVisibleStuckTasks())
    expect(result.current.visibleStuckTasks).toHaveLength(1)
    expect(result.current.visibleStuckTasks[0].id).toBe('task-2')
  })

  it('returns dismissTask function', () => {
    const { result } = renderHook(() => useVisibleStuckTasks())
    expect(typeof result.current.dismissTask).toBe('function')
  })
})
