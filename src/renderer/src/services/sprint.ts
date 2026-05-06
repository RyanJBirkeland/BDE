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

export async function getLastPrompt(
  taskId: string
): ReturnType<typeof window.api.sprint.getLastPrompt> {
  return window.api.sprint.getLastPrompt(taskId)
}

export async function exportTasks(
  format: Parameters<typeof window.api.sprint.exportTasks>[0]
): ReturnType<typeof window.api.sprint.exportTasks> {
  return window.api.sprint.exportTasks(format)
}

export async function retryTask(
  taskId: string
): ReturnType<typeof window.api.sprint.retry> {
  return window.api.sprint.retry(taskId)
}

export async function unblockTask(
  taskId: string
): ReturnType<typeof window.api.sprint.unblockTask> {
  return window.api.sprint.unblockTask(taskId)
}

export async function forceFailTask(
  payload: Parameters<typeof window.api.sprint.forceFailTask>[0]
): ReturnType<typeof window.api.sprint.forceFailTask> {
  return window.api.sprint.forceFailTask(payload)
}

export async function forceDoneTask(
  payload: Parameters<typeof window.api.sprint.forceDoneTask>[0]
): ReturnType<typeof window.api.sprint.forceDoneTask> {
  return window.api.sprint.forceDoneTask(payload)
}

export async function forceReleaseClaim(
  taskId: string
): ReturnType<typeof window.api.sprint.forceReleaseClaim> {
  return window.api.sprint.forceReleaseClaim(taskId)
}
