/**
 * Queue API request router — thin dispatch layer.
 * Handler logic lives in task-handlers, agent-handlers, and event-handlers.
 */
import type http from 'node:http'
import { checkAuth, parseUrl, matchRoute, sendJson, CORS_HEADERS } from './helpers'
import * as tasks from './task-handlers'
import * as agents from './agent-handlers'
import * as events from './event-handlers'

export { sseBroadcaster } from './event-handlers'

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

export async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // QA-21: CORS preflight handler (retained for API compatibility despite empty CORS_HEADERS)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  // Auth check
  if (!checkAuth(req, res)) return

  const { path, query } = parseUrl(req)
  const method = req.method ?? 'GET'

  // --- GET /queue/health ---
  if (method === 'GET' && path === '/queue/health') {
    return tasks.handleHealth(res)
  }

  // --- GET /queue/tasks ---
  if (method === 'GET' && path === '/queue/tasks') {
    return tasks.handleListTasks(res, query)
  }

  // --- POST /queue/tasks/batch ---
  if (method === 'POST' && path === '/queue/tasks/batch') {
    return tasks.handleBatchTasks(req, res)
  }

  // --- POST /queue/tasks ---
  if (method === 'POST' && path === '/queue/tasks') {
    return tasks.handleCreateTask(req, res)
  }

  // --- GET /queue/events (SSE) ---
  if (method === 'GET' && path === '/queue/events') {
    return events.handleEvents(req, res)
  }

  // --- GET /queue/agents ---
  if (method === 'GET' && path === '/queue/agents') {
    return agents.handleListAgents(res, query)
  }

  // --- Routes with :id ---
  // QA-24: Route matching is order-dependent. More specific routes (with path segments
  // after :id) MUST be checked before generic /tasks/:id to prevent incorrect matches.
  // Current order: /agents/:id/log, /tasks/:id/events, /tasks/:id/status,
  // /tasks/:id/dependencies, /tasks/:id/claim, /tasks/:id/release, /tasks/:id/output,
  // and finally generic /tasks/:id. DO NOT reorder without careful testing.
  let params: Record<string, string> | null

  // GET /queue/agents/:id/log
  params = matchRoute('/queue/agents/:id/log', path)
  if (method === 'GET' && params) {
    return agents.handleAgentLog(res, params['id'], query)
  }

  // GET /queue/tasks/:id/events
  params = matchRoute('/queue/tasks/:id/events', path)
  if (method === 'GET' && params) {
    return events.handleTaskEvents(res, params['id'], query)
  }

  // PATCH /queue/tasks/:id/status (must come before generic /tasks/:id)
  params = matchRoute('/queue/tasks/:id/status', path)
  if (method === 'PATCH' && params) {
    return tasks.handleUpdateStatus(req, res, params['id'])
  }

  // PATCH /queue/tasks/:id/dependencies (must come before generic /tasks/:id)
  params = matchRoute('/queue/tasks/:id/dependencies', path)
  if (method === 'PATCH' && params) {
    return tasks.handleUpdateDependencies(req, res, params['id'])
  }

  // POST /queue/tasks/:id/claim (must come before generic /tasks/:id)
  params = matchRoute('/queue/tasks/:id/claim', path)
  if (method === 'POST' && params) {
    return tasks.handleClaim(req, res, params['id'])
  }

  // POST /queue/tasks/:id/release (must come before generic /tasks/:id)
  params = matchRoute('/queue/tasks/:id/release', path)
  if (method === 'POST' && params) {
    return tasks.handleRelease(req, res, params['id'])
  }

  // POST /queue/tasks/:id/output (must come before generic /tasks/:id)
  params = matchRoute('/queue/tasks/:id/output', path)
  if (method === 'POST' && params) {
    return events.handleTaskOutput(req, res, params['id'])
  }

  // Generic /queue/tasks/:id routes (GET and PATCH)
  params = matchRoute('/queue/tasks/:id', path)
  if (params) {
    const id = params['id']
    if (method === 'GET') return tasks.handleGetTask(res, id)
    if (method === 'PATCH') return tasks.handleUpdateTask(req, res, id)
    if (method === 'DELETE') return tasks.handleDeleteTask(res, id) // QA-15: Individual DELETE endpoint
  }

  // 404
  sendJson(res, 404, { error: 'Not found' })
}
