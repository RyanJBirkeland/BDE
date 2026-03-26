/**
 * Queue API shared helpers: auth, JSON parsing, URL/route matching.
 */
import type http from 'node:http'
import { getSetting } from '../settings'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getApiKey(): string | null {
  return getSetting('taskRunner.apiKey') ?? process.env['SPRINT_API_KEY'] ?? null
}

export function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
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

// ---------------------------------------------------------------------------
// Response / body helpers
// ---------------------------------------------------------------------------

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export const MAX_BODY_SIZE = 5 * 1024 * 1024 // 5 MB

export function parseBody(req: http.IncomingMessage, res?: http.ServerResponse): Promise<unknown> {
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
