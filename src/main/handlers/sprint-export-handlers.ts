/**
 * Export handlers for sprint tasks.
 * Extracted from sprint-local.ts to improve module cohesion.
 */

import { writeFile } from 'fs/promises'
import { safeHandle } from '../ipc-utils'
import type { DialogService } from '../dialog-service'
import { getTask, listTasks } from '../services/sprint-service'
import { formatTasksAsCsv } from '../services/csv-export'
import { nowIso } from '../../shared/time'
import { createLogger } from '../logger'

const logger = createLogger('sprint-export-handlers')

export interface ExportHandlersDeps {
  dialog: DialogService
}

export function registerSprintExportHandlers(deps: ExportHandlersDeps): void {
  safeHandle('sprint:exportTaskHistory', async (_e, taskId: string) => {
    const { getTaskChanges } = await import('../data/task-changes')

    // Get task to use title in filename suggestion
    const task = getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    // Get task change history
    const changes = getTaskChanges(taskId)

    // Show save dialog
    const result = await deps.dialog.showSaveDialog({
      title: 'Export Task History',
      defaultPath: `task-history-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false }
    }

    // Prepare export data
    const exportData = {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        created_at: task.created_at,
        updated_at: task.updated_at
      },
      changes,
      exportedAt: nowIso()
    }

    // Write to file
    await writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')

    return { success: true, path: result.filePath }
  })

  type ExportResult = { filePath: string | null; canceled: boolean }
  safeHandle('sprint:exportTasks', async (_e, format: 'json' | 'csv'): Promise<ExportResult> => {
    const tasks = listTasks()

    // Show save dialog
    const result = await deps.dialog.showSaveDialog({
      title: 'Export Sprint Tasks',
      defaultPath: `sprint-tasks-${nowIso().split('T')[0]}.${format}`,
      filters: [
        format === 'json'
          ? { name: 'JSON Files', extensions: ['json'] }
          : { name: 'CSV Files', extensions: ['csv'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { filePath: null, canceled: true }
    }

    // Generate export content
    const content =
      format === 'json'
        ? JSON.stringify(tasks, null, 2)
        : formatTasksAsCsv(tasks as unknown as Array<Record<string, unknown>>)

    // Write to file
    await writeFile(result.filePath, content, 'utf-8')
    logger.info(`[sprint:exportTasks] Exported ${tasks.length} tasks to ${result.filePath}`)

    return { filePath: result.filePath, canceled: false }
  })
}
