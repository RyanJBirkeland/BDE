/**
 * Integration test: Queue API auth — ?token= query param and Bearer header.
 *
 * Starts the real server on a random port and verifies auth behavior
 * for both token sources with various edge cases.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'

// ---------------------------------------------------------------------------
// Mock sprint-queries — intercept all Supabase calls
// ---------------------------------------------------------------------------

const mockGetQueueStats = vi.fn()

vi.mock('../../data/sprint-queries', () => ({
  getQueueStats: (...args: unknown[]) => mockGetQueueStats(...args),
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn()
}))

// Mock settings — auth enabled by default for these tests
const API_KEY = 'test-secret-key-123'
const mockGetSetting = vi.fn()

vi.mock('../../settings', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args)
}))

// Mock event-queries and db (needed by event-handlers)
vi.mock('../../data/event-queries', () => ({
  insertEventBatch: vi.fn(),
  queryEvents: vi.fn()
}))

vi.mock('../../db', () => ({
  getDb: vi.fn()
}))

// ---------------------------------------------------------------------------
// Start real HTTP server on random port
// ---------------------------------------------------------------------------

import { startQueueApi, stopQueueApi } from '../../queue-api/server'

let port: number

function request(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }

    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = raw
        }
        resolve({ status: res.statusCode ?? 0, body: parsed })
      })
    })

    req.on('error', reject)

    if (body !== undefined) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

beforeAll(async () => {
  const server = startQueueApi({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => {
    server.on('listening', () => {
      const addr = server.address()
      if (typeof addr === 'object' && addr) {
        port = addr.port
      }
      resolve()
    })
  })
})

afterAll(async () => {
  await stopQueueApi()
})

beforeEach(() => {
  vi.clearAllMocks()
  // Auth enabled — getSetting returns the API key
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'taskRunner.apiKey') return API_KEY
    return null
  })
  // Default health endpoint mock
  mockGetQueueStats.mockResolvedValue({
    backlog: 0,
    queued: 0,
    active: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    error: 0
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue API auth — query param and Bearer header', () => {
  describe('?token= query param auth', () => {
    it('returns 200 with correct token', async () => {
      const { status, body } = await request('GET', `/queue/health?token=${API_KEY}`)
      expect(status).toBe(200)
      expect(body).toMatchObject({ status: 'ok' })
    })

    it('returns 403 with wrong token', async () => {
      const { status, body } = await request('GET', '/queue/health?token=wrong-key')
      expect(status).toBe(403)
      expect((body as { error: string }).error).toMatch(/invalid api key/i)
    })

    it('returns 401 with empty token', async () => {
      const { status, body } = await request('GET', '/queue/health?token=')
      expect(status).toBe(401)
      expect((body as { error: string }).error).toMatch(/missing/i)
    })

    it('returns 401 with no auth at all', async () => {
      const { status, body } = await request('GET', '/queue/health')
      expect(status).toBe(401)
      expect((body as { error: string }).error).toMatch(/missing/i)
    })
  })

  describe('Bearer header takes precedence over query param', () => {
    it('uses Bearer header when both are provided', async () => {
      // Bearer header has the correct key, query param has wrong key
      const { status } = await request('GET', '/queue/health?token=wrong-key', undefined, {
        Authorization: `Bearer ${API_KEY}`
      })
      expect(status).toBe(200)
    })

    it('rejects when Bearer header is wrong even if query param is correct', async () => {
      // Bearer header has wrong key, query param has correct key
      // Since Bearer is checked first, it should use the Bearer value
      const { status } = await request('GET', `/queue/health?token=${API_KEY}`, undefined, {
        Authorization: 'Bearer wrong-key'
      })
      expect(status).toBe(403)
    })
  })

  describe('Bearer header auth', () => {
    it('returns 200 with correct Bearer token', async () => {
      const { status, body } = await request('GET', '/queue/health', undefined, {
        Authorization: `Bearer ${API_KEY}`
      })
      expect(status).toBe(200)
      expect(body).toMatchObject({ status: 'ok' })
    })

    it('returns 403 with wrong Bearer token', async () => {
      const { status, body } = await request('GET', '/queue/health', undefined, {
        Authorization: 'Bearer bad-token'
      })
      expect(status).toBe(403)
      expect((body as { error: string }).error).toMatch(/invalid api key/i)
    })
  })

  describe('auth disabled (no key configured)', () => {
    it('allows all requests when no API key is set', async () => {
      mockGetSetting.mockReturnValue(null)

      const { status } = await request('GET', '/queue/health')
      expect(status).toBe(200)
    })
  })
})
