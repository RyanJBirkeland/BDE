/**
 * Queue API request router — thin dispatch layer.
 * Handler logic lives in task-handlers, agent-handlers, and event-handlers.
 */
import type http from 'node:http'
import { checkAuth, parseUrl, matchRoute, sendJson } from './helpers'
import * as tasks from './task-handlers'
import * as agents from './agent-handlers'
import * as events from './event-handlers'

export { sseBroadcaster } from './event-handlers'

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

  // GET /queue/tasks/:id
  params = matchRoute('/queue/tasks/:id', path)
  if (method === 'GET' && params) {
    return tasks.handleGetTask(res, params['id'])
  }

  // PATCH /queue/tasks/:id — general field update
  params = matchRoute('/queue/tasks/:id', path)
  if (method === 'PATCH' && params) {
    return tasks.handleUpdateTask(req, res, params['id'])
  }

  // PATCH /queue/tasks/:id/status
  params = matchRoute('/queue/tasks/:id/status', path)
  if (method === 'PATCH' && params) {
    return tasks.handleUpdateStatus(req, res, params['id'])
  }

  // PATCH /queue/tasks/:id/dependencies
  params = matchRoute('/queue/tasks/:id/dependencies', path)
  if (method === 'PATCH' && params) {
    return tasks.handleUpdateDependencies(req, res, params['id'])
  }

  // POST /queue/tasks/:id/claim
  params = matchRoute('/queue/tasks/:id/claim', path)
  if (method === 'POST' && params) {
    return tasks.handleClaim(req, res, params['id'])
  }

  // POST /queue/tasks/:id/release
  params = matchRoute('/queue/tasks/:id/release', path)
  if (method === 'POST' && params) {
    return tasks.handleRelease(req, res, params['id'])
  }

  // POST /queue/tasks/:id/output
  params = matchRoute('/queue/tasks/:id/output', path)
  if (method === 'POST' && params) {
    return events.handleTaskOutput(req, res, params['id'])
  }

  // 404
  sendJson(res, 404, { error: 'Not found' })
}
