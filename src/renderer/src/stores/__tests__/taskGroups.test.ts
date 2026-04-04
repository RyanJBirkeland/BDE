import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TaskGroup, SprintTask } from '../../../../shared/types'

// Mock the toasts module before importing the store
vi.mock('../toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    undoable: vi.fn()
  }
}))

import { useTaskGroups } from '../taskGroups'
import { toast } from '../toasts'

const makeGroup = (id: string, overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id,
  name: `Group ${id}`,
  icon: '📁',
  accent_color: '#00ff00',
  goal: null,
  status: 'draft',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides
})

const makeTask = (id: string, overrides: Partial<SprintTask> = {}): SprintTask => ({
  id,
  title: `Task ${id}`,
  repo: 'bde',
  prompt: null,
  priority: 1,
  status: 'backlog',
  notes: null,
  spec: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_mergeable_state: null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides
})

const initialState = {
  groups: [] as TaskGroup[],
  selectedGroupId: null as string | null,
  groupTasks: [] as SprintTask[],
  loading: false
}

describe('taskGroups store', () => {
  beforeEach(() => {
    useTaskGroups.setState(initialState)
    vi.clearAllMocks()
    // Reset mocks on window.api.groups
    const groups = window.api.groups as unknown as Record<string, ReturnType<typeof vi.fn>>
    groups.list.mockResolvedValue([])
    groups.create.mockResolvedValue({})
    groups.update.mockResolvedValue({})
    groups.delete.mockResolvedValue(undefined)
    groups.addTask.mockResolvedValue(true)
    groups.removeTask.mockResolvedValue(true)
    groups.getGroupTasks.mockResolvedValue([])
    groups.queueAll.mockResolvedValue(0)
  })

  describe('loadGroups', () => {
    it('populates groups on success', async () => {
      const groups = [makeGroup('g1'), makeGroup('g2')]
      ;(window.api.groups.list as ReturnType<typeof vi.fn>).mockResolvedValue(groups)

      await useTaskGroups.getState().loadGroups()

      const state = useTaskGroups.getState()
      expect(state.groups).toHaveLength(2)
      expect(state.groups[0].id).toBe('g1')
      expect(state.groups[1].id).toBe('g2')
      expect(state.loading).toBe(false)
    })

    it('handles error state', async () => {
      ;(window.api.groups.list as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('network error')
      )

      await useTaskGroups.getState().loadGroups()

      const state = useTaskGroups.getState()
      expect(state.groups).toEqual([])
      expect(state.loading).toBe(false)
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('network error'))
    })

    it('handles non-array result gracefully', async () => {
      ;(window.api.groups.list as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      await useTaskGroups.getState().loadGroups()

      expect(useTaskGroups.getState().groups).toEqual([])
    })
  })

  describe('selectGroup', () => {
    it('sets selectedGroupId and loads group tasks', async () => {
      const tasks = [makeTask('t1'), makeTask('t2')]
      ;(window.api.groups.getGroupTasks as ReturnType<typeof vi.fn>).mockResolvedValue(tasks)

      useTaskGroups.getState().selectGroup('g1')

      // Wait for async task loading
      await new Promise((resolve) => setTimeout(resolve, 0))

      const state = useTaskGroups.getState()
      expect(state.selectedGroupId).toBe('g1')
      expect(state.groupTasks).toHaveLength(2)
    })

    it('clears groupTasks when selecting null', () => {
      useTaskGroups.setState({ selectedGroupId: 'g1', groupTasks: [makeTask('t1')] })

      useTaskGroups.getState().selectGroup(null)

      const state = useTaskGroups.getState()
      expect(state.selectedGroupId).toBeNull()
      expect(state.groupTasks).toEqual([])
    })
  })

  describe('loadGroupTasks', () => {
    it('loads tasks for the selected group', async () => {
      const tasks = [makeTask('t1', { group_id: 'g1' }), makeTask('t2', { group_id: 'g1' })]
      ;(window.api.groups.getGroupTasks as ReturnType<typeof vi.fn>).mockResolvedValue(tasks)

      await useTaskGroups.getState().loadGroupTasks('g1')

      const state = useTaskGroups.getState()
      expect(state.groupTasks).toHaveLength(2)
      expect(state.loading).toBe(false)
    })

    it('handles error state', async () => {
      ;(window.api.groups.getGroupTasks as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('fetch error')
      )

      await useTaskGroups.getState().loadGroupTasks('g1')

      const state = useTaskGroups.getState()
      expect(state.groupTasks).toEqual([])
      expect(state.loading).toBe(false)
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('fetch error'))
    })
  })

  describe('createGroup', () => {
    it('creates a new group and adds to state', async () => {
      const newGroup = makeGroup('g1', { name: 'New Group' })
      ;(window.api.groups.create as ReturnType<typeof vi.fn>).mockResolvedValue(newGroup)

      const result = await useTaskGroups.getState().createGroup({ name: 'New Group' })

      expect(result).toEqual(newGroup)
      expect(useTaskGroups.getState().groups).toContainEqual(newGroup)
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('New Group'))
    })

    it('returns null and shows error on failure', async () => {
      ;(window.api.groups.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('create failed')
      )

      const result = await useTaskGroups.getState().createGroup({ name: 'Test' })

      expect(result).toBeNull()
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('create failed'))
    })
  })

  describe('updateGroup', () => {
    it('updates group optimistically and applies server response', async () => {
      const original = makeGroup('g1', { name: 'Original' })
      const updated = makeGroup('g1', { name: 'Updated' })
      useTaskGroups.setState({ groups: [original] })
      ;(window.api.groups.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated)

      await useTaskGroups.getState().updateGroup('g1', { name: 'Updated' })

      const state = useTaskGroups.getState()
      expect(state.groups[0].name).toBe('Updated')
      expect(toast.success).toHaveBeenCalledWith('Group updated')
    })

    it('reverts optimistic update on error', async () => {
      const original = makeGroup('g1', { name: 'Original' })
      useTaskGroups.setState({ groups: [original] })
      ;(window.api.groups.update as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('update failed')
      )
      const loadGroupsSpy = vi
        .spyOn(useTaskGroups.getState(), 'loadGroups')
        .mockResolvedValue(undefined)

      await useTaskGroups.getState().updateGroup('g1', { name: 'Broken' })

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('update failed'))
      expect(loadGroupsSpy).toHaveBeenCalled()
    })
  })

  describe('deleteGroup', () => {
    it('deletes group optimistically and from server', async () => {
      const group = makeGroup('g1', { name: 'To Delete' })
      useTaskGroups.setState({ groups: [group] })

      await useTaskGroups.getState().deleteGroup('g1')

      expect(useTaskGroups.getState().groups).toHaveLength(0)
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('To Delete'))
    })

    it('clears selectedGroupId if deleting selected group', async () => {
      const group = makeGroup('g1')
      useTaskGroups.setState({ groups: [group], selectedGroupId: 'g1' })

      await useTaskGroups.getState().deleteGroup('g1')

      expect(useTaskGroups.getState().selectedGroupId).toBeNull()
      expect(useTaskGroups.getState().groupTasks).toEqual([])
    })

    it('reverts optimistic delete on error', async () => {
      const group = makeGroup('g1')
      useTaskGroups.setState({ groups: [group] })
      ;(window.api.groups.delete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('delete failed')
      )
      const loadGroupsSpy = vi
        .spyOn(useTaskGroups.getState(), 'loadGroups')
        .mockResolvedValue(undefined)

      await useTaskGroups.getState().deleteGroup('g1')

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('delete failed'))
      expect(loadGroupsSpy).toHaveBeenCalled()
    })
  })

  describe('addTaskToGroup', () => {
    it('adds task and reloads group tasks if group is selected', async () => {
      useTaskGroups.setState({ selectedGroupId: 'g1' })
      const loadGroupTasksSpy = vi
        .spyOn(useTaskGroups.getState(), 'loadGroupTasks')
        .mockResolvedValue(undefined)

      await useTaskGroups.getState().addTaskToGroup('t1', 'g1')

      expect(toast.success).toHaveBeenCalledWith('Task added to group')
      expect(loadGroupTasksSpy).toHaveBeenCalledWith('g1')
    })

    it('shows error when add fails', async () => {
      ;(window.api.groups.addTask as ReturnType<typeof vi.fn>).mockResolvedValue(false)

      await useTaskGroups.getState().addTaskToGroup('t1', 'g1')

      expect(toast.error).toHaveBeenCalledWith('Failed to add task to group')
    })

    it('handles exception', async () => {
      ;(window.api.groups.addTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('add error')
      )

      await useTaskGroups.getState().addTaskToGroup('t1', 'g1')

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('add error'))
    })
  })

  describe('removeTaskFromGroup', () => {
    it('removes task and reloads group tasks if group is selected', async () => {
      useTaskGroups.setState({ selectedGroupId: 'g1' })
      const loadGroupTasksSpy = vi
        .spyOn(useTaskGroups.getState(), 'loadGroupTasks')
        .mockResolvedValue(undefined)

      await useTaskGroups.getState().removeTaskFromGroup('t1')

      expect(toast.success).toHaveBeenCalledWith('Task removed from group')
      expect(loadGroupTasksSpy).toHaveBeenCalledWith('g1')
    })

    it('shows error when remove fails', async () => {
      ;(window.api.groups.removeTask as ReturnType<typeof vi.fn>).mockResolvedValue(false)

      await useTaskGroups.getState().removeTaskFromGroup('t1')

      expect(toast.error).toHaveBeenCalledWith('Failed to remove task from group')
    })

    it('handles exception', async () => {
      ;(window.api.groups.removeTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('remove error')
      )

      await useTaskGroups.getState().removeTaskFromGroup('t1')

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('remove error'))
    })
  })

  describe('queueAllTasks', () => {
    it('queues all tasks and shows success message', async () => {
      ;(window.api.groups.queueAll as ReturnType<typeof vi.fn>).mockResolvedValue(3)

      const count = await useTaskGroups.getState().queueAllTasks('g1')

      expect(count).toBe(3)
      expect(toast.success).toHaveBeenCalledWith('Queued 3 tasks')
    })

    it('handles singular task count', async () => {
      ;(window.api.groups.queueAll as ReturnType<typeof vi.fn>).mockResolvedValue(1)

      await useTaskGroups.getState().queueAllTasks('g1')

      expect(toast.success).toHaveBeenCalledWith('Queued 1 task')
    })

    it('returns 0 and shows error on failure', async () => {
      ;(window.api.groups.queueAll as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('queue failed')
      )

      const count = await useTaskGroups.getState().queueAllTasks('g1')

      expect(count).toBe(0)
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('queue failed'))
    })
  })
})
