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
  type CreateGroupInput,
  type UpdateGroupInput
} from '../data/task-group-queries'

export function registerGroupHandlers(): void {
  safeHandle('groups:create', (_e, input: CreateGroupInput) => {
    const group = createGroup(input)
    if (!group) throw new Error('Failed to create task group')
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
}
