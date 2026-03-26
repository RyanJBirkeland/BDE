/**
 * Queue API handlers for task CRUD operations.
 */
import type http from 'node:http'
import { sendJson, parseBody } from './helpers'
import {
  getQueueStats,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  claimTask,
  releaseTask,
  getTasksWithDependencies,
  getActiveTaskCount,
} from '../data/sprint-queries'
import type { StatusUpdateRequest, ClaimRequest, BatchResult } from '../../shared/queue-api-contract'
import { STATUS_UPDATE_FIELDS, RUNNER_WRITABLE_STATUSES, GENERAL_PATCH_FIELDS, MAX_ACTIVE_TASKS } from '../../shared/queue-api-contract'
import { toCamelCase, toSnakeCase } from './field-mapper'
import { detectCycle, createDependencyIndex } from '../agent-manager/dependency-index'
import { buildBlockedNotes, checkTaskDependencies } from '../agent-manager/dependency-helpers'
import { resolveDependents } from '../agent-manager/resolve-dependents'
import type { TaskDependency } from '../../shared/types'
import { validateStructural } from '../../shared/spec-validation'
import { checkSpecSemantic } from '../spec-semantic-check'

/**
 * Validates task dependencies for cycle detection and ID existence.
 * Returns error message if validation fails, null if valid.
 */
async function validateDependencies(
  taskId: string,
  dependsOn: TaskDependency[]
): Promise<string | null> {
  // Check for empty dependencies
  if (dependsOn.length === 0) {
    return null
  }

  // Fetch all existing tasks for validation
  const allTasks = await getTasksWithDependencies()
  const existingTaskIds = new Set(allTasks.map(t => t.id))

  // Add the current task ID to the set for self-reference detection
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
  const depsMap = new Map<string, TaskDependency[]>()
  for (const task of allTasks) {
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
  const stats = await getQueueStats()
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
      error: stats.error,
    },
  })
}

export async function handleListTasks(
  res: http.ServerResponse,
  query: URLSearchParams
): Promise<void> {
  const status = query.get('status') ?? undefined
  const tasks = await listTasks(status)
  sendJson(res, 200, tasks.map(toCamelCase))
}

export async function handleGetTask(
  res: http.ServerResponse,
  id: string
): Promise<void> {
  const task = await getTask(id)
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

  const { title, repo, depends_on } = body as Record<string, unknown>
  if (typeof title !== 'string' || !title.trim()) {
    sendJson(res, 400, { error: 'title is required' })
    return
  }
  if (typeof repo !== 'string' || !repo.trim()) {
    sendJson(res, 400, { error: 'repo is required' })
    return
  }

  // Structural spec validation
  const bodyObj = body as Record<string, unknown>
  const { spec } = bodyObj
  const structural = validateStructural({
    title: title as string,
    repo: repo as string,
    spec: typeof spec === 'string' ? spec : null,
    status: typeof bodyObj.status === 'string' ? bodyObj.status : 'backlog',
  })
  if (!structural.valid) {
    sendJson(res, 400, { error: 'Spec quality checks failed', details: structural.errors })
    return
  }

  // If creating with status=queued, also run semantic checks
  if (bodyObj.status === 'queued' && typeof spec === 'string') {
    const url = new URL(req.url ?? '', 'http://localhost')
    const skipValidation = url.searchParams.get('skipValidation') === 'true'
    if (!skipValidation) {
      const semantic = await checkSpecSemantic({
        title: title as string,
        repo: repo as string,
        spec: spec as string,
      })
      if (!semantic.passed) {
        sendJson(res, 400, {
          error: 'Cannot create task with queued status — semantic checks failed',
          details: semantic.failMessages,
        })
        return
      }
    }
  }

  // Validate depends_on if provided
  if (depends_on !== null && depends_on !== undefined) {
    if (!Array.isArray(depends_on)) {
      sendJson(res, 400, { error: 'depends_on must be an array or null' })
      return
    }

    for (const dep of depends_on) {
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

  // Validate dependencies for cycles and non-existent IDs BEFORE creating the task
  // (eliminates the need for rollback if validation fails)
  const createInput = body as Record<string, unknown>
  const dependsOn = createInput.depends_on as Array<{ id: string; type: 'hard' | 'soft' }> | undefined
  const PENDING_TASK_ID = 'pending-new-task'
  if (dependsOn && dependsOn.length > 0) {
    const validationError = await validateDependencies(PENDING_TASK_ID, dependsOn as TaskDependency[])
    if (validationError) {
      sendJson(res, 400, { error: validationError })
      return
    }
  }

  // Auto-block tasks with unsatisfied hard dependencies before creation
  // (matches sprint:create IPC behavior — check deps, set status=blocked if needed)
  if (dependsOn && dependsOn.length > 0 && (createInput.status === 'queued' || !createInput.status)) {
    const { shouldBlock, blockedBy } = await checkTaskDependencies(
      PENDING_TASK_ID,
      dependsOn,
      console,
    )
    if (shouldBlock) {
      createInput.status = 'blocked'
      createInput.notes = buildBlockedNotes(blockedBy, createInput.notes as string | null)
    }
  }

  // Create the task (with potentially auto-blocked status)
  const task = await createTask(createInput as unknown as Parameters<typeof createTask>[0])
  if (!task) {
    sendJson(res, 500, { error: 'Failed to create task' })
    return
  }

  sendJson(res, 201, toCamelCase(task))
}

export async function handleUpdateTask(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
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
  for (const [k, v] of Object.entries(raw)) {
    if (GENERAL_PATCH_FIELDS.has(k)) {
      filtered[k] = v
    }
  }

  if (Object.keys(filtered).length === 0) {
    sendJson(res, 400, { error: 'No valid fields to update' })
    return
  }

  const snaked = toSnakeCase(filtered)
  let updated: Awaited<ReturnType<typeof updateTask>>
  try {
    updated = await updateTask(id, snaked)
  } catch (err) {
    sendJson(res, 500, { error: `Failed to update task ${id}: ${err instanceof Error ? err.message : String(err)}` })
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
  if (patch.status && !RUNNER_WRITABLE_STATUSES.has(patch.status)) {
    sendJson(res, 400, { error: `Invalid status: ${patch.status}` })
    return
  }

  // If transitioning to queued, run spec quality checks (unless skipValidation=true)
  if (patch.status === 'queued') {
    const url = new URL(req.url ?? '', 'http://localhost')
    const skipValidation = url.searchParams.get('skipValidation') === 'true'

    if (!skipValidation) {
      // Fetch the task to get its spec
      const task = await getTask(id)
      if (!task) {
        sendJson(res, 404, { error: `Task ${id} not found` })
        return
      }

      // Run structural checks first (fast, synchronous)
      const structural = validateStructural({
        title: task.title,
        repo: task.repo,
        spec: task.spec,
      })
      if (!structural.valid) {
        sendJson(res, 400, {
          error: 'Cannot queue task — spec quality checks failed',
          details: structural.errors,
        })
        return
      }

      // Run semantic checks (async, calls Claude CLI)
      if (task.spec) {
        const semantic = await checkSpecSemantic({
          title: task.title,
          repo: task.repo,
          spec: task.spec,
        })
        if (!semantic.passed) {
          sendJson(res, 400, {
            error: 'Cannot queue task — semantic spec checks failed',
            details: semantic.failMessages,
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
    updated = await updateTask(id, toSnakeCase(filtered))
  } catch (err) {
    sendJson(res, 500, { error: `Failed to update task status ${id}: ${err instanceof Error ? err.message : String(err)}` })
    return
  }
  if (!updated) {
    sendJson(res, 404, { error: `Task ${id} not found` })
    return
  }
  sendJson(res, 200, toCamelCase(updated))

  // Trigger dependency resolution when transitioning to a terminal status.
  // This ensures blocked dependents get unblocked even when status is changed
  // via Queue API (not just via agent manager or IPC handler).
  const terminalStatuses = new Set(['done', 'failed', 'error', 'cancelled'])
  if (patch.status && terminalStatuses.has(patch.status)) {
    try {
      const allTasks = await getTasksWithDependencies()
      const depIndex = createDependencyIndex()
      depIndex.rebuild(allTasks)
      await resolveDependents(id, patch.status, depIndex, getTask, updateTask, console)
    } catch (resolveErr) {
      console.warn(`[queue-api] resolveDependents failed for ${id}: ${resolveErr}`)
    }
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

  // Enforce WIP limit — prevent more than MAX_ACTIVE_TASKS active tasks.
  // Note: TOCTOU race exists between this check and claimTask() below.
  // Acceptable because BDE's drain loop is the primary caller and runs
  // sequentially. For true atomicity, this would need a Supabase RPC.
  const activeCount = await getActiveTaskCount()
  if (activeCount >= MAX_ACTIVE_TASKS) {
    sendJson(res, 409, {
      error: `WIP limit reached (${activeCount}/${MAX_ACTIVE_TASKS} active tasks). Complete or cancel an active task first.`
    })
    return
  }

  const claimed = await claimTask(id, executorId)
  if (!claimed) {
    sendJson(res, 409, { error: `Task ${id} is not claimable (not queued or does not exist)` })
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

  const claimedBy = (body as Record<string, unknown>).claimed_by as string
  if (typeof claimedBy !== 'string' || !claimedBy.trim()) {
    sendJson(res, 400, { error: 'claimed_by is required for release' })
    return
  }

  const released = await releaseTask(id, claimedBy)
  if (!released) {
    sendJson(res, 409, { error: `Task ${id} is not releasable (not active, not owned by caller, or does not exist)` })
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

  // Validate dependsOn structure
  if (dependsOn !== null && dependsOn !== undefined) {
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
    const validationError = await validateDependencies(id, dependsOn as TaskDependency[])
    if (validationError) {
      sendJson(res, 400, { error: validationError })
      return
    }
  }

  const snaked = toSnakeCase({ dependsOn })
  let updated: Awaited<ReturnType<typeof updateTask>>
  try {
    updated = await updateTask(id, snaked)
  } catch (err) {
    sendJson(res, 500, { error: `Failed to update task dependencies ${id}: ${err instanceof Error ? err.message : String(err)}` })
    return
  }
  if (!updated) {
    sendJson(res, 404, { error: `Task ${id} not found` })
    return
  }
  sendJson(res, 200, toCamelCase(updated))
}

export async function handleBatchTasks(
  req: http.IncomingMessage,
  res: http.ServerResponse,
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

  const results: BatchResult[] = []

  for (const rawOp of operations) {
    const op = rawOp as Record<string, unknown>
    const id = op.id as string
    const opType = op.op as string

    if (!id || !opType) {
      results.push({ id: id ?? 'unknown', op: opType as 'update' | 'delete', ok: false, error: 'id and op are required' })
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
        const updated = await updateTask(id, toSnakeCase(filtered))
        results.push({ id, op: 'update', ok: !!updated, error: updated ? undefined : 'Task not found' })
      } else if (opType === 'delete') {
        await deleteTask(id)
        results.push({ id, op: 'delete', ok: true })
      } else {
        results.push({ id, op: opType as 'update' | 'delete', ok: false, error: `Unknown operation: ${opType}` })
      }
    } catch (err) {
      results.push({ id, op: opType as 'update' | 'delete', ok: false, error: String(err) })
    }
  }

  // Return 200 with per-operation results (some may have failed)
  sendJson(res, 200, { results })
}
