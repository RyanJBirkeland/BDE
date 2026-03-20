/**
 * HTTP router for the TaskQueueAPI.
 * Routes requests to sprint-local functions and SSE handler.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { BrowserWindow } from 'electron'
import {
  getTask,
  listTasks,
  claimTask,
  updateTask,
  releaseTask,
  getQueueStats,
} from '../handlers/sprint-local'
import { addSseClient } from './sse'
import {
  RUNNER_WRITABLE_STATUSES,
  STATUS_UPDATE_FIELDS,
} from '../../shared/queue-api-contract'
import type { TaskOutputEvent } from '../../shared/queue-api-contract'
import { appendEvents } from './event-store'
import { getConfiguredRepos } from '../paths'
import type { SprintTask } from '../../shared/types'

/** Enrich a task with repo_path and gh_repo from BDE's repo settings. */
function enrichTask(task: SprintTask): SprintTask & { repo_path: string; gh_repo: string } {
  const repos = getConfiguredRepos()
  const match = repos.find((r) => r.name.toLowerCase() === task.repo.toLowerCase())
  return {
    ...task,
    repo_path: match?.localPath ?? '',
    gh_repo: match ? `${match.githubOwner}/${match.githubRepo}` : '',
  }
}

function enrichTasks(tasks: SprintTask[]): Array<SprintTask & { repo_path: string; gh_repo: string }> {
  return tasks.map(enrichTask)
}

const API_VERSION = '0.1.0'

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function errorResponse(res: ServerResponse, status: number, message: string): void {
  jsonResponse(res, status, { error: message })
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Extract pathname and query params from a URL string.
 */
function parseUrl(
  rawUrl: string | undefined
): { pathname: string; query: URLSearchParams } | null {
  if (!rawUrl) return null
  try {
    const url = new URL(rawUrl, 'http://localhost')
    return { pathname: url.pathname, query: url.searchParams }
  } catch {
    return null
  }
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const parsed = parseUrl(req.url)
  if (!parsed) {
    errorResponse(res, 400, 'Invalid URL')
    return
  }

  const { pathname, query } = parsed
  const method = req.method ?? 'GET'

  try {
    // GET /queue/health
    if (method === 'GET' && pathname === '/queue/health') {
      const stats = getQueueStats()
      jsonResponse(res, 200, { status: 'ok', version: API_VERSION, queue: stats })
      return
    }

    // GET /queue/events — SSE stream
    if (method === 'GET' && pathname === '/queue/events') {
      addSseClient(res)
      return
    }

    // GET /queue/tasks — list tasks with optional status filter
    if (method === 'GET' && pathname === '/queue/tasks') {
      const status = query.get('status') ?? undefined
      const tasks = listTasks(status)
      jsonResponse(res, 200, enrichTasks(tasks))
      return
    }

    // Match /queue/tasks/:id routes
    const taskIdMatch = pathname.match(/^\/queue\/tasks\/([^/]+)$/)
    const claimMatch = pathname.match(/^\/queue\/tasks\/([^/]+)\/claim$/)
    const releaseMatch = pathname.match(/^\/queue\/tasks\/([^/]+)\/release$/)
    const statusMatch = pathname.match(/^\/queue\/tasks\/([^/]+)\/status$/)
    const outputMatch = pathname.match(/^\/queue\/tasks\/([^/]+)\/output$/)

    // GET /queue/tasks/:id
    if (method === 'GET' && taskIdMatch) {
      const id = taskIdMatch[1]
      const task = getTask(id)
      if (!task) {
        errorResponse(res, 404, 'Task not found')
        return
      }
      jsonResponse(res, 200, enrichTask(task))
      return
    }

    // POST /queue/tasks/:id/claim
    if (method === 'POST' && claimMatch) {
      const id = claimMatch[1]
      let body: unknown
      try {
        body = await parseBody(req)
      } catch {
        errorResponse(res, 400, 'Invalid JSON')
        return
      }

      const executorId = (body as Record<string, unknown>)?.executorId
      if (typeof executorId !== 'string' || !executorId) {
        errorResponse(res, 400, 'Missing required field: executorId')
        return
      }

      const claimed = claimTask(id, executorId)
      if (claimed) {
        jsonResponse(res, 200, enrichTask(claimed))
        return
      }

      // Distinguish 404 vs 409
      const existing = getTask(id)
      if (!existing) {
        errorResponse(res, 404, 'Task not found')
      } else {
        errorResponse(res, 409, `Task is not claimable (current status: ${existing.status})`)
      }
      return
    }

    // POST /queue/tasks/:id/release — release an active task back to queued
    if (method === 'POST' && releaseMatch) {
      const id = releaseMatch[1]
      const existing = getTask(id)
      if (!existing) {
        errorResponse(res, 404, 'Task not found')
        return
      }
      if (existing.status !== 'active') {
        errorResponse(res, 409, `Cannot release task with status '${existing.status}' (must be active)`)
        return
      }
      const released = releaseTask(id)
      if (released) {
        jsonResponse(res, 200, released)
      } else {
        errorResponse(res, 500, 'Failed to release task')
      }
      return
    }

    // PATCH /queue/tasks/:id/status
    if (method === 'PATCH' && statusMatch) {
      const id = statusMatch[1]
      let body: unknown
      try {
        body = await parseBody(req)
      } catch {
        errorResponse(res, 400, 'Invalid JSON')
        return
      }

      const patch = body as Record<string, unknown>
      if (!patch || typeof patch !== 'object') {
        errorResponse(res, 400, 'Request body must be a JSON object')
        return
      }

      // Validate status field if present
      if ('status' in patch) {
        if (
          typeof patch.status !== 'string' ||
          !RUNNER_WRITABLE_STATUSES.has(patch.status)
        ) {
          errorResponse(
            res,
            400,
            `Invalid status value. Allowed: ${[...RUNNER_WRITABLE_STATUSES].join(', ')}`
          )
          return
        }
      }

      // Filter to allowed fields only
      const filteredPatch: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(patch)) {
        if (STATUS_UPDATE_FIELDS.has(key)) {
          filteredPatch[key] = value
        }
      }

      if (Object.keys(filteredPatch).length === 0) {
        errorResponse(res, 400, 'No valid fields in request body')
        return
      }

      // Check task exists
      const existing = getTask(id)
      if (!existing) {
        errorResponse(res, 404, 'Task not found')
        return
      }

      const updated = updateTask(id, filteredPatch)
      if (updated) {
        jsonResponse(res, 200, updated)
      } else {
        errorResponse(res, 500, 'Failed to update task')
      }
      return
    }

    // POST /queue/tasks/:id/output
    if (method === 'POST' && outputMatch) {
      const id = outputMatch[1]
      let body: unknown
      try {
        body = await parseBody(req)
      } catch {
        errorResponse(res, 400, 'Invalid JSON')
        return
      }

      const payload = body as Record<string, unknown>
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
        errorResponse(res, 400, 'Body must contain a non-empty "events" array')
        return
      }

      const events = payload.events as TaskOutputEvent[]
      if (events.length === 0) {
        errorResponse(res, 400, 'Body must contain a non-empty "events" array')
        return
      }

      // Validate each event has required fields and taskId matches URL
      for (const ev of events) {
        if (!ev.taskId || !ev.timestamp || !ev.type) {
          errorResponse(res, 400, 'Each event must have taskId, timestamp, and type')
          return
        }
        if (ev.taskId !== id) {
          errorResponse(res, 400, `Event taskId "${ev.taskId}" does not match URL taskId "${id}"`)
          return
        }
      }

      // Check task exists
      const existing = getTask(id)
      if (!existing) {
        errorResponse(res, 404, 'Task not found')
        return
      }

      appendEvents(id, events)

      // Broadcast to all renderer windows
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('task:output', { taskId: id, events })
      }

      jsonResponse(res, 200, { received: events.length })
      return
    }

    // No route matched
    errorResponse(res, 404, 'Not found')
  } catch (err) {
    console.error('[queue-api] unexpected error:', err)
    errorResponse(res, 500, 'Internal server error')
  }
}
