/**
 * Queue API shared helpers: auth, JSON parsing, URL/route matching.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type http from 'node:http'
import { getSetting, setSetting } from '../settings'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Cache the API key to avoid regeneration storms (QA-12)
let cachedApiKey: string | null = null

function getApiKey(): string {
  if (cachedApiKey) return cachedApiKey
  const existing = getSetting('taskRunner.apiKey') ?? process.env['SPRINT_API_KEY']
  if (existing) {
    cachedApiKey = existing
    return existing
  }
  const generated = randomBytes(32).toString('hex')
  setSetting('taskRunner.apiKey', generated)
  cachedApiKey = generated
  return generated
}

/** Timing-safe string comparison to prevent timing attacks (QA-4) */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  return timingSafeEqual(bufA, bufB)
}

export function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const apiKey = getApiKey()

  // Accept token from Authorization header or ?token= query parameter
  const authHeader = req.headers['authorization']
  let token: string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    // Fall back to ?token= query param (used by SSE clients)
    // QA-3: This is a security risk (token in query string) but needed for SSE.
    // Consider upgrading to header-based SSE auth in future versions.
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

  // Use timing-safe comparison to prevent timing attacks (QA-4)
  if (!timingSafeCompare(token, apiKey)) {
    sendJson(res, 403, { error: 'Invalid API key' })
    return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Response / body helpers
// ---------------------------------------------------------------------------

// CORS headers removed - localhost API doesn't need them and wildcard
// Access-Control-Allow-Origin: * would allow any browser tab to probe the API
export const CORS_HEADERS = {}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS })
  res.end(JSON.stringify(body))
}

// QA-16: Standardized error response helper
export interface ErrorResponse {
  error: string
  details?: unknown
  code?: string
}

export function sendError(
  res: http.ServerResponse,
  status: number,
  message: string,
  details?: unknown
): void {
  const response: ErrorResponse = { error: message }
  if (details !== undefined) {
    response.details = details
  }
  sendJson(res, status, response)
}

export const MAX_BODY_SIZE = 5 * 1024 * 1024 // 5 MB
export const BODY_TIMEOUT_MS = 30_000 // QA-13: 30 second timeout for body parsing

export function parseBody(
  req: http.IncomingMessage,
  res?: http.ServerResponse,
  timeoutMs: number = BODY_TIMEOUT_MS
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0
    let rejected = false // QA-9: Prevent double-rejection
    let timeoutHandle: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }

    // QA-13: Add timeout for body parsing
    timeoutHandle = setTimeout(() => {
      if (rejected) return
      rejected = true
      req.destroy()
      if (res && !res.writableEnded) {
        sendJson(res, 408, { error: 'Request timeout' })
      }
      reject(new Error('Request timeout'))
    }, timeoutMs)

    req.on('data', (chunk: Buffer) => {
      if (rejected) return // QA-9: Stop accumulating after rejection
      totalSize += chunk.length
      if (totalSize > MAX_BODY_SIZE) {
        rejected = true
        cleanup()
        req.destroy()
        if (res && !res.writableEnded) {
          sendJson(res, 413, { error: 'Payload too large' })
        }
        reject(new Error('Payload too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      cleanup()
      if (rejected) return // QA-9: Don't process if already rejected
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
    req.on('error', (err) => {
      cleanup()
      if (rejected) return // QA-9: Prevent double-rejection on error
      rejected = true
      reject(err)
    })
  })
}

// ---------------------------------------------------------------------------
// URL / route matching
// ---------------------------------------------------------------------------

/** Parse URL path and return { path, query } */
export function parseUrl(req: http.IncomingMessage): { path: string; query: URLSearchParams } {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  return { path: url.pathname, query: url.searchParams }
}

/** Match a route pattern like /queue/tasks/:id against a path */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
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
