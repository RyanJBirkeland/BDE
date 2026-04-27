/**
 * Batch operation handlers for sprint tasks.
 * Extracted from sprint-local.ts to improve module cohesion.
 */

import { safeHandle } from '../ipc-utils'
import { getTask, updateTask, deleteTask } from '../services/sprint-service'
import { createSprintTaskRepository } from '../data/sprint-task-repository'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { validateTaskSpec } from '../services/spec-quality/index'
import { TERMINAL_STATUSES, isTaskStatus } from '../../shared/task-state-machine'
import type { TaskStatus } from '../../shared/task-state-machine'
import type { BatchImportTask } from '../../shared/types'
import { getSettingJson } from '../settings'
import { validateAndFilterPatch } from '../lib/patch-validation'

export interface BatchHandlersDeps {
  onStatusTerminal: (taskId: string, status: TaskStatus) => void | Promise<void>
  repo?: ISprintTaskRepository
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function parseBatchImportArgs(args: unknown[]): [BatchImportTask[]] {
  if (args.length !== 1) {
    throw new Error(`expected [tasks]; got ${args.length} args`)
  }
  const [tasks] = args
  if (!Array.isArray(tasks)) {
    throw new Error(`tasks must be an array; got ${typeof tasks}`)
  }
  tasks.forEach((item, i) => {
    if (!isPlainObject(item)) {
      throw new Error(`tasks[${i}] must be a plain object`)
    }
    if (typeof item.title !== 'string' || (item.title as string).trim() === '') {
      throw new Error(`tasks[${i}].title must be a non-empty string`)
    }
    if (typeof item.repo !== 'string' || (item.repo as string).trim() === '') {
      throw new Error(`tasks[${i}].repo must be a non-empty string`)
    }
  })
  return [tasks as unknown as BatchImportTask[]]
}

export function registerSprintBatchHandlers(deps: BatchHandlersDeps): void {
  const effectiveRepo = deps.repo ?? createSprintTaskRepository()

  type BatchOp = {
    op: 'update' | 'delete'
    id: string
    patch?: Record<string, unknown> | undefined
  }
  safeHandle('sprint:batchUpdate', async (_e, operations: BatchOp[]) => {
    const { GENERAL_PATCH_FIELDS } = await import('../../shared/types')
    const results: Array<{
      id: string
      op: 'update' | 'delete'
      ok: boolean
      error?: string | undefined
    }> = []

    for (const rawOp of operations) {
      const { id, op, patch } = rawOp
      if (!id || !op) {
        results.push({
          id: id ?? 'unknown',
          op: op as 'update' | 'delete',
          ok: false,
          error: 'id and op are required'
        })
        continue
      }
      try {
        if (op === 'update') {
          if (!patch || typeof patch !== 'object') {
            results.push({
              id,
              op: 'update',
              ok: false,
              error: 'patch object required for update'
            })
            continue
          }
          const filtered = validateAndFilterPatch(patch, GENERAL_PATCH_FIELDS)
          if (filtered === null) {
            results.push({ id, op: 'update', ok: false, error: 'No valid fields to update' })
            continue
          }

          // If transitioning to queued, validate spec quality
          if (filtered.status === 'queued') {
            const task = getTask(id)
            if (task) {
              try {
                const specText = (filtered.spec as string) ?? task.spec ?? null
                await validateTaskSpec({
                  title: task.title,
                  repo: task.repo,
                  spec: specText,
                  context: 'queue'
                })
              } catch (err) {
                results.push({
                  id,
                  op: 'update',
                  ok: false,
                  error: err instanceof Error ? err.message : String(err)
                })
                continue
              }
            }
          }

          // updateTask (service) handles notifySprintMutation internally
          const updated = await updateTask(id, filtered)
          if (
            updated &&
            typeof filtered.status === 'string' &&
            isTaskStatus(filtered.status) &&
            TERMINAL_STATUSES.has(filtered.status)
          ) {
            deps.onStatusTerminal(id, filtered.status)
          }
          results.push({
            id,
            op: 'update',
            ok: !!updated,
            error: updated ? undefined : 'Task not found'
          })
        } else if (op === 'delete') {
          // deleteTask (service) handles notifySprintMutation internally
          deleteTask(id)
          results.push({ id, op: 'delete', ok: true })
        } else {
          results.push({ id, op, ok: false, error: `Unknown operation: ${op}` })
        }
      } catch (err) {
        results.push({ id, op, ok: false, error: String(err) })
      }
    }

    return { results }
  })

  safeHandle('sprint:batchImport',
    async (_e, tasks: BatchImportTask[]) => {
      const { batchImportTasks } = await import('../services/batch-import')
      const reposConfig = getSettingJson<Array<{ name: string; localPath: string }>>('repos') ?? []
      const configuredRepos = reposConfig.map((r) => r.name.toLowerCase())
      return batchImportTasks(tasks, effectiveRepo, configuredRepos)
    },
    parseBatchImportArgs
  )
}
