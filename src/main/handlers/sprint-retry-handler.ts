import { safeHandle } from '../ipc-utils'
import { isValidTaskId } from '../lib/validation'
import { retryTask } from '../services/sprint-service'

export function registerSprintRetryHandler(): void {
  safeHandle('sprint:retry', async (_e, taskId: string) => {
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    return retryTask(taskId)
  })
}
