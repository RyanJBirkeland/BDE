import { safeHandle } from '../ipc-utils'
import type { EpicGroupService } from '../services/epic-group-service'
import type { CreateGroupInput, UpdateGroupInput } from '../data/task-group-queries'
import type { EpicDependency, TaskGroup } from '../../shared/types'

/**
 * Register the IPC handlers that expose EpicGroupService over the preload
 * bridge. The service itself is constructed at the composition root and
 * passed in — the handler module holds no state.
 */
export function registerGroupHandlers(service: EpicGroupService): void {
  safeHandle('groups:create', (_e, input: CreateGroupInput) => service.createEpic(input))
  safeHandle('groups:list', () => service.listEpics())
  safeHandle('groups:get', (_e, id: string) => service.getEpic(id))
  safeHandle('groups:update', (_e, id: string, patch: UpdateGroupInput) =>
    service.updateEpic(id, patch)
  )
  safeHandle('groups:delete', (_e, id: string) => service.deleteEpic(id))

  safeHandle('groups:addTask', (_e, taskId: string, groupId: string) => {
    service.addTask(groupId, taskId)
    return true
  })
  safeHandle('groups:removeTask', (_e, taskId: string) => {
    service.removeTask(taskId)
    return true
  })
  safeHandle('groups:getGroupTasks', (_e, groupId: string) => service.getEpicTasks(groupId))
  safeHandle('groups:queueAll', (_e, groupId: string) => service.queueAllTasks(groupId))
  safeHandle('groups:reorderTasks', (_e, groupId: string, orderedTaskIds: string[]) => {
    service.reorderTasks(groupId, orderedTaskIds)
    return true
  })
  safeHandle('groups:addDependency', (_e, groupId: string, dep: EpicDependency) =>
    service.addDependency(groupId, dep)
  )
  safeHandle('groups:removeDependency', (_e, groupId: string, upstreamId: string) =>
    service.removeDependency(groupId, upstreamId)
  )
  type DepCondition = EpicDependency['condition']
  const updateDepCondition = (
    _e: Electron.IpcMainInvokeEvent,
    groupId: string,
    upstreamId: string,
    condition: DepCondition
  ): TaskGroup => service.updateDependencyCondition(groupId, upstreamId, condition)
  safeHandle('groups:updateDependencyCondition', updateDepCondition)
}
