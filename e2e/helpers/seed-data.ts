import type { Page } from '@playwright/test'

/**
 * Insert a test task via the app's IPC bridge.
 * Returns the created task object (with id).
 */
export async function seedTask(
  window: Page,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; [key: string]: unknown }> {
  return window.evaluate(async (opts) => {
    return (window as any).api.sprint.create({
      title: opts.title ?? `E2E Test Task ${Date.now()}`,
      repo: opts.repo ?? 'BDE',
      status: opts.status ?? 'backlog',
      priority: opts.priority ?? 0,
      ...opts
    })
  }, overrides)
}

/** Delete a test task by ID. Safe to call even if task doesn't exist. */
export async function cleanupTask(window: Page, taskId: string): Promise<void> {
  await window.evaluate(async (id) => {
    try {
      await (window as any).api.sprint.delete(id)
    } catch {
      /* ignore if already deleted */
    }
  }, taskId)
}

/** Delete all tasks with titles matching a prefix. Useful for test cleanup. */
export async function cleanupTestTasks(window: Page, prefix = 'E2E Test Task'): Promise<void> {
  await window.evaluate(async (p) => {
    const tasks: any[] = await (window as any).api.sprint.list()
    for (const task of tasks) {
      if (task.title?.startsWith(p)) {
        await (window as any).api.sprint.delete(task.id)
      }
    }
  }, prefix)
}
