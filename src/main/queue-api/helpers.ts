/**
 * Queue API shared helpers: auth, JSON parsing, URL/route matching.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type http from 'node:http'
import { getSetting, setSetting } from '../settings'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// QA-12: Cache API key to avoid repeated settings reads
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

// QA-12: Clear cached API key (for testing)
export function clearApiKeyCache(): void {
  cachedApiKey = null
}

export function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const apiKey = getApiKey()

  // Accept token from Authorization header or ?token= query parameter
  const authHeader = req.headers['authorization']
  let token: string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    // QA-3: Fall back to ?token= query param (used by SSE clients)
    // NOTE: Query string tokens are logged in access logs and browser history.
    // This is acceptable for localhost-only API but should not be used in production.
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

  // QA-4: Use timing-safe comparison to prevent timing attacks
  // Ensure both strings are same length to avoid early exit
  if (token.length !== apiKey.length) {
    sendJson(res, 403, { error: 'Invalid API key' })
    return false
  }

  try {
    const tokenBuffer = Buffer.from(token, 'utf8')
    const keyBuffer = Buffer.from(apiKey, 'utf8')
    if (!timingSafeEqual(tokenBuffer, keyBuffer)) {
      sendJson(res, 403, { error: 'Invalid API key' })
      return false
    }
  } catch {
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

export const MAX_BODY_SIZE = 5 * 1024 * 1024 // 5 MB
export const BODY_PARSE_TIMEOUT_MS = 30_000 // 30 seconds

export function parseBody(req: http.IncomingMessage, res?: http.ServerResponse): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0
    let settled = false // QA-9: Track if promise has been settled to prevent double-rejection

    // QA-13: Add request timeout to prevent indefinite hangs
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        req.destroy()
        if (res && !res.writableEnded) {
          sendJson(res, 408, { error: 'Request timeout' })
        }
        reject(new Error('Request timeout'))
      }
    }, BODY_PARSE_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      req.removeAllListeners('data')
      req.removeAllListeners('end')
      req.removeAllListeners('error')
    }

    req.on('data', (chunk: Buffer) => {
      if (settled) return // QA-9: Stop processing if already rejected

      totalSize += chunk.length
      if (totalSize > MAX_BODY_SIZE) {
        settled = true
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
      if (settled) return
      settled = true
      cleanup()

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
      if (settled) return
      settled = true
      cleanup()
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
