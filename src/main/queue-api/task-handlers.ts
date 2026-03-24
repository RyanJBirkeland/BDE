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
  claimTask,
  releaseTask,
} from '../data/sprint-queries'
import type { StatusUpdateRequest, ClaimRequest } from '../../shared/queue-api-contract'
import { STATUS_UPDATE_FIELDS, RUNNER_WRITABLE_STATUSES, GENERAL_PATCH_FIELDS } from '../../shared/queue-api-contract'
import { toCamelCase, toSnakeCase } from './field-mapper'

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

  const { title, repo } = body as Record<string, unknown>
  if (typeof title !== 'string' || !title.trim()) {
    sendJson(res, 400, { error: 'title is required' })
    return
  }
  if (typeof repo !== 'string' || !repo.trim()) {
    sendJson(res, 400, { error: 'repo is required' })
    return
  }

  const task = await createTask(body as Parameters<typeof createTask>[0])
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

  const claimed = await claimTask(id, executorId)
  if (!claimed) {
    sendJson(res, 409, { error: `Task ${id} is not claimable (not queued or does not exist)` })
    return
  }
  sendJson(res, 200, toCamelCase(claimed))
}

export async function handleRelease(
  res: http.ServerResponse,
  id: string
): Promise<void> {
  const released = await releaseTask(id)
  if (!released) {
    sendJson(res, 409, { error: `Task ${id} is not releasable (not active or does not exist)` })
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
  }

  // TODO: Add cycle detection validation here
  // This requires access to the dependency index, which would need to be passed in
  // or imported from agent-manager. For now, we'll allow the update and rely on
  // the agent-manager to handle invalid graphs gracefully.

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
