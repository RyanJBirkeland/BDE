import { useEffect, useCallback } from 'react'
import { toast } from '../stores/toasts'
import { usePrGroupsStore, selectGroupsForRepo, selectUnassignedApprovedTasks } from '../stores/prGroups'
import { useSprintTasks } from '../stores/sprintTasks'
import type { PrGroup } from '../../../shared/types/task-types'
import { validateGitHubUrl } from '../lib/utils'

export interface UsePrGroupsResult {
  groups: PrGroup[]
  buildingGroupIds: Set<string>
  unassignedTasksForRepo: ReturnType<typeof selectUnassignedApprovedTasks>
  createGroup(title: string, branchName: string, description?: string): Promise<PrGroup>
  updateGroup(id: string, updates: { title?: string; branchName?: string; description?: string }): Promise<void>
  addTask(groupId: string, taskId: string): Promise<void>
  removeTask(groupId: string, taskId: string): Promise<void>
  buildGroup(id: string): Promise<void>
  deleteGroup(id: string): Promise<void>
  reload(): void
}

export function usePrGroups(repo: string): UsePrGroupsResult {
  const allGroups = usePrGroupsStore((s) => s.groups)
  const buildingGroupIds = usePrGroupsStore((s) => s.buildingGroupIds)
  const loadGroups = usePrGroupsStore((s) => s.loadGroups)
  const storeCreateGroup = usePrGroupsStore((s) => s.createGroup)
  const storeUpdateGroup = usePrGroupsStore((s) => s.updateGroup)
  const storeAddTask = usePrGroupsStore((s) => s.addTask)
  const storeRemoveTask = usePrGroupsStore((s) => s.removeTask)
  const storeBuildGroup = usePrGroupsStore((s) => s.buildGroup)
  const storeDeleteGroup = usePrGroupsStore((s) => s.deleteGroup)
  const tasks = useSprintTasks((s) => s.tasks)

  useEffect(() => {
    loadGroups(repo)
  }, [repo, loadGroups])

  const reload = useCallback(() => {
    loadGroups(repo)
  }, [repo, loadGroups])

  const createGroup = useCallback(
    (title: string, branchName: string, description?: string) => {
      return storeCreateGroup(repo, title, branchName, description)
    },
    [repo, storeCreateGroup]
  )

  const buildGroup = useCallback(
    async (id: string) => {
      const result = await storeBuildGroup(id)
      if (result.success && result.prUrl) {
        const safePrUrl = validateGitHubUrl(result.prUrl)
        if (safePrUrl) {
          toast.info('PR created', {
            action: 'Open PR',
            onAction: () => window.open(safePrUrl, '_blank')
          })
        } else {
          toast.info('PR created')
        }
        reload()
      } else if (!result.success) {
        toast.error(result.error ?? 'PR creation failed')
      }
    },
    [storeBuildGroup, reload]
  )

  return {
    groups: selectGroupsForRepo(allGroups, repo),
    buildingGroupIds,
    unassignedTasksForRepo: selectUnassignedApprovedTasks(tasks, allGroups, repo),
    createGroup,
    updateGroup: storeUpdateGroup,
    addTask: storeAddTask,
    removeTask: storeRemoveTask,
    buildGroup,
    deleteGroup: storeDeleteGroup,
    reload,
  }
}
