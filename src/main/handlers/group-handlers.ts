import { safeHandle } from '../ipc-utils'
import {
  createGroup,
  listGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  addTaskToGroup,
  removeTaskFromGroup,
  getGroupTasks,
  queueAllGroupTasks,
  reorderGroupTasks,
  addGroupDependency,
  removeGroupDependency,
  updateGroupDependencyCondition,
  type CreateGroupInput,
  type UpdateGroupInput
} from '../data/task-group-queries'
import { createEpicDependencyIndex, detectEpicCycle } from '../services/epic-dependency-service'
import type { EpicDependency } from '../../shared/types'

// In-memory epic dependency index
const epicIndex = createEpicDependencyIndex()

/**
 * Initialize epic index on startup by loading all groups.
 */
function initEpicIndex(): void {
  const groups = listGroups()
  epicIndex.rebuild(groups)
}

/**
 * Rebuild epic index after mutations.
 */
function rebuildEpicIndex(): void {
  const groups = listGroups()
  epicIndex.rebuild(groups)
}
export function registerGroupHandlers(): void {
  // Initialize epic index on first registration
  initEpicIndex()

  safeHandle('groups:create', (_e, input: CreateGroupInput) => {
    const group = createGroup(input)
    if (!group) throw new Error('Failed to create task group')
    rebuildEpicIndex()
    return group
  })

  safeHandle('groups:list', () => {
    return listGroups()
  })

  safeHandle('groups:get', (_e, id: string) => {
    return getGroup(id)
  })

  safeHandle('groups:update', (_e, id: string, patch: UpdateGroupInput) => {
    const group = updateGroup(id, patch)
    if (!group) throw new Error(`Task group not found: ${id}`)
    return group
  })

  safeHandle('groups:delete', (_e, id: string) => {
    deleteGroup(id)
  })

  safeHandle('groups:addTask', (_e, taskId: string, groupId: string) => {
    const success = addTaskToGroup(taskId, groupId)
    if (!success) throw new Error(`Failed to add task ${taskId} to group ${groupId}`)
    return true
  })

  safeHandle('groups:removeTask', (_e, taskId: string) => {
    const success = removeTaskFromGroup(taskId)
    if (!success) throw new Error(`Failed to remove task ${taskId} from group`)
    return true
  })

  safeHandle('groups:getGroupTasks', (_e, groupId: string) => {
    return getGroupTasks(groupId)
  })

  safeHandle('groups:queueAll', (_e, groupId: string) => {
    return queueAllGroupTasks(groupId)
  })

  safeHandle('groups:reorderTasks', (_e, groupId: string, orderedTaskIds: string[]) => {
    const success = reorderGroupTasks(groupId, orderedTaskIds)
    if (!success) throw new Error(`Failed to reorder tasks in group ${groupId}`)
    return true
  })

  safeHandle('groups:addDependency', (_e, groupId: string, dep: EpicDependency) => {
    // Check for cycles before writing
    const group = getGroup(groupId)
    if (!group) throw new Error(`Task group not found: ${groupId}`)

    const currentDeps = group.depends_on ?? []
    const proposedDeps = [...currentDeps, dep]

    const cycle = detectEpicCycle(groupId, proposedDeps, (id) => {
      const g = getGroup(id)
      return g?.depends_on ?? null
    })

    if (cycle) {
      throw new Error(`Epic cycle detected: ${cycle.join(' -> ')}`)
    }

    const updated = addGroupDependency(groupId, dep)
    if (!updated) throw new Error(`Failed to add dependency to group ${groupId}`)
    rebuildEpicIndex()
    return updated
  })

  safeHandle('groups:removeDependency', (_e, groupId: string, upstreamId: string) => {
    const updated = removeGroupDependency(groupId, upstreamId)
    if (!updated) throw new Error(`Failed to remove dependency from group ${groupId}`)
    rebuildEpicIndex()
    return updated
  })

  safeHandle('groups:updateDependencyCondition', (_e, groupId: string, upstreamId: string, condition: EpicDependency['condition']) => {
      const updated = updateGroupDependencyCondition(groupId, upstreamId, condition)
      if (!updated) throw new Error(`Failed to update dependency condition in group ${groupId}`)
      rebuildEpicIndex()
      return updated
    }
  )
}
