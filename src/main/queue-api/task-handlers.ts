/**
 * Queue API handlers for task CRUD operations.
 */
import type http from 'node:http'
import { sendJson, parseBody } from './helpers'
import { createLogger } from '../logger'
import {
  getQueueStats,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  claimTask,
  releaseTask,
  getAllTaskIds,
  getTasksWithDependencies,
  getActiveTaskCount
} from '../data/sprint-queries'
import { getDb } from '../db'
import type {
  StatusUpdateRequest,
  ClaimRequest,
  BatchResult
} from '../../shared/queue-api-contract'
import {
  STATUS_UPDATE_FIELDS,
  RUNNER_WRITABLE_STATUSES,
  GENERAL_PATCH_FIELDS,
  MAX_ACTIVE_TASKS
} from '../../shared/queue-api-contract'
import { toCamelCase, toSnakeCase } from './field-mapper'
import { detectCycle } from '../agent-manager/dependency-index'
import type { TaskDependency } from '../../shared/types'
import { validateStructural } from '../../shared/spec-validation'
import { checkSpecSemantic } from '../spec-semantic-check'
import { validateTaskCreation } from '../services/task-validation'

const logger = createLogger('queue-api:tasks')

let _onStatusTerminal: ((taskId: string, status: string) => void) | null = null

export function setQueueApiOnStatusTerminal(fn: (taskId: string, status: string) => void): void {
  _onStatusTerminal = fn
}

/**
 * Validates task dependencies for cycle detection and ID existence.
 * Returns error message if validation fails, null if valid.
 */
function validateDependencies(taskId: string, dependsOn: TaskDependency[]): string | null {
  // Check for empty dependencies
  if (dependsOn.length === 0) {
    return null
  }

  // Fetch all task IDs for existence validation
  const existingTaskIds = getAllTaskIds()
  existingTaskIds.add(taskId)

  // Validate that all referenced task IDs exist
  const missingIds: string[] = []
  for (const dep of dependsOn) {
    if (!existingTaskIds.has(dep.id)) {
      missingIds.push(dep.id)
    }
  }

  if (missingIds.length > 0) {
    return `Referenced task IDs do not exist: ${missingIds.join(', ')}`
  }

  // Build dependency lookup for cycle detection
  const tasksWithDeps = getTasksWithDependencies()
  const depsMap = new Map<string, TaskDependency[]>()
  for (const task of tasksWithDeps) {
    if (task.depends_on) {
      depsMap.set(task.id, task.depends_on)
    }
  }

  const getDepsForTask = (id: string): TaskDependency[] | null => {
    return depsMap.get(id) ?? null
  }

  // Detect cycles (including self-reference)
  const cycle = detectCycle(taskId, dependsOn, getDepsForTask)
  if (cycle) {
    return `Dependency cycle detected: ${cycle.join(' → ')}`
  }

  return null
}

export async function handleHealth(res: http.ServerResponse): Promise<void> {
  // QA-16: Wrap in try-catch for consistent error handling
  try {
    const stats = getQueueStats()
    sendJson(res, 200, {
      status: 'ok',
      version: '1.0.0',
      queue: {
        backlog: stats.backlog,
        queued: stats.queued,
        blocked: stats.blocked,
        active: stats.active,
        done: stats.done,
        failed: stats.failed,
        cancelled: stats.cancelled,
        error: stats.error
      }
    })
  } catch (err) {
    sendJson(res, 500, {
      error: 'Failed to get queue stats',
      details: err instanceof Error ? err.message : String(err)
    })
  }
}

export async function handleListTasks(
  res: http.ServerResponse,
  query: URLSearchParams
): Promise<void> {
  const statusParam = query.get('status')
  const status = statusParam ?? undefined

  // QA-19: Validate status parameter if provided
  if (statusParam !== null) {
    const validStatuses = new Set([
      'backlog',
      'queued',
      'blocked',
      'active',
      'done',
      'failed',
      'error',
      'cancelled'
    ])
    if (!validStatuses.has(statusParam)) {
      sendJson(res, 400, { error: `Invalid status: ${statusParam}` })
      return
    }
  }

  const tasks = listTasks(status)
  sendJson(res, 200, tasks.map(toCamelCase))
}

export async function handleGetTask(res: http.ServerResponse, id: string): Promise<void> {
  const task = getTask(id)
  if (!task) {
    sendJson(res, 404, { error: `Task ${id} not found` })
    return
  }
  sendJson(res, 200, toCamelCase(task))
}

export async function handleCreateTask(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  const { title, repo, depends_on, dependsOn: dependsOnCamel } = body as Record<string, unknown>
  const resolvedDeps = depends_on ?? dependsOnCamel
  if (typeof title !== 'string' || !title.trim()) {
    sendJson(res, 400, { error: 'title is required' })
    return
  }
  if (typeof repo !== 'string' || !repo.trim()) {
    sendJson(res, 400, { error: 'repo is required' })
    return
  }

  // Normalize body so depends_on is always set (supports both snake_case and camelCase from callers)
  const bodyObj: Record<string, unknown> = {
    ...(body as Record<string, unknown>),
    depends_on: resolvedDeps
  }
  const { spec } = bodyObj
  const validation = validateTaskCreation(bodyObj as unknown as Parameters<typeof createTask>[0], {
    logger: { warn: (...args: unknown[]) => logger.warn(String(args[0])) }
  })
  if (!validation.valid) {
    sendJson(res, 400, { error: 'Spec quality checks failed', details: validation.errors })
    return
  }

  // Queue API-specific: semantic checks when creating with status=queued
  if (bodyObj.status === 'queued' && typeof spec === 'string') {
    const url = new URL(req.url ?? '', 'http://localhost')
    const skipValidation = url.searchParams.get('skipValidation') === 'true'
    // QA-8: Log when validation is bypassed for audit trail
    if (skipValidation) {
      logger.warn(`Spec validation bypassed for new task: ${title} (skipValidation=true)`)
    }
    if (!skipValidation) {
      const semantic = await checkSpecSemantic({
        title: title as string,
        repo: repo as string,
        spec: spec as string
      })
      if (!semantic.passed) {
        sendJson(res, 400, {
          error: 'Cannot create task with queued status — semantic checks failed',
          details: semantic.failMessages
        })
        return
      }
    }
  }

  // Queue API-specific: validate depends_on shape
  if (resolvedDeps !== null && resolvedDeps !== undefined) {
    if (!Array.isArray(resolvedDeps)) {
      sendJson(res, 400, { error: 'depends_on must be an array or null' })
      return
    }

    for (const dep of resolvedDeps) {
      if (!dep || typeof dep !== 'object') {
        sendJson(res, 400, { error: 'Each dependency must be an object' })
        return
      }
      const { id: depId, type } = dep as Record<string, unknown>
      if (typeof depId !== 'string' || !depId.trim()) {
        sendJson(res, 400, { error: 'Each dependency must have a valid id' })
        return
      }
      if (type !== 'hard' && type !== 'soft') {
        sendJson(res, 400, { error: 'Each dependency type must be "hard" or "soft"' })
        return
      }
    }
  }

  // Queue API-specific: validate dependencies for cycles and non-existent IDs
  const resolvedDepsTyped = resolvedDeps as Array<{ id: string; type: 'hard' | 'soft' }> | undefined
  const PENDING_TASK_ID = 'pending-new-task'
  if (resolvedDepsTyped && resolvedDepsTyped.length > 0) {
    const validationError = validateDependencies(
      PENDING_TASK_ID,
      resolvedDepsTyped as TaskDependency[]
    )
    if (validationError) {
      sendJson(res, 400, { error: validationError })
      return
    }
  }

  // Create the task (with potentially auto-blocked status from shared validation)
  const task = createTask(validation.task as unknown as Parameters<typeof createTask>[0])
  if (!task) {
    sendJson(res, 500, { error: 'Failed to create task' })
    return
  }

  sendJson(res, 201, toCamelCase(task))
}

export async function handleUpdateTask(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  // Filter to safe fields only — status, claimed_by, depends_on must use dedicated endpoints
  const raw = body as Record<string, unknown>
  const filtered: Record<string, unknown> = {}
  const disallowed: string[] = [] // QA-14: Track disallowed fields to inform client

  for (const [k, v] of Object.entries(raw)) {
    if (GENERAL_PATCH_FIELDS.has(k)) {
      filtered[k] = v
    } else {
      disallowed.push(k)
    }
  }

  // QA-14: Return 400 when disallowed fields are present
  if (disallowed.length > 0) {
    sendJson(res, 400, {
      error: `Disallowed fields: ${disallowed.join(', ')}. Use dedicated endpoints for status, claimed_by, or depends_on.`
    })
    return
  }

  if (Object.keys(filtered).length === 0) {
    sendJson(res, 400, { error: 'No valid fields to update' })
    return
  }

  const snaked = toSnakeCase(filtered)
  let updated: Awaited<ReturnType<typeof updateTask>>
  try {
    updated = updateTask(id, snaked)
  } catch (err) {
    sendJson(res, 500, {
      error: `Failed to update task ${id}: ${err instanceof Error ? err.message : String(err)}`
    })
    return
  }
  if (!updated) {
    sendJson(res, 404, { error: `Task ${id} not found` })
    return
  }
  sendJson(res, 200, toCamelCase(updated))
}

export async function handleUpdateStatus(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  const patch = body as StatusUpdateRequest

  // QA-10: Validate that status field is present and valid
  if (!patch.status) {
    sendJson(res, 400, { error: 'status field is required' })
    return
  }

  if (!RUNNER_WRITABLE_STATUSES.has(patch.status)) {
    sendJson(res, 400, { error: `Invalid status: ${patch.status}` })
    return
  }

  // If transitioning to queued, run spec quality checks (unless skipValidation=true)
  if (patch.status === 'queued') {
    const url = new URL(req.url ?? '', 'http://localhost')
    const skipValidation = url.searchParams.get('skipValidation') === 'true'

    // QA-8: Log when validation is bypassed for audit trail
    if (skipValidation) {
      logger.warn(`Spec validation bypassed for task ${id} status update (skipValidation=true)`)
    }

    if (!skipValidation) {
      // Fetch the task to get its spec
      const task = getTask(id)
      if (!task) {
        sendJson(res, 404, { error: `Task ${id} not found` })
        return
      }

      // Run structural checks first (fast, synchronous)
      const structural = validateStructural({
        title: task.title,
        repo: task.repo,
        spec: task.spec
      })
      if (!structural.valid) {
        sendJson(res, 400, {
          error: 'Cannot queue task — spec quality checks failed',
          details: structural.errors
        })
        return
      }

      // Run semantic checks (async, calls Claude CLI)
      if (task.spec) {
        const semantic = await checkSpecSemantic({
          title: task.title,
          repo: task.repo,
          spec: task.spec
        })
        if (!semantic.passed) {
          sendJson(res, 400, {
            error: 'Cannot queue task — semantic spec checks failed',
            details: semantic.failMessages
          })
          return
        }
      }
    }
  }

  // Filter to allowed fields only
  const filtered: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (STATUS_UPDATE_FIELDS.has(k)) {
      filtered[k] = v
    }
  }

  if (Object.keys(filtered).length === 0) {
    sendJson(res, 400, { error: 'No valid fields to update' })
    return
  }

  let updated: Awaited<ReturnType<typeof updateTask>>
  try {
    updated = updateTask(id, toSnakeCase(filtered))
  } catch (err) {
    sendJson(res, 500, {
      error: `Failed to update task status ${id}: ${err instanceof Error ? err.message : String(err)}`
    })
    return
  }
  if (!updated) {
    sendJson(res, 404, { error: `Task ${id} not found` })
    return
  }
  sendJson(res, 200, toCamelCase(updated))

  // Trigger dependency resolution when transitioning to a terminal status.
  const terminalStatuses = new Set(['done', 'failed', 'error', 'cancelled'])
  if (patch.status && terminalStatuses.has(patch.status)) {
    _onStatusTerminal?.(id, patch.status)
  }
}

export async function handleClaim(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  const { executorId } = body as ClaimRequest
  if (typeof executorId !== 'string' || !executorId.trim()) {
    sendJson(res, 400, { error: 'executorId is required' })
    return
  }

  // Enforce WIP limit atomically inside claimTask() via a single SQL transaction.
  // This eliminates the TOCTOU race between the count check and the UPDATE.
  const claimed = claimTask(id, executorId, MAX_ACTIVE_TASKS)
  if (!claimed) {
    // Distinguish WIP limit from task-not-claimable for a useful error message.
    const activeCount = getActiveTaskCount()
    if (activeCount >= MAX_ACTIVE_TASKS) {
      sendJson(res, 409, {
        error: `WIP limit reached (${activeCount}/${MAX_ACTIVE_TASKS} active tasks). Complete or cancel an active task first.`
      })
    } else {
      sendJson(res, 409, { error: `Task ${id} is not claimable (not queued or does not exist)` })
    }
    return
  }
  sendJson(res, 200, toCamelCase(claimed))
}

export async function handleRelease(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  const claimedBy = (body as Record<string, unknown>).claimedBy as string
  if (typeof claimedBy !== 'string' || !claimedBy.trim()) {
    sendJson(res, 400, { error: 'claimedBy is required for release' })
    return
  }

  const released = releaseTask(id, claimedBy)
  if (!released) {
    sendJson(res, 409, {
      error: `Task ${id} is not releasable (not active, not owned by caller, or does not exist)`
    })
    return
  }
  sendJson(res, 200, toCamelCase(released))
}

export async function handleUpdateDependencies(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  const { dependsOn } = body as { dependsOn?: unknown }

  // QA-23: Reject undefined dependsOn (must be null or array)
  if (dependsOn === undefined) {
    sendJson(res, 400, { error: 'dependsOn field is required (use null or array)' })
    return
  }

  // Validate dependsOn structure
  if (dependsOn !== null) {
    if (!Array.isArray(dependsOn)) {
      sendJson(res, 400, { error: 'dependsOn must be an array or null' })
      return
    }

    for (const dep of dependsOn) {
      if (!dep || typeof dep !== 'object') {
        sendJson(res, 400, { error: 'Each dependency must be an object' })
        return
      }
      const { id: depId, type } = dep as Record<string, unknown>
      if (typeof depId !== 'string' || !depId.trim()) {
        sendJson(res, 400, { error: 'Each dependency must have a valid id' })
        return
      }
      if (type !== 'hard' && type !== 'soft') {
        sendJson(res, 400, { error: 'Each dependency type must be "hard" or "soft"' })
        return
      }
    }

    // Validate dependencies (cycle detection + ID existence)
    const validationError = validateDependencies(id, dependsOn as TaskDependency[])
    if (validationError) {
      sendJson(res, 400, { error: validationError })
      return
    }
  }

  const snaked = toSnakeCase({ dependsOn })
  let updated: Awaited<ReturnType<typeof updateTask>>
  try {
    updated = updateTask(id, snaked)
  } catch (err) {
    sendJson(res, 500, {
      error: `Failed to update task dependencies ${id}: ${err instanceof Error ? err.message : String(err)}`
    })
    return
  }
  if (!updated) {
    sendJson(res, 404, { error: `Task ${id} not found` })
    return
  }
  sendJson(res, 200, toCamelCase(updated))
}

// QA-15: Individual DELETE endpoint for tasks
export async function handleDeleteTask(res: http.ServerResponse, id: string): Promise<void> {
  try {
    const existing = getTask(id)
    if (!existing) {
      sendJson(res, 404, { error: `Task ${id} not found` })
      return
    }
    deleteTask(id)
    sendJson(res, 200, { ok: true, id })
  } catch (err) {
    sendJson(res, 500, {
      error: `Failed to delete task ${id}: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}

// QA-5: Batch operations have no per-task authorization granularity.
// All operations in the batch are executed with the same API key's permissions.
// For fine-grained access control, use individual endpoints instead.
export async function handleBatchTasks(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  const { operations } = body as { operations?: unknown[] }
  if (!Array.isArray(operations) || operations.length === 0) {
    sendJson(res, 400, { error: 'operations array is required and must not be empty' })
    return
  }

  if (operations.length > 50) {
    sendJson(res, 400, { error: 'Maximum 50 operations per batch' })
    return
  }

  const db = getDb()
  const results: BatchResult[] = []

  // Function to execute all batch operations
  const executeBatchOperations = (): void => {
    for (const rawOp of operations) {
      const op = rawOp as Record<string, unknown>
      const id = op.id as string
      const opType = op.op as string

      if (!id || !opType) {
        results.push({
          id: id ?? 'unknown',
          op: opType as 'update' | 'delete',
          ok: false,
          error: 'id and op are required'
        })
        continue
      }

      try {
        if (opType === 'update') {
          const patch = op.patch as Record<string, unknown>
          if (!patch || typeof patch !== 'object') {
            results.push({ id, op: 'update', ok: false, error: 'patch object required for update' })
            continue
          }
          // Filter to safe fields (same as GENERAL_PATCH_FIELDS)
          const filtered: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(patch)) {
            if (GENERAL_PATCH_FIELDS.has(k)) filtered[k] = v
          }
          if (Object.keys(filtered).length === 0) {
            results.push({ id, op: 'update', ok: false, error: 'No valid fields to update' })
            continue
          }
          const updated = updateTask(id, toSnakeCase(filtered))
          results.push({
            id,
            op: 'update',
            ok: !!updated,
            error: updated ? undefined : 'Task not found'
          })
        } else if (opType === 'delete') {
          deleteTask(id)
          results.push({ id, op: 'delete', ok: true })
        } else {
          results.push({
            id,
            op: opType as 'update' | 'delete',
            ok: false,
            error: `Unknown operation: ${opType}`
          })
        }
      } catch (err) {
        results.push({ id, op: opType as 'update' | 'delete', ok: false, error: String(err) })
      }
    }
  }

  // Wrap all batch operations in a transaction to ensure atomicity
  // If db.transaction is available (real database), use it. Otherwise (mocked), execute directly.
  try {
    if (db && typeof db.transaction === 'function') {
      const executeBatch = db.transaction(executeBatchOperations)
      executeBatch()
    } else {
      executeBatchOperations()
    }
  } catch (err) {
    sendJson(res, 500, { error: `Batch operation failed: ${err}` })
    return
  }

  // QA-31: Returns 200 with per-operation status — clients inspect individual result.ok fields
  sendJson(res, 200, { results })
}
