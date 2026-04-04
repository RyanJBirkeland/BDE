import type { ISprintTaskRepository, CreateTaskInput } from '../data/sprint-task-repository'
import type { SprintTask, TaskDependency } from '../../shared/types'

export interface BatchTaskInput {
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
  repo: ISprintTaskRepository
): BatchImportResult {
  const created: SprintTask[] = []
  const errors: string[] = []

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]

    // Validate required fields
    if (!t.title || !t.repo) {
      errors.push(`Task[${i}]: missing required title or repo`)
      continue
    }

    // Build dependency array from indices
    const dependsOn: TaskDependency[] = []
    if (t.dependsOnIndices && t.dependsOnIndices.length > 0) {
      for (const idx of t.dependsOnIndices) {
        if (idx < 0 || idx >= created.length) {
          errors.push(`Task[${i}]: dependsOnIndices[${idx}] out of range`)
          continue
        }
        dependsOn.push({
          id: created[idx].id,
          type: t.depType ?? 'hard'
        })
      }
      // If there were invalid indices, skip creating this task
      if (dependsOn.length !== t.dependsOnIndices.length) {
        continue
      }
    }

    // Build CreateTaskInput
    const input: CreateTaskInput = {
      title: t.title,
      repo: t.repo,
      prompt: t.prompt,
      spec: t.spec,
      status: t.status,
      depends_on: dependsOn.length > 0 ? dependsOn : undefined,
      playground_enabled: t.playgroundEnabled,
      model: t.model,
      tags: t.tags,
      priority: t.priority,
      template_name: t.templateName
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
