/**
 * EpicGroupService — mutation-side facade over task-group-queries plus the
 * in-memory epic dependency index. Owns index-rebuild so every caller (IPC,
 * MCP) sees identical behavior.
 */
import type { TaskGroup, EpicDependency, SprintTask } from '../../shared/types'
import type {
  CreateGroupInput,
  UpdateGroupInput
} from '../data/task-group-queries'
import type { EpicDepsReader } from './epic-dependency-service'
import {
  createGroup as defaultCreateGroup,
  listGroups as defaultListGroups,
  getGroup as defaultGetGroup,
  updateGroup as defaultUpdateGroup,
  deleteGroup as defaultDeleteGroup,
  addTaskToGroup as defaultAddTaskToGroup,
  removeTaskFromGroup as defaultRemoveTaskFromGroup,
  getGroupTasks as defaultGetGroupTasks,
  reorderGroupTasks as defaultReorderGroupTasks,
  queueAllGroupTasks as defaultQueueAllGroupTasks,
  addGroupDependency as defaultAddGroupDependency,
  removeGroupDependency as defaultRemoveGroupDependency,
  updateGroupDependencyCondition as defaultUpdateGroupDependencyCondition
} from '../data/task-group-queries'
import { createEpicDependencyIndex, detectEpicCycle } from './epic-dependency-service'

export interface EpicGroupQueries {
  createGroup: (input: CreateGroupInput) => TaskGroup | null
  listGroups: () => TaskGroup[]
  getGroup: (id: string) => TaskGroup | null
  updateGroup: (id: string, patch: UpdateGroupInput) => TaskGroup | null
  deleteGroup: (id: string) => void
  addTaskToGroup: (taskId: string, groupId: string) => boolean
  removeTaskFromGroup: (taskId: string) => boolean
  getGroupTasks: (groupId: string) => SprintTask[]
  reorderGroupTasks: (groupId: string, orderedTaskIds: string[]) => boolean
  queueAllGroupTasks: (groupId: string) => number
  addGroupDependency: (groupId: string, dep: EpicDependency) => TaskGroup | null
  removeGroupDependency: (groupId: string, upstreamId: string) => TaskGroup | null
  updateGroupDependencyCondition: (
    groupId: string,
    upstreamId: string,
    condition: EpicDependency['condition']
  ) => TaskGroup | null
}

export interface EpicGroupService extends EpicDepsReader {
  listEpics: () => TaskGroup[]
  getEpic: (id: string) => TaskGroup | null
  getEpicTasks: (id: string) => SprintTask[]
  createEpic: (input: CreateGroupInput) => TaskGroup
  updateEpic: (id: string, patch: UpdateGroupInput) => TaskGroup
  deleteEpic: (id: string) => void
  addTask: (epicId: string, taskId: string) => void
  removeTask: (taskId: string) => void
  reorderTasks: (epicId: string, orderedTaskIds: string[]) => void
  queueAllTasks: (epicId: string) => number
  addDependency: (epicId: string, dep: EpicDependency) => TaskGroup
  removeDependency: (epicId: string, upstreamId: string) => TaskGroup
  updateDependencyCondition: (
    epicId: string,
    upstreamId: string,
    condition: EpicDependency['condition']
  ) => TaskGroup
}

const defaultQueries: EpicGroupQueries = {
  createGroup: defaultCreateGroup,
  listGroups: defaultListGroups,
  getGroup: defaultGetGroup,
  updateGroup: defaultUpdateGroup,
  deleteGroup: defaultDeleteGroup,
  addTaskToGroup: defaultAddTaskToGroup,
  removeTaskFromGroup: defaultRemoveTaskFromGroup,
  getGroupTasks: defaultGetGroupTasks,
  reorderGroupTasks: defaultReorderGroupTasks,
  queueAllGroupTasks: defaultQueueAllGroupTasks,
  addGroupDependency: defaultAddGroupDependency,
  removeGroupDependency: defaultRemoveGroupDependency,
  updateGroupDependencyCondition: defaultUpdateGroupDependencyCondition
}

export function createEpicGroupService(
  queries: EpicGroupQueries = defaultQueries
): EpicGroupService {
  const index = createEpicDependencyIndex()

  function rebuildIndex(): void {
    index.rebuild(queries.listGroups())
  }

  rebuildIndex()

  function assertNoCycle(epicId: string, proposedDeps: EpicDependency[]): void {
    const cycle = detectEpicCycle(epicId, proposedDeps, (id) => {
      const g = queries.getGroup(id)
      return g?.depends_on ?? null
    })
    if (cycle) throw new Error(`Epic cycle detected: ${cycle.join(' -> ')}`)
  }

  return {
    listEpics: () => queries.listGroups(),
    getEpic: (id) => queries.getGroup(id),
    getEpicTasks: (id) => queries.getGroupTasks(id),

    getDependentEpics: (epicId) => index.getDependentEpics(epicId),
    areEpicDepsSatisfied: (epicId, deps, getEpicStatus, getEpicTasks) =>
      index.areEpicDepsSatisfied(epicId, deps, getEpicStatus, getEpicTasks),

    createEpic(input) {
      const created = queries.createGroup(input)
      if (!created) throw new Error('Failed to create task group')
      rebuildIndex()
      return created
    },

    updateEpic(id, patch) {
      const updated = queries.updateGroup(id, patch)
      if (!updated) throw new Error(`Task group not found: ${id}`)
      rebuildIndex()
      return updated
    },

    deleteEpic(id) {
      queries.deleteGroup(id)
      rebuildIndex()
    },

    // task membership does not affect the epic dependency graph — no rebuild needed
    addTask(epicId, taskId) {
      const ok = queries.addTaskToGroup(taskId, epicId)
      if (!ok) throw new Error(`Failed to add task ${taskId} to group ${epicId}`)
    },

    removeTask(taskId) {
      const ok = queries.removeTaskFromGroup(taskId)
      if (!ok) throw new Error(`Failed to remove task ${taskId} from group`)
    },

    reorderTasks(epicId, orderedTaskIds) {
      const ok = queries.reorderGroupTasks(epicId, orderedTaskIds)
      if (!ok) throw new Error(`Failed to reorder tasks in group ${epicId}`)
    },

    queueAllTasks: (epicId) => queries.queueAllGroupTasks(epicId),

    addDependency(epicId, dep) {
      const group = queries.getGroup(epicId)
      if (!group) throw new Error(`Task group not found: ${epicId}`)
      const currentDeps = group.depends_on ?? []
      const proposedDeps = [...currentDeps, dep]
      assertNoCycle(epicId, proposedDeps)
      const updated = queries.addGroupDependency(epicId, dep)
      if (!updated) throw new Error(`Failed to add dependency to group ${epicId}`)
      rebuildIndex()
      return updated
    },

    removeDependency(epicId, upstreamId) {
      const updated = queries.removeGroupDependency(epicId, upstreamId)
      if (!updated) throw new Error(`Failed to remove dependency from group ${epicId}`)
      rebuildIndex()
      return updated
    },

    updateDependencyCondition(epicId, upstreamId, condition) {
      const updated = queries.updateGroupDependencyCondition(epicId, upstreamId, condition)
      if (!updated) throw new Error(`Failed to update dependency condition in group ${epicId}`)
      rebuildIndex()
      return updated
    }
  }
}
