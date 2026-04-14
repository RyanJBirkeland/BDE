import type { SprintTask } from '../../../shared/types'

export async function listTasks(): Promise<SprintTask[]> {
  return window.api.sprint.list() as Promise<SprintTask[]>
}

export async function updateTask(
  taskId: string,
  patch: Parameters<typeof window.api.sprint.update>[1]
): Promise<SprintTask | null> {
  return window.api.sprint.update(taskId, patch) as Promise<SprintTask | null>
}

export async function deleteTask(taskId: string): Promise<void> {
  await window.api.sprint.delete(taskId)
}

export async function createTask(
  input: Parameters<typeof window.api.sprint.create>[0]
): Promise<SprintTask> {
  return window.api.sprint.create(input) as Promise<SprintTask>
}

export async function batchUpdate(
  operations: Parameters<typeof window.api.sprint.batchUpdate>[0]
): ReturnType<typeof window.api.sprint.batchUpdate> {
  return window.api.sprint.batchUpdate(operations)
}

export async function generatePrompt(
  params: Parameters<typeof window.api.sprint.generatePrompt>[0]
): ReturnType<typeof window.api.sprint.generatePrompt> {
  return window.api.sprint.generatePrompt(params)
}
