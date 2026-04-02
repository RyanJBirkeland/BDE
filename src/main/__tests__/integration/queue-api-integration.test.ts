/**
 * Integration test: Queue API HTTP server.
 *
 * Starts the real server on a random port and exercises core endpoints
 * via real HTTP requests. Uses the same mock/server setup as
 * src/main/queue-api/__tests__/queue-api.test.ts.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'

// ---------------------------------------------------------------------------
// Mock sprint-queries — intercept all Supabase calls
// ---------------------------------------------------------------------------

const mockGetQueueStats = vi.fn()
const mockListTasks = vi.fn()
const mockGetTask = vi.fn()
const mockCreateTask = vi.fn()
const mockUpdateTask = vi.fn()
const mockClaimTask = vi.fn()
const mockReleaseTask = vi.fn()

vi.mock('../../data/sprint-queries', () => ({
  getQueueStats: (...args: unknown[]) => mockGetQueueStats(...args),
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  getTask: (...args: unknown[]) => mockGetTask(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  claimTask: (...args: unknown[]) => mockClaimTask(...args),
  releaseTask: (...args: unknown[]) => mockReleaseTask(...args)
}))

// Mock settings — provide a known API key for auth
const INTEGRATION_TEST_KEY = 'integration-test-key'
const mockGetSetting = vi.fn().mockReturnValue(INTEGRATION_TEST_KEY)
vi.mock('../../settings', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: vi.fn()
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
        Authorization: `Bearer ${INTEGRATION_TEST_KEY}`,
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
  mockGetSetting.mockReturnValue(INTEGRATION_TEST_KEY)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue API integration', () => {
  describe('GET /queue/health', () => {
    it('returns queue stats', async () => {
      mockGetQueueStats.mockReturnValue({
        backlog: 1,
        queued: 2,
        active: 1,
        done: 5,
        failed: 0,
        cancelled: 0,
        error: 0
      })

      const { status, body } = await request('GET', '/queue/health')
      expect(status).toBe(200)
      expect(body).toMatchObject({
        status: 'ok',
        queue: {
          backlog: 1,
          queued: 2,
          active: 1
        }
      })
    })

    // QA-16: Updated to match standardized error response format
    it('returns 500 when getQueueStats throws', async () => {
      mockGetQueueStats.mockImplementation(() => {
        throw new Error('DB error')
      })

      const { status, body } = await request('GET', '/queue/health')
      expect(status).toBe(500)
      expect((body as { error: string }).error).toBe('Failed to get queue stats')
      expect((body as { details: string }).details).toBe('DB error')
    })
  })

  describe('POST /queue/tasks', () => {
    it('creates a task and returns 201', async () => {
      const input = { title: 'Build login page', repo: 'frontend' }
      const created = {
        id: 'task-new-1',
        title: 'Build login page',
        repo: 'frontend',
        status: 'backlog'
      }
      mockCreateTask.mockReturnValue(created)

      const { status, body } = await request('POST', '/queue/tasks', input)
      expect(status).toBe(201)
      expect(body).toEqual(created)
      expect(mockCreateTask).toHaveBeenCalled()
    })

    it('rejects request missing title with 400', async () => {
      const { status, body } = await request('POST', '/queue/tasks', { repo: 'frontend' })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/title/i)
    })

    it('rejects request missing repo with 400', async () => {
      const { status, body } = await request('POST', '/queue/tasks', { title: 'My task' })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/repo/i)
    })
  })

  describe('GET /queue/tasks/:id', () => {
    it('retrieves an existing task', async () => {
      const task = { id: 'task-abc', title: 'Fix bug', status: 'queued' }
      mockGetTask.mockReturnValue(task)

      const { status, body } = await request('GET', '/queue/tasks/task-abc')
      expect(status).toBe(200)
      expect(body).toEqual(task)
      expect(mockGetTask).toHaveBeenCalledWith('task-abc')
    })

    it('returns 404 when task does not exist', async () => {
      mockGetTask.mockReturnValue(null)

      const { status } = await request('GET', '/queue/tasks/nonexistent')
      expect(status).toBe(404)
    })

    it('returns 500 when getTask throws', async () => {
      mockGetTask.mockImplementation(() => {
        throw new Error('network error')
      })

      const { status, body } = await request('GET', '/queue/tasks/task-abc')
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })
  })
})
