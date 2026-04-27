import type { WorkflowTemplate } from '../../shared/workflow-types'
import type { IDashboardRepository, CreateTaskInput } from '../data/sprint-task-repository'
import type { SprintTask, TaskDependency } from '../../shared/types'

export interface WorkflowResult {
  tasks: SprintTask[]
  errors: string[]
}

export async function instantiateWorkflow(
  template: WorkflowTemplate,
  repo: IDashboardRepository
): Promise<WorkflowResult> {
  const created: SprintTask[] = []
  const errors: string[] = []

  for (let i = 0; i < template.steps.length; i++) {
    const step = template.steps[i]
    if (!step) continue

    // Resolve dependency IDs from step indices
    const dependsOn: TaskDependency[] = []
    if (step.dependsOnSteps) {
      for (const depIdx of step.dependsOnSteps) {
        const upstream = created[depIdx]
        if (depIdx < 0 || depIdx >= created.length || !upstream) {
          errors.push(`Step ${i}: dependsOnSteps[${depIdx}] out of range`)
          continue
        }
        dependsOn.push({
          id: upstream.id,
          type: step.depType ?? 'hard'
        })
      }
    }

    const input: CreateTaskInput = {
      title: `[${template.name}] ${step.title}`,
      repo: step.repo,
      status: dependsOn.length > 0 ? 'blocked' : 'backlog',
      ...(step.prompt !== undefined ? { prompt: step.prompt } : {}),
      ...(step.spec !== undefined ? { spec: step.spec } : {}),
      ...(dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
      ...(step.playgroundEnabled !== undefined
        ? { playground_enabled: step.playgroundEnabled }
        : {}),
      ...(step.model !== undefined ? { model: step.model } : {})
    }

    const task = await repo.createTask(input)
    if (!task) {
      errors.push(`Step ${i}: createTask failed for "${step.title}"`)
      break // Stop — later steps may depend on this one
    }
    created.push(task)
  }

  return { tasks: created, errors }
}
