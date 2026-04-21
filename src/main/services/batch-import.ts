import type { IDashboardRepository, CreateTaskInput } from '../data/sprint-task-repository'
import type { SprintTask, TaskDependency } from '../../shared/types'
import { TASK_STATUSES } from '../../shared/task-state-machine'

export interface BatchTaskInput {
  title: string
  repo: string
  prompt?: string | undefined
  spec?: string | undefined
  status?: string | undefined
  dependsOnIndices?: number[] | undefined
  depType?: 'hard' | 'soft' | undefined
  playgroundEnabled?: boolean | undefined
  model?: string | undefined
  tags?: string[] | undefined
  priority?: number | undefined
  templateName?: string | undefined
}

export interface BatchImportResult {
  created: SprintTask[]
  errors: string[]
}

/**
 * Import a batch of tasks from JSON array.
 * Dependencies can be specified by index in the input array.
 *
 * @param tasks - Array of task inputs with optional dependsOnIndices
 * @param repo - Sprint task repository for persistence
 * @returns Result with created tasks and any errors
 */
export function batchImportTasks(
  tasks: BatchTaskInput[],
  repo: IDashboardRepository,
  configuredRepos?: string[]
): BatchImportResult {
  const created: SprintTask[] = []
  const errors: string[] = []

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    if (!t) continue

    // Validate required fields
    if (!t.title || !t.repo) {
      errors.push(`Task[${i}]: missing required title or repo`)
      continue
    }

    // Validate status against known statuses if provided
    if (t.status !== undefined && !(TASK_STATUSES as readonly string[]).includes(t.status)) {
      errors.push(
        `Task[${i}]: invalid status "${t.status}". Valid statuses: ${TASK_STATUSES.join(', ')}`
      )
      continue
    }

    // Validate repo against configured repos if list is provided
    if (configuredRepos !== undefined) {
      if (configuredRepos.length === 0) {
        errors.push(`Task[${i}]: repo "${t.repo}" is not configured. No repos are configured.`)
        continue
      }
      const repoLower = t.repo.toLowerCase()
      const isConfigured = configuredRepos.some((r) => r.toLowerCase() === repoLower)
      if (!isConfigured) {
        errors.push(
          `Task[${i}]: repo "${t.repo}" is not configured. Configured repos: ${configuredRepos.join(', ')}`
        )
        continue
      }
    }

    // Build dependency array from indices
    const dependsOn: TaskDependency[] = []
    if (t.dependsOnIndices && t.dependsOnIndices.length > 0) {
      for (const idx of t.dependsOnIndices) {
        const upstream = created[idx]
        if (idx < 0 || idx >= created.length || !upstream) {
          errors.push(`Task[${i}]: dependsOnIndices[${idx}] out of range`)
          continue
        }
        dependsOn.push({
          id: upstream.id,
          type: t.depType ?? 'hard'
        })
      }
      // If there were invalid indices, skip creating this task
      if (dependsOn.length !== t.dependsOnIndices.length) {
        continue
      }
    }

    // Build CreateTaskInput — omit undefined fields so exactOptionalPropertyTypes is satisfied.
    const input: CreateTaskInput = {
      title: t.title,
      repo: t.repo,
      ...(t.prompt !== undefined ? { prompt: t.prompt } : {}),
      ...(t.spec !== undefined ? { spec: t.spec } : {}),
      ...(t.status !== undefined ? { status: t.status } : {}),
      ...(dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
      ...(t.playgroundEnabled !== undefined ? { playground_enabled: t.playgroundEnabled } : {}),
      ...(t.model !== undefined ? { model: t.model } : {}),
      ...(t.tags !== undefined ? { tags: t.tags } : {}),
      ...(t.priority !== undefined ? { priority: t.priority } : {}),
      ...(t.templateName !== undefined ? { template_name: t.templateName } : {})
    }

    // Create task via repository
    const task = repo.createTask(input)
    if (!task) {
      errors.push(`Task[${i}]: Failed to create task "${t.title}"`)
      continue
    }

    created.push(task)
  }

  return { created, errors }
}
