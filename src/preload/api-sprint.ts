import { typedInvoke } from './ipc-helpers'
import type { BatchOperation, EpicDependency } from '../shared/types'
import type { WorkflowTemplate } from '../shared/workflow-types'

export const sprint = {
  list: () => typedInvoke('sprint:list'),
  create: (task: {
    title: string
    repo: string
    prompt?: string
    notes?: string
    spec?: string
    priority?: number
    status?: string
    template_name?: string
    playground_enabled?: boolean
    group_id?: string | null
  }) => typedInvoke('sprint:create', task),
  createWorkflow: (template: WorkflowTemplate) => typedInvoke('sprint:createWorkflow', template),
  claimTask: (taskId: string) => typedInvoke('sprint:claimTask', taskId),
  update: (id: string, patch: Record<string, unknown>) => typedInvoke('sprint:update', id, patch),
  readLog: (agentId: string, fromByte?: number) => typedInvoke('sprint:readLog', agentId, fromByte),
  readSpecFile: (filePath: string) => typedInvoke('sprint:readSpecFile', filePath),
  generatePrompt: (args: { taskId: string; title: string; repo: string; templateHint: string }) =>
    typedInvoke('sprint:generatePrompt', args),
  delete: (id: string) => typedInvoke('sprint:delete', id),
  healthCheck: () => typedInvoke('sprint:healthCheck'),
  validateDependencies: (taskId: string, deps: Array<{ id: string; type: 'hard' | 'soft' }>) =>
    typedInvoke('sprint:validateDependencies', taskId, deps),
  unblockTask: (taskId: string) => typedInvoke('sprint:unblockTask', taskId),
  retry: (taskId: string) => typedInvoke('sprint:retry', taskId),
  batchUpdate: (operations: BatchOperation[]) => typedInvoke('sprint:batchUpdate', operations),
  batchImport: (
    tasks: Array<{
      title: string
      repo: string
      prompt?: string
      spec?: string
      status?: string
      dependsOnIndices?: number[]
      depType?: 'hard' | 'soft'
      playgroundEnabled?: boolean
      model?: string
      tags?: string[]
      priority?: number
      templateName?: string
    }>
  ) => typedInvoke('sprint:batchImport', tasks),
  exportTasks: (format: 'json' | 'csv') => typedInvoke('sprint:exportTasks', format),
  exportTaskHistory: (taskId: string) => typedInvoke('sprint:exportTaskHistory', taskId),
  failureBreakdown: () => typedInvoke('sprint:failureBreakdown'),
  getSuccessRateBySpecType: () => typedInvoke('sprint:getSuccessRateBySpecType'),
  getChanges: (taskId: string) => typedInvoke('sprint:getChanges', taskId),
  forceFailTask: (payload: { taskId: string; reason?: string; force?: boolean }) =>
    typedInvoke('sprint:forceFailTask', payload),
  forceDoneTask: (payload: { taskId: string; reason?: string; force?: boolean }) =>
    typedInvoke('sprint:forceDoneTask', payload)
}

export const groups = {
  create: (input: { name: string; icon?: string; accent_color?: string; goal?: string }) =>
    typedInvoke('groups:create', input),
  list: () => typedInvoke('groups:list'),
  get: (id: string) => typedInvoke('groups:get', id),
  update: (
    id: string,
    patch: {
      name?: string
      icon?: string
      accent_color?: string
      goal?: string
      status?: 'draft' | 'ready' | 'in-pipeline' | 'completed'
    }
  ) => typedInvoke('groups:update', id, patch),
  delete: (id: string) => typedInvoke('groups:delete', id),
  addTask: (taskId: string, groupId: string) => typedInvoke('groups:addTask', taskId, groupId),
  removeTask: (taskId: string) => typedInvoke('groups:removeTask', taskId),
  getGroupTasks: (groupId: string) => typedInvoke('groups:getGroupTasks', groupId),
  queueAll: (groupId: string) => typedInvoke('groups:queueAll', groupId),
  reorderTasks: (groupId: string, orderedTaskIds: string[]) =>
    typedInvoke('groups:reorderTasks', groupId, orderedTaskIds),
  addDependency: (groupId: string, dep: EpicDependency) =>
    typedInvoke('groups:addDependency', groupId, dep),
  removeDependency: (groupId: string, upstreamId: string) =>
    typedInvoke('groups:removeDependency', groupId, upstreamId),
  updateDependencyCondition: (
    groupId: string,
    upstreamId: string,
    condition: EpicDependency['condition']
  ) => typedInvoke('groups:updateDependencyCondition', groupId, upstreamId, condition)
}
