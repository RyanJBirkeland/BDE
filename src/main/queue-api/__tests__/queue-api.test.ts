import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'

// ---------------------------------------------------------------------------
// Mock sprint-queries — all Supabase calls are intercepted
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
  releaseTask: (...args: unknown[]) => mockReleaseTask(...args),
}))

// Mock settings — no API key by default (auth disabled)
const mockGetSetting = vi.fn().mockReturnValue(null)
vi.mock('../../settings', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}))

// ---------------------------------------------------------------------------
// Start server on a random port for tests
// ---------------------------------------------------------------------------
import { startQueueApi, stopQueueApi } from '../server'

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
        ...headers,
      },
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

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

beforeAll(async () => {
  // Use port 0 to get a random available port
  const server = startQueueApi({ port: 0, host: '127.0.0.1' })
  // Wait for the server to actually start listening before extracting the port
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
  mockGetSetting.mockReturnValue(null) // no auth by default
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue API', () => {
  describe('GET /queue/health', () => {
    it('returns queue stats', async () => {
      mockGetQueueStats.mockResolvedValue({
        backlog: 2,
        queued: 3,
        active: 1,
        done: 10,
        failed: 0,
        cancelled: 1,
        error: 0,
      })

      const { status, body } = await request('GET', '/queue/health')
      expect(status).toBe(200)
      expect(body).toEqual({
        status: 'ok',
        version: '1.0.0',
        queue: {
          backlog: 2,
          queued: 3,
          active: 1,
          done: 10,
          failed: 0,
          cancelled: 1,
        },
      })
    })
  })

  describe('GET /queue/tasks', () => {
    it('returns all tasks', async () => {
      const tasks = [{ id: '1', title: 'Test', status: 'queued' }]
      mockListTasks.mockResolvedValue(tasks)

      const { status, body } = await request('GET', '/queue/tasks')
      expect(status).toBe(200)
      expect(body).toEqual(tasks)
      expect(mockListTasks).toHaveBeenCalledWith(undefined)
    })

    it('passes status filter', async () => {
      mockListTasks.mockResolvedValue([])

      await request('GET', '/queue/tasks?status=active')
      expect(mockListTasks).toHaveBeenCalledWith('active')
    })
  })

  describe('GET /queue/tasks/:id', () => {
    it('returns a task by id', async () => {
      const task = { id: 'abc', title: 'Test' }
      mockGetTask.mockResolvedValue(task)

      const { status, body } = await request('GET', '/queue/tasks/abc')
      expect(status).toBe(200)
      expect(body).toEqual(task)
      expect(mockGetTask).toHaveBeenCalledWith('abc')
    })

    it('returns 404 for missing task', async () => {
      mockGetTask.mockResolvedValue(null)

      const { status } = await request('GET', '/queue/tasks/missing')
      expect(status).toBe(404)
    })
  })

  describe('POST /queue/tasks', () => {
    it('creates a task', async () => {
      const input = { title: 'New task', repo: 'my-repo' }
      const created = { id: 'new-1', ...input, status: 'backlog' }
      mockCreateTask.mockResolvedValue(created)

      const { status, body } = await request('POST', '/queue/tasks', input)
      expect(status).toBe(201)
      expect(body).toEqual(created)
    })

    it('rejects missing title', async () => {
      const { status, body } = await request('POST', '/queue/tasks', { repo: 'r' })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/title/)
    })

    it('rejects missing repo', async () => {
      const { status, body } = await request('POST', '/queue/tasks', { title: 't' })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/repo/)
    })
  })

  describe('PATCH /queue/tasks/:id/status', () => {
    it('updates task status', async () => {
      const updated = { id: 'abc', status: 'done' }
      mockUpdateTask.mockResolvedValue(updated)

      const { status, body } = await request('PATCH', '/queue/tasks/abc/status', {
        status: 'done',
        notes: 'Completed successfully',
      })
      expect(status).toBe(200)
      expect(body).toEqual(updated)
    })

    it('rejects invalid status', async () => {
      const { status } = await request('PATCH', '/queue/tasks/abc/status', {
        status: 'queued',
      })
      expect(status).toBe(400)
    })

    it('filters out disallowed fields', async () => {
      mockUpdateTask.mockResolvedValue({ id: 'abc', status: 'done' })

      await request('PATCH', '/queue/tasks/abc/status', {
        status: 'done',
        id: 'hacked',        // not in STATUS_UPDATE_FIELDS
        created_at: 'nope',  // not in STATUS_UPDATE_FIELDS
      })

      expect(mockUpdateTask).toHaveBeenCalledWith('abc', { status: 'done' })
    })

    it('returns 404 when task not found', async () => {
      mockUpdateTask.mockResolvedValue(null)

      const { status } = await request('PATCH', '/queue/tasks/missing/status', {
        status: 'done',
      })
      expect(status).toBe(404)
    })
  })

  describe('POST /queue/tasks/:id/claim', () => {
    it('claims a task', async () => {
      const claimed = { id: 'abc', status: 'active', claimed_by: 'runner-1' }
      mockClaimTask.mockResolvedValue(claimed)

      const { status, body } = await request('POST', '/queue/tasks/abc/claim', {
        executorId: 'runner-1',
      })
      expect(status).toBe(200)
      expect(body).toEqual(claimed)
      expect(mockClaimTask).toHaveBeenCalledWith('abc', 'runner-1')
    })

    it('returns 409 when task not claimable', async () => {
      mockClaimTask.mockResolvedValue(null)

      const { status } = await request('POST', '/queue/tasks/abc/claim', {
        executorId: 'runner-1',
      })
      expect(status).toBe(409)
    })

    it('rejects missing executorId', async () => {
      const { status } = await request('POST', '/queue/tasks/abc/claim', {})
      expect(status).toBe(400)
    })
  })

  describe('POST /queue/tasks/:id/release', () => {
    it('releases a task', async () => {
      const released = { id: 'abc', status: 'queued', claimed_by: null }
      mockReleaseTask.mockResolvedValue(released)

      const { status, body } = await request('POST', '/queue/tasks/abc/release')
      expect(status).toBe(200)
      expect(body).toEqual(released)
      expect(mockReleaseTask).toHaveBeenCalledWith('abc')
    })

    it('returns 409 when task not releasable', async () => {
      mockReleaseTask.mockResolvedValue(null)

      const { status } = await request('POST', '/queue/tasks/abc/release', {})
      expect(status).toBe(409)
    })
  })

  describe('GET /queue/events', () => {
    it('returns 200 SSE stream', async () => {
      const { status } = await request('GET', '/queue/events')
      expect(status).toBe(200)
    })
  })

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const { status } = await request('GET', '/unknown')
      expect(status).toBe(404)
    })
  })

  describe('Authentication', () => {
    it('rejects requests without bearer token when API key is set', async () => {
      mockGetSetting.mockReturnValue('secret-key')

      const { status } = await request('GET', '/queue/health')
      expect(status).toBe(401)
    })

    it('rejects requests with wrong bearer token', async () => {
      mockGetSetting.mockReturnValue('secret-key')

      const { status } = await request('GET', '/queue/health', undefined, {
        Authorization: 'Bearer wrong-key',
      })
      expect(status).toBe(403)
    })

    it('allows requests with correct bearer token', async () => {
      mockGetSetting.mockReturnValue('secret-key')
      mockGetQueueStats.mockResolvedValue({
        backlog: 0, queued: 0, active: 0, done: 0, failed: 0, cancelled: 0, error: 0,
      })

      const { status } = await request('GET', '/queue/health', undefined, {
        Authorization: 'Bearer secret-key',
      })
      expect(status).toBe(200)
    })

    it('allows all requests when no API key is configured', async () => {
      mockGetSetting.mockReturnValue(null)
      mockGetQueueStats.mockResolvedValue({
        backlog: 0, queued: 0, active: 0, done: 0, failed: 0, cancelled: 0, error: 0,
      })

      const { status } = await request('GET', '/queue/health')
      expect(status).toBe(200)
    })
  })

  describe('CORS', () => {
    it('responds to OPTIONS with CORS headers', async () => {
      const { status } = await request('OPTIONS', '/queue/health')
      expect(status).toBe(204)
    })
  })

  describe('Error handling — sprint-queries throws', () => {
    it('returns 500 when getQueueStats throws', async () => {
      mockGetQueueStats.mockRejectedValue(new Error('Supabase connection failed'))

      const { status, body } = await request('GET', '/queue/health')
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when listTasks throws', async () => {
      mockListTasks.mockRejectedValue(new Error('Supabase timeout'))

      const { status, body } = await request('GET', '/queue/tasks')
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when getTask throws', async () => {
      mockGetTask.mockRejectedValue(new Error('network error'))

      const { status, body } = await request('GET', '/queue/tasks/abc')
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when createTask throws', async () => {
      mockCreateTask.mockRejectedValue(new Error('insert failed'))

      const { status, body } = await request('POST', '/queue/tasks', {
        title: 'New task',
        repo: 'my-repo',
      })
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when claimTask throws', async () => {
      mockClaimTask.mockRejectedValue(new Error('lock contention'))

      const { status, body } = await request('POST', '/queue/tasks/abc/claim', {
        executorId: 'runner-1',
      })
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when releaseTask throws', async () => {
      mockReleaseTask.mockRejectedValue(new Error('constraint violation'))

      const { status, body } = await request('POST', '/queue/tasks/abc/release')
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })
  })
})
