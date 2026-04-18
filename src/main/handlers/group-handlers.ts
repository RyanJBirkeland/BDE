import { safeHandle } from '../ipc-utils'
import { createEpicGroupService, type EpicGroupService } from '../services/epic-group-service'
import type {
  CreateGroupInput,
  UpdateGroupInput
} from '../data/task-group-queries'
import type { EpicDependency } from '../../shared/types'

// Module-level singleton — mirrors prior handler-file behavior. All callers
// share the same dependency index.
let service: EpicGroupService | null = null
function svc(): EpicGroupService {
  if (!service) service = createEpicGroupService()
  return service
}

export function getEpicGroupService(): EpicGroupService {
  return svc()
}

export function registerGroupHandlers(): void {
  svc() // force construction + initial index build

  safeHandle('groups:create', (_e, input: CreateGroupInput) => svc().createEpic(input))
  safeHandle('groups:list', () => svc().listEpics())
  safeHandle('groups:get', (_e, id: string) => svc().getEpic(id))
  safeHandle('groups:update', (_e, id: string, patch: UpdateGroupInput) =>
    svc().updateEpic(id, patch)
  )
  safeHandle('groups:delete', (_e, id: string) => svc().deleteEpic(id))

  safeHandle('groups:addTask', (_e, taskId: string, groupId: string) => {
    svc().addTask(groupId, taskId)
    return true
  })
  safeHandle('groups:removeTask', (_e, taskId: string) => {
    svc().removeTask(taskId)
    return true
  })
  safeHandle('groups:getGroupTasks', (_e, groupId: string) => svc().getEpicTasks(groupId))
  safeHandle('groups:queueAll', (_e, groupId: string) => svc().queueAllTasks(groupId))
  safeHandle('groups:reorderTasks', (_e, groupId: string, orderedTaskIds: string[]) => {
    svc().reorderTasks(groupId, orderedTaskIds)
    return true
  })
  safeHandle('groups:addDependency', (_e, groupId: string, dep: EpicDependency) =>
    svc().addDependency(groupId, dep)
  )
  safeHandle('groups:removeDependency', (_e, groupId: string, upstreamId: string) =>
    svc().removeDependency(groupId, upstreamId)
  )
  safeHandle('groups:updateDependencyCondition', (_e, groupId: string, upstreamId: string, condition: EpicDependency['condition']) =>
    svc().updateDependencyCondition(groupId, upstreamId, condition)
  )
}
