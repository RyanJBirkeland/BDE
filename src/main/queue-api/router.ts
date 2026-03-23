/**
 * Queue API request router and endpoint handlers.
 * Each endpoint proxies to the sprint-queries Supabase functions.
 */
import type http from 'node:http'
import { getSetting } from '../settings'
import { createSseBroadcaster } from './sse-broadcaster'
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
import { STATUS_UPDATE_FIELDS, RUNNER_WRITABLE_STATUSES } from '../../shared/queue-api-contract'
import { toCamelCase, toSnakeCase } from './field-mapper'

const sseBroadcaster = createSseBroadcaster()
export { sseBroadcaster }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string | null {
  return getSetting('taskRunner.apiKey') ?? process.env['SPRINT_API_KEY'] ?? null
}

function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const apiKey = getApiKey()
  if (!apiKey) {
    // No key configured — allow all requests (dev/testing convenience)
    return true
  }

  // Accept token from Authorization header or ?token= query parameter
  const authHeader = req.headers['authorization']
  let token: string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    // Fall back to ?token= query param (used by SSE clients)
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const queryToken = url.searchParams.get('token')
    if (queryToken) {
      token = queryToken
    }
  }

  if (!token) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization header' })
    return false
  }

  if (token !== apiKey) {
    sendJson(res, 403, { error: 'Invalid API key' })
    return false
  }

  return true
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const MAX_BODY_SIZE = 5 * 1024 * 1024 // 5 MB

function parseBody(req: http.IncomingMessage, res?: http.ServerResponse): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy()
        if (res) {
          sendJson(res, 413, { error: 'Payload too large' })
        }
        reject(new Error('Payload too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** Parse URL path and return { path, query } */
function parseUrl(req: http.IncomingMessage): { path: string; query: URLSearchParams } {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  return { path: url.pathname, query: url.searchParams }
}

/** Match a route pattern like /queue/tasks/:id against a path */
function matchRoute(
  pattern: string,
  path: string
): Record<string, string> | null {
  const patternParts = pattern.split('/')
  const pathParts = path.split('/')

  if (patternParts.length !== pathParts.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = pathParts[i]
    } else if (patternParts[i] !== pathParts[i]) {
      return null
    }
  }
  return params
}

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

export async function route(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    })
    res.end()
    return
  }

  // Auth check
  if (!checkAuth(req, res)) return

  const { path, query } = parseUrl(req)
  const method = req.method ?? 'GET'

  // --- GET /queue/health ---
  if (method === 'GET' && path === '/queue/health') {
    return handleHealth(res)
  }

  // --- GET /queue/tasks ---
  if (method === 'GET' && path === '/queue/tasks') {
    return handleListTasks(res, query)
  }

  // --- POST /queue/tasks ---
  if (method === 'POST' && path === '/queue/tasks') {
    return handleCreateTask(req, res)
  }

  // --- GET /queue/events (SSE) ---
  if (method === 'GET' && path === '/queue/events') {
    return handleEvents(req, res)
  }

  // --- Routes with :id ---
  let params: Record<string, string> | null

  // GET /queue/tasks/:id
  params = matchRoute('/queue/tasks/:id', path)
  if (method === 'GET' && params) {
    return handleGetTask(res, params['id'])
  }

  // PATCH /queue/tasks/:id — general field update
  params = matchRoute('/queue/tasks/:id', path)
  if (method === 'PATCH' && params) {
    return handleUpdateTask(req, res, params['id'])
  }

  // PATCH /queue/tasks/:id/status
  params = matchRoute('/queue/tasks/:id/status', path)
  if (method === 'PATCH' && params) {
    return handleUpdateStatus(req, res, params['id'])
  }

  // POST /queue/tasks/:id/claim
  params = matchRoute('/queue/tasks/:id/claim', path)
  if (method === 'POST' && params) {
    return handleClaim(req, res, params['id'])
  }

  // POST /queue/tasks/:id/release
  params = matchRoute('/queue/tasks/:id/release', path)
  if (method === 'POST' && params) {
    return handleRelease(res, params['id'])
  }

  // POST /queue/tasks/:id/output
  params = matchRoute('/queue/tasks/:id/output', path)
  if (method === 'POST' && params) {
    return handleTaskOutput(req, res, params['id'])
  }

  // 404
  sendJson(res, 404, { error: 'Not found' })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleHealth(res: http.ServerResponse): Promise<void> {
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

async function handleListTasks(
  res: http.ServerResponse,
  query: URLSearchParams
): Promise<void> {
  const status = query.get('status') ?? undefined
  const tasks = await listTasks(status)
  sendJson(res, 200, tasks.map(toCamelCase))
}

async function handleGetTask(
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

async function handleCreateTask(
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

async function handleUpdateStatus(
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

  const updated = await updateTask(id, toSnakeCase(filtered))
  if (!updated) {
    sendJson(res, 404, { error: `Task ${id} not found` })
    return
  }
  sendJson(res, 200, toCamelCase(updated))
}

async function handleClaim(
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

async function handleRelease(
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

async function handleEvents(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  sseBroadcaster.addClient(res)
}

async function handleTaskOutput(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<void> {
  let body: unknown
  try {
    body = await parseBody(req, res)
  } catch {
    // parseBody already sent 413 if payload too large
    if (!res.writableEnded) {
      sendJson(res, 400, { error: 'Invalid JSON body' })
    }
    return
  }

  if (!body || typeof body !== 'object') {
    sendJson(res, 400, { error: 'Request body must be a JSON object' })
    return
  }

  const { events } = body as { events?: unknown[] }
  if (!Array.isArray(events)) {
    sendJson(res, 400, { error: 'events must be an array' })
    return
  }

  // Broadcast each event to connected SSE clients
  for (const event of events) {
    sseBroadcaster.broadcast('task:output', { taskId, ...event as Record<string, unknown> })
  }

  sendJson(res, 200, { ok: true })
}

async function handleUpdateTask(
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

  const snaked = toSnakeCase(body as Record<string, unknown>)
  const updated = await updateTask(id, snaked)
  if (!updated) {
    sendJson(res, 404, { error: `Task ${id} not found` })
    return
  }
  sendJson(res, 200, toCamelCase(updated))
}
