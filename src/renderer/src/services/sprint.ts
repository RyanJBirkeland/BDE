import type { SprintTask } from '../../../shared/types'

export async function listTasks(): Promise<SprintTask[]> {
  return window.api.sprint.list()
}

export async function updateTask(
  taskId: string,
  patch: Parameters<typeof window.api.sprint.update>[1]
): Promise<SprintTask | null> {
  return window.api.sprint.update(taskId, patch)
}

export async function deleteTask(taskId: string): Promise<void> {
  await window.api.sprint.delete(taskId)
}

export async function createTask(
  input: Parameters<typeof window.api.sprint.create>[0]
): Promise<SprintTask> {
  return window.api.sprint.create(input)
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

export async function exportTaskHistory(
  taskId: string
): ReturnType<typeof window.api.sprint.exportTaskHistory> {
  return window.api.sprint.exportTaskHistory(taskId)
}
