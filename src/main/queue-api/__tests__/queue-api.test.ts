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
const mockGetTasksWithDependencies = vi.fn()
const mockDeleteTask = vi.fn()
const mockGetActiveTaskCount = vi.fn()
const mockGetAllTaskIds = vi.fn()

vi.mock('../../data/sprint-queries', () => ({
  getQueueStats: (...args: unknown[]) => mockGetQueueStats(...args),
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  getTask: (...args: unknown[]) => mockGetTask(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  claimTask: (...args: unknown[]) => mockClaimTask(...args),
  releaseTask: (...args: unknown[]) => mockReleaseTask(...args),
  getTasksWithDependencies: (...args: unknown[]) => mockGetTasksWithDependencies(...args),
  deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
  getActiveTaskCount: (...args: unknown[]) => mockGetActiveTaskCount(...args),
  getAllTaskIds: (...args: unknown[]) => mockGetAllTaskIds(...args)
}))

// ---------------------------------------------------------------------------
// Mock agent-history — agent run queries and log reads
// ---------------------------------------------------------------------------
const mockListAgentRunsByTaskId = vi.fn()
const mockHasAgent = vi.fn()
const mockReadLog = vi.fn()

vi.mock('../../agent-history', () => ({
  listAgentRunsByTaskId: (...args: unknown[]) => mockListAgentRunsByTaskId(...args),
  hasAgent: (...args: unknown[]) => mockHasAgent(...args),
  readLog: (...args: unknown[]) => mockReadLog(...args)
}))

// ---------------------------------------------------------------------------
// Mock event-queries — SQLite event persistence
// ---------------------------------------------------------------------------
const mockInsertEventBatch = vi.fn()
const mockQueryEvents = vi.fn()

vi.mock('../../data/event-queries', () => ({
  insertEventBatch: (...args: unknown[]) => mockInsertEventBatch(...args),
  queryEvents: (...args: unknown[]) => mockQueryEvents(...args)
}))

// ---------------------------------------------------------------------------
// Mock db — SQLite database handle
// ---------------------------------------------------------------------------
const mockGetDb = vi.fn().mockReturnValue({})

vi.mock('../../db', () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args)
}))

// Mock settings — no API key by default; setSetting captures auto-generated keys
const mockGetSetting = vi.fn().mockReturnValue(null)
const mockSetSetting = vi.fn()
vi.mock('../../settings', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args)
}))

// ---------------------------------------------------------------------------
// Mock spec-semantic-check — AI validation via Claude CLI
// ---------------------------------------------------------------------------
const mockCheckSpecSemantic = vi.fn()
vi.mock('../../spec-semantic-check', () => ({
  checkSpecSemantic: (...args: unknown[]) => mockCheckSpecSemantic(...args)
}))

// ---------------------------------------------------------------------------
// Mock resolve-dependents — dependency resolution after terminal transitions
// ---------------------------------------------------------------------------
const mockResolveDependents = vi.fn().mockResolvedValue(undefined)
vi.mock('../../agent-manager/resolve-dependents', () => ({
  resolveDependents: (...args: unknown[]) => mockResolveDependents(...args)
}))

// ---------------------------------------------------------------------------
// Wire onStatusTerminal mock for terminal status resolution
// ---------------------------------------------------------------------------
import { setQueueApiOnStatusTerminal } from '../task-handlers'
const mockOnStatusTerminal = vi.fn()

// ---------------------------------------------------------------------------
// Start server on a random port for tests
// ---------------------------------------------------------------------------
import { startQueueApi, stopQueueApi } from '../server'

let port: number

// Default key used in tests — set as the mock return value in beforeEach so all
// requests are authenticated by default without touching individual test cases.
const TEST_API_KEY = 'test-api-key-default'

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
        // Include the default key unless the caller explicitly provides Authorization
        Authorization: `Bearer ${TEST_API_KEY}`,
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

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

beforeAll(async () => {
  setQueueApiOnStatusTerminal(mockOnStatusTerminal)
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
  mockGetSetting.mockReturnValue(TEST_API_KEY) // return known key so all requests are authenticated
  mockSetSetting.mockImplementation(() => {}) // capture auto-generated key writes
  mockGetDb.mockReturnValue({}) // default db mock
  mockGetTasksWithDependencies.mockReturnValue([]) // default empty tasks list
  mockGetAllTaskIds.mockReturnValue(new Set<string>()) // default: no existing task IDs
  mockDeleteTask.mockReturnValue(undefined) // default delete success
  mockGetActiveTaskCount.mockReturnValue(0) // default: no active tasks (WIP limit not hit)
  mockCheckSpecSemantic.mockResolvedValue({
    passed: true,
    hasFails: false,
    hasWarns: false,
    results: {
      clarity: { status: 'pass', message: 'Clear' },
      scope: { status: 'pass', message: 'Good' },
      filesExist: { status: 'pass', message: 'OK' }
    },
    failMessages: [],
    warnMessages: []
  }) // default semantic pass
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue API', () => {
  describe('GET /queue/health', () => {
    it('returns queue stats', async () => {
      mockGetQueueStats.mockReturnValue({
        backlog: 2,
        queued: 3,
        active: 1,
        done: 10,
        failed: 0,
        cancelled: 1,
        error: 0
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
          error: 0
        }
      })
    })
  })

  describe('GET /queue/tasks', () => {
    it('returns all tasks', async () => {
      const tasks = [{ id: '1', title: 'Test', status: 'queued' }]
      mockListTasks.mockReturnValue(tasks)

      const { status, body } = await request('GET', '/queue/tasks')
      expect(status).toBe(200)
      expect(body).toEqual(tasks)
      expect(mockListTasks).toHaveBeenCalledWith(undefined)
    })

    it('passes status filter', async () => {
      mockListTasks.mockReturnValue([])

      await request('GET', '/queue/tasks?status=active')
      expect(mockListTasks).toHaveBeenCalledWith('active')
    })
  })

  describe('GET /queue/tasks/:id', () => {
    it('returns a task by id', async () => {
      const task = { id: 'abc', title: 'Test' }
      mockGetTask.mockReturnValue(task)

      const { status, body } = await request('GET', '/queue/tasks/abc')
      expect(status).toBe(200)
      expect(body).toEqual(task)
      expect(mockGetTask).toHaveBeenCalledWith('abc')
    })

    it('returns 404 for missing task', async () => {
      mockGetTask.mockReturnValue(null)

      const { status } = await request('GET', '/queue/tasks/missing')
      expect(status).toBe(404)
    })
  })

  describe('POST /queue/tasks', () => {
    it('creates a task', async () => {
      const input = { title: 'New task', repo: 'my-repo' }
      const created = { id: 'new-1', ...input, status: 'backlog' }
      mockCreateTask.mockReturnValue(created)

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

    it('rejects invalid depends_on structure', async () => {
      const { status, body } = await request('POST', '/queue/tasks', {
        title: 'Task with bad deps',
        repo: 'my-repo',
        depends_on: 'invalid'
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/depends_on must be an array/)
    })

    it('rejects dependency with missing id', async () => {
      const { status, body } = await request('POST', '/queue/tasks', {
        title: 'Task with bad deps',
        repo: 'my-repo',
        depends_on: [{ type: 'hard' }]
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/dependency must have a valid id/)
    })

    it('rejects dependency with invalid type', async () => {
      const { status, body } = await request('POST', '/queue/tasks', {
        title: 'Task with bad deps',
        repo: 'my-repo',
        depends_on: [{ id: 'task-1', type: 'invalid' }]
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/dependency type must be/)
    })

    it('rejects dependencies with non-existent task IDs before creating task', async () => {
      mockGetTasksWithDependencies.mockReturnValue([
        { id: 'existing-1', depends_on: null, status: 'done' },
        { id: 'existing-2', depends_on: null, status: 'queued' }
      ])
      mockGetAllTaskIds.mockReturnValue(new Set(['existing-1', 'existing-2']))

      const { status, body } = await request('POST', '/queue/tasks', {
        title: 'Task with deps',
        repo: 'my-repo',
        depends_on: [{ id: 'missing-task', type: 'hard' }]
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/task IDs do not exist/)
      expect((body as { error: string }).error).toMatch(/missing-task/)
      // Task should never have been created — no rollback needed
      expect(mockCreateTask).not.toHaveBeenCalled()
      expect(mockDeleteTask).not.toHaveBeenCalled()
    })

    it('rejects dependencies that would create a cycle before creating task', async () => {
      mockGetTasksWithDependencies.mockReturnValue([
        { id: 'task-a', depends_on: [{ id: 'task-b', type: 'hard' }], status: 'queued' },
        { id: 'task-b', depends_on: [{ id: 'pending-new-task', type: 'hard' }], status: 'queued' }
      ])
      mockGetAllTaskIds.mockReturnValue(new Set(['task-a', 'task-b']))

      const { status, body } = await request('POST', '/queue/tasks', {
        title: 'Task with deps',
        repo: 'my-repo',
        depends_on: [{ id: 'task-a', type: 'hard' }]
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/cycle detected/)
      // Task should never have been created — no rollback needed
      expect(mockCreateTask).not.toHaveBeenCalled()
      expect(mockDeleteTask).not.toHaveBeenCalled()
    })

    it('rejects self-referencing dependencies before creating task', async () => {
      // With pre-creation validation, the temporary ID is 'pending-new-task'
      // so a self-reference uses that ID
      mockGetTasksWithDependencies.mockReturnValue([])

      const { status, body } = await request('POST', '/queue/tasks', {
        title: 'Task with deps',
        repo: 'my-repo',
        depends_on: [{ id: 'pending-new-task', type: 'hard' }]
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/cycle detected/)
      // Task should never have been created — no rollback needed
      expect(mockCreateTask).not.toHaveBeenCalled()
      expect(mockDeleteTask).not.toHaveBeenCalled()
    })

    it('creates task with valid dependencies', async () => {
      const created = {
        id: 'new-1',
        title: 'Task with deps',
        repo: 'my-repo',
        depends_on: [{ id: 'task-a', type: 'hard' }]
      }
      mockCreateTask.mockReturnValue(created)
      mockGetTasksWithDependencies.mockReturnValue([
        { id: 'task-a', depends_on: null, status: 'done' }
      ])
      mockGetAllTaskIds.mockReturnValue(new Set(['task-a']))
      // checkTaskDependencies calls listTasks() for auto-blocking check
      mockListTasks.mockReturnValue([{ id: 'task-a', depends_on: null, status: 'done' }])

      const { status, body } = await request('POST', '/queue/tasks', {
        title: 'Task with deps',
        repo: 'my-repo',
        depends_on: [{ id: 'task-a', type: 'hard' }]
      })
      expect(status).toBe(201)
      expect(body).toEqual({
        id: 'new-1',
        title: 'Task with deps',
        repo: 'my-repo',
        dependsOn: [{ id: 'task-a', type: 'hard' }]
      })
      expect(mockDeleteTask).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /queue/tasks/:id/status', () => {
    it('updates task status', async () => {
      const updated = { id: 'abc', status: 'done' }
      mockUpdateTask.mockReturnValue(updated)

      const { status, body } = await request('PATCH', '/queue/tasks/abc/status', {
        status: 'done',
        notes: 'Completed successfully'
      })
      expect(status).toBe(200)
      expect(body).toEqual(updated)
    })

    it('rejects invalid status', async () => {
      const { status } = await request('PATCH', '/queue/tasks/abc/status', {
        status: 'invented'
      })
      expect(status).toBe(400)
    })

    it('filters out disallowed fields', async () => {
      mockUpdateTask.mockReturnValue({ id: 'abc', status: 'done' })

      await request('PATCH', '/queue/tasks/abc/status', {
        status: 'done',
        id: 'hacked', // not in STATUS_UPDATE_FIELDS
        created_at: 'nope' // not in STATUS_UPDATE_FIELDS
      })

      expect(mockUpdateTask).toHaveBeenCalledWith('abc', { status: 'done' })
    })

    it('returns 404 when task not found', async () => {
      mockUpdateTask.mockReturnValue(null)

      const { status } = await request('PATCH', '/queue/tasks/missing/status', {
        status: 'done'
      })
      expect(status).toBe(404)
    })

    it('calls onStatusTerminal after transitioning to done', async () => {
      mockUpdateTask.mockReturnValue({ id: 'abc', status: 'done' })
      mockOnStatusTerminal.mockClear()

      const { status } = await request('PATCH', '/queue/tasks/abc/status', { status: 'done' })
      expect(status).toBe(200)

      // Give the async post-response work time to complete
      await new Promise((r) => setTimeout(r, 50))
      expect(mockOnStatusTerminal).toHaveBeenCalledWith('abc', 'done')
    })

    it('calls onStatusTerminal for all terminal statuses', async () => {
      for (const terminalStatus of ['done', 'failed', 'error', 'cancelled']) {
        mockOnStatusTerminal.mockClear()
        mockUpdateTask.mockReturnValue({ id: 'abc', status: terminalStatus })

        const { status } = await request('PATCH', '/queue/tasks/abc/status', {
          status: terminalStatus
        })
        expect(status).toBe(200)

        await new Promise((r) => setTimeout(r, 50))
        expect(mockOnStatusTerminal).toHaveBeenCalledWith('abc', terminalStatus)
      }
    })

    it('does not call onStatusTerminal for non-terminal status transitions', async () => {
      mockUpdateTask.mockReturnValue({ id: 'abc', status: 'active' })
      mockOnStatusTerminal.mockClear()

      const { status } = await request('PATCH', '/queue/tasks/abc/status', { status: 'active' })
      expect(status).toBe(200)

      await new Promise((r) => setTimeout(r, 50))
      expect(mockOnStatusTerminal).not.toHaveBeenCalled()
    })
  })

  describe('POST /queue/tasks/:id/claim', () => {
    it('claims a task', async () => {
      const claimed = { id: 'abc', status: 'active', claimed_by: 'runner-1' }
      mockClaimTask.mockReturnValue(claimed)

      const { status, body } = await request('POST', '/queue/tasks/abc/claim', {
        executorId: 'runner-1'
      })
      expect(status).toBe(200)
      expect(body).toEqual({ id: 'abc', status: 'active', claimedBy: 'runner-1' })
      // MAX_ACTIVE_TASKS (5) is now passed to claimTask for atomic WIP enforcement
      expect(mockClaimTask).toHaveBeenCalledWith('abc', 'runner-1', 5)
    })

    it('returns 409 when task not claimable (below WIP limit)', async () => {
      mockClaimTask.mockReturnValue(null)
      // Active count below limit → "not claimable" error path
      mockGetActiveTaskCount.mockReturnValue(0)

      const { status, body } = await request('POST', '/queue/tasks/abc/claim', {
        executorId: 'runner-1'
      })
      expect(status).toBe(409)
      expect((body as { error: string }).error).toMatch(/not claimable/)
    })

    it('rejects missing executorId', async () => {
      const { status } = await request('POST', '/queue/tasks/abc/claim', {})
      expect(status).toBe(400)
    })

    it('returns WIP limit error when claimTask returns null and active count is at limit', async () => {
      // claimTask now enforces WIP atomically and returns null when limit hit
      mockClaimTask.mockReturnValue(null)
      mockGetActiveTaskCount.mockReturnValue(5)

      const { status, body } = await request('POST', '/queue/tasks/abc/claim', {
        executorId: 'runner-1'
      })
      expect(status).toBe(409)
      expect((body as { error: string }).error).toMatch(/WIP limit reached/)
      // claimTask IS now called (WIP check is inside it)
      expect(mockClaimTask).toHaveBeenCalledWith('abc', 'runner-1', 5)
    })

    it('allows claim when active task count is below WIP limit', async () => {
      mockGetActiveTaskCount.mockReturnValue(4)
      const claimed = { id: 'abc', status: 'active', claimed_by: 'runner-1' }
      mockClaimTask.mockReturnValue(claimed)

      const { status, body } = await request('POST', '/queue/tasks/abc/claim', {
        executorId: 'runner-1'
      })
      expect(status).toBe(200)
      expect(body).toEqual({ id: 'abc', status: 'active', claimedBy: 'runner-1' })
    })
  })

  describe('POST /queue/tasks/:id/release', () => {
    it('releases a task', async () => {
      const released = { id: 'abc', status: 'queued', claimed_by: null }
      mockReleaseTask.mockReturnValue(released)

      const { status, body } = await request('POST', '/queue/tasks/abc/release', {
        claimedBy: 'runner-1'
      })
      expect(status).toBe(200)
      expect(body).toEqual({ id: 'abc', status: 'queued', claimedBy: null })
      expect(mockReleaseTask).toHaveBeenCalledWith('abc', 'runner-1')
    })

    it('returns 400 when claimedBy is missing', async () => {
      const { status, body } = await request('POST', '/queue/tasks/abc/release', {})
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/claimedBy is required/)
    })

    it('returns 409 when task not releasable', async () => {
      mockReleaseTask.mockReturnValue(null)

      const { status } = await request('POST', '/queue/tasks/abc/release', {
        claimedBy: 'runner-1'
      })
      expect(status).toBe(409)
    })
  })

  describe('PATCH /queue/tasks/:id/dependencies', () => {
    it('updates task dependencies', async () => {
      const updated = {
        id: 'abc',
        depends_on: [
          { id: 'task-1', type: 'hard' },
          { id: 'task-2', type: 'soft' }
        ]
      }
      mockGetTasksWithDependencies.mockReturnValue([
        { id: 'abc', depends_on: null, status: 'queued' },
        { id: 'task-1', depends_on: null, status: 'done' },
        { id: 'task-2', depends_on: null, status: 'done' }
      ])
      mockGetAllTaskIds.mockReturnValue(new Set(['abc', 'task-1', 'task-2']))
      mockUpdateTask.mockReturnValue(updated)

      const { status, body } = await request('PATCH', '/queue/tasks/abc/dependencies', {
        dependsOn: [
          { id: 'task-1', type: 'hard' },
          { id: 'task-2', type: 'soft' }
        ]
      })
      expect(status).toBe(200)
      expect(body).toEqual({
        id: 'abc',
        dependsOn: [
          { id: 'task-1', type: 'hard' },
          { id: 'task-2', type: 'soft' }
        ]
      })
      expect(mockUpdateTask).toHaveBeenCalledWith('abc', {
        depends_on: JSON.stringify([
          { id: 'task-1', type: 'hard' },
          { id: 'task-2', type: 'soft' }
        ])
      })
    })

    it('clears dependencies with null', async () => {
      const updated = { id: 'abc', depends_on: null }
      mockUpdateTask.mockReturnValue(updated)

      const { status, body } = await request('PATCH', '/queue/tasks/abc/dependencies', {
        dependsOn: null
      })
      expect(status).toBe(200)
      expect(body).toEqual({ id: 'abc', dependsOn: null })
    })

    it('rejects non-array dependsOn', async () => {
      const { status } = await request('PATCH', '/queue/tasks/abc/dependencies', {
        dependsOn: 'invalid'
      })
      expect(status).toBe(400)
    })

    it('rejects invalid dependency structure', async () => {
      const { status } = await request('PATCH', '/queue/tasks/abc/dependencies', {
        dependsOn: [{ id: 'task-1' }] // missing type
      })
      expect(status).toBe(400)
    })

    it('rejects invalid dependency type', async () => {
      const { status } = await request('PATCH', '/queue/tasks/abc/dependencies', {
        dependsOn: [{ id: 'task-1', type: 'invalid' }]
      })
      expect(status).toBe(400)
    })

    it('returns 404 when task not found', async () => {
      mockUpdateTask.mockReturnValue(null)

      const { status } = await request('PATCH', '/queue/tasks/missing/dependencies', {
        dependsOn: []
      })
      expect(status).toBe(404)
    })

    it('rejects dependencies with non-existent task IDs', async () => {
      mockGetTasksWithDependencies.mockReturnValue([
        { id: 'abc', depends_on: null, status: 'queued' },
        { id: 'existing-1', depends_on: null, status: 'done' }
      ])
      mockGetAllTaskIds.mockReturnValue(new Set(['abc', 'existing-1']))

      const { status, body } = await request('PATCH', '/queue/tasks/abc/dependencies', {
        dependsOn: [{ id: 'missing-task', type: 'hard' }]
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/task IDs do not exist/)
      expect((body as { error: string }).error).toMatch(/missing-task/)
      expect(mockUpdateTask).not.toHaveBeenCalled()
    })

    it('rejects dependencies that would create a cycle', async () => {
      mockGetTasksWithDependencies.mockReturnValue([
        { id: 'abc', depends_on: null, status: 'queued' },
        { id: 'task-a', depends_on: [{ id: 'task-b', type: 'hard' }], status: 'queued' },
        { id: 'task-b', depends_on: [{ id: 'abc', type: 'hard' }], status: 'queued' }
      ])
      mockGetAllTaskIds.mockReturnValue(new Set(['abc', 'task-a', 'task-b']))

      const { status, body } = await request('PATCH', '/queue/tasks/abc/dependencies', {
        dependsOn: [{ id: 'task-a', type: 'hard' }]
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/cycle detected/)
      expect(mockUpdateTask).not.toHaveBeenCalled()
    })

    it('rejects self-referencing dependencies', async () => {
      mockGetTasksWithDependencies.mockReturnValue([
        { id: 'abc', depends_on: null, status: 'queued' }
      ])
      mockGetAllTaskIds.mockReturnValue(new Set(['abc']))

      const { status, body } = await request('PATCH', '/queue/tasks/abc/dependencies', {
        dependsOn: [{ id: 'abc', type: 'hard' }]
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/cycle detected/)
      expect(mockUpdateTask).not.toHaveBeenCalled()
    })

    it('updates dependencies when validation passes', async () => {
      const updated = {
        id: 'abc',
        depends_on: [{ id: 'task-a', type: 'hard' }]
      }
      mockGetTasksWithDependencies.mockReturnValue([
        { id: 'abc', depends_on: null, status: 'queued' },
        { id: 'task-a', depends_on: null, status: 'done' }
      ])
      mockGetAllTaskIds.mockReturnValue(new Set(['abc', 'task-a']))
      mockUpdateTask.mockReturnValue(updated)

      const { status, body } = await request('PATCH', '/queue/tasks/abc/dependencies', {
        dependsOn: [{ id: 'task-a', type: 'hard' }]
      })
      expect(status).toBe(200)
      expect(body).toEqual({
        id: 'abc',
        dependsOn: [{ id: 'task-a', type: 'hard' }]
      })
      expect(mockUpdateTask).toHaveBeenCalledWith('abc', {
        depends_on: JSON.stringify([{ id: 'task-a', type: 'hard' }])
      })
    })
  })

  describe('GET /queue/events', () => {
    it('returns 200 SSE stream', async () => {
      // SSE streams never end, so we check the status code from the response
      // headers alone and then destroy the connection immediately.
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/queue/events',
            method: 'GET',
            headers: { Authorization: `Bearer ${TEST_API_KEY}` }
          },
          (res) => {
            resolve(res.statusCode ?? 0)
            res.destroy()
          }
        )
        req.on('error', (err) => {
          // ECONNRESET is expected because we destroy the response above.
          if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') resolve(200)
          else reject(err)
        })
        req.end()
      })
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

      // Pass empty Authorization to simulate a truly unauthenticated request
      const { status } = await request('GET', '/queue/health', undefined, {
        Authorization: ''
      })
      expect(status).toBe(401)
    })

    it('rejects requests with wrong bearer token', async () => {
      mockGetSetting.mockReturnValue('secret-key')

      const { status } = await request('GET', '/queue/health', undefined, {
        Authorization: 'Bearer wrong-key'
      })
      expect(status).toBe(403)
    })

    it('allows requests with correct bearer token', async () => {
      mockGetSetting.mockReturnValue('secret-key')
      mockGetQueueStats.mockReturnValue({
        backlog: 0,
        queued: 0,
        active: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
        error: 0
      })

      const { status } = await request('GET', '/queue/health', undefined, {
        Authorization: 'Bearer secret-key'
      })
      expect(status).toBe(200)
    })

    it('auto-generates a key when none is configured and rejects unauthenticated requests', async () => {
      mockGetSetting.mockReturnValue(null)
      mockGetQueueStats.mockReturnValue({
        backlog: 0,
        queued: 0,
        active: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
        error: 0
      })

      // Without a token, the request is rejected even though no key was pre-configured
      const { status } = await request('GET', '/queue/health', undefined, {
        Authorization: ''
      })
      expect(status).toBe(401)

      // setSetting should have been called to persist the auto-generated key
      expect(mockSetSetting).toHaveBeenCalledWith('taskRunner.apiKey', expect.any(String))
    })

    it('allows requests using the auto-generated key', async () => {
      // Simulate: no pre-existing key, but setSetting stores it for subsequent calls
      let capturedKey: string | null = null
      mockGetSetting.mockImplementation(() => capturedKey)
      mockSetSetting.mockImplementation((_key: string, value: string) => {
        capturedKey = value
      })
      mockGetQueueStats.mockReturnValue({
        backlog: 0,
        queued: 0,
        active: 0,
        done: 0,
        failed: 0,
        cancelled: 0,
        error: 0
      })

      // First request without token: triggers key generation, returns 401
      const first = await request('GET', '/queue/health', undefined, { Authorization: '' })
      expect(first.status).toBe(401)
      expect(capturedKey).not.toBeNull()

      // Second request with the generated key should succeed
      const second = await request('GET', '/queue/health', undefined, {
        Authorization: `Bearer ${capturedKey}`
      })
      expect(second.status).toBe(200)
    })
  })

  describe('CORS', () => {
    it('responds to OPTIONS with CORS headers', async () => {
      const { status } = await request('OPTIONS', '/queue/health')
      expect(status).toBe(204)
    })
  })

  describe('GET /queue/agents', () => {
    it('returns agent runs list', async () => {
      mockListAgentRunsByTaskId.mockResolvedValue([
        {
          id: 'run-1',
          status: 'done',
          model: 'claude-sonnet-4-5',
          task: 'fix bug',
          repo: 'bde',
          startedAt: '2025-01-01T00:00:00Z',
          finishedAt: '2025-01-01T01:00:00Z',
          exitCode: 0,
          costUsd: 0.45,
          tokensIn: 12000,
          tokensOut: 3400,
          source: 'bde'
        }
      ])
      const res = await request('GET', '/queue/agents')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      const agents = res.body as unknown[]
      expect(agents).toHaveLength(1)
      expect((agents[0] as Record<string, unknown>).id).toBe('run-1')
    })

    it('passes taskId filter to query', async () => {
      mockListAgentRunsByTaskId.mockResolvedValue([])
      await request('GET', '/queue/agents?taskId=task-abc&limit=5')
      expect(mockListAgentRunsByTaskId).toHaveBeenCalledWith('task-abc', 5)
    })

    it('uses default limit of 10', async () => {
      mockListAgentRunsByTaskId.mockResolvedValue([])
      await request('GET', '/queue/agents')
      expect(mockListAgentRunsByTaskId).toHaveBeenCalledWith(undefined, 10)
    })
  })

  describe('GET /queue/agents/:id/log', () => {
    it('returns 404 when agent does not exist', async () => {
      mockHasAgent.mockResolvedValue(false)
      const res = await request('GET', '/queue/agents/nonexistent/log')
      expect(res.status).toBe(404)
    })

    it('returns log content in tail mode (no fromByte)', async () => {
      mockHasAgent.mockResolvedValue(true)
      // First call: stat read (maxBytes=0) to get totalBytes
      mockReadLog.mockResolvedValueOnce({
        content: '',
        nextByte: 0,
        totalBytes: 5000
      })
      // Second call: actual read from tail offset
      mockReadLog.mockResolvedValueOnce({
        content: 'last 100 bytes of log...',
        nextByte: 5000,
        totalBytes: 5000
      })
      const res = await request('GET', '/queue/agents/run-1/log')
      expect(res.status).toBe(200)
      const body = res.body as Record<string, unknown>
      expect(body.content).toBe('last 100 bytes of log...')
      expect(body.totalBytes).toBe(5000)
    })

    it('returns log content from specific byte offset', async () => {
      mockHasAgent.mockResolvedValue(true)
      mockReadLog.mockResolvedValue({
        content: 'more log data',
        nextByte: 200,
        totalBytes: 200
      })
      const res = await request('GET', '/queue/agents/run-1/log?fromByte=100')
      expect(res.status).toBe(200)
      expect(mockReadLog).toHaveBeenCalledWith('run-1', 100, 50000)
    })

    it('caps maxBytes at 200KB', async () => {
      mockHasAgent.mockResolvedValue(true)
      mockReadLog.mockResolvedValue({ content: '', nextByte: 0, totalBytes: 0 })
      await request('GET', '/queue/agents/run-1/log?fromByte=0&maxBytes=999999')
      expect(mockReadLog).toHaveBeenCalledWith('run-1', 0, 204800)
    })
  })

  describe('Error handling — sprint-queries throws', () => {
    it('returns 500 when getQueueStats throws', async () => {
      mockGetQueueStats.mockImplementation(() => { throw new Error('Supabase connection failed'); })

      const { status, body } = await request('GET', '/queue/health')
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when listTasks throws', async () => {
      mockListTasks.mockImplementation(() => { throw new Error('Supabase timeout'); })

      const { status, body } = await request('GET', '/queue/tasks')
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when getTask throws', async () => {
      mockGetTask.mockImplementation(() => { throw new Error('network error'); })

      const { status, body } = await request('GET', '/queue/tasks/abc')
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when createTask throws', async () => {
      mockCreateTask.mockImplementation(() => { throw new Error('insert failed'); })

      const { status, body } = await request('POST', '/queue/tasks', {
        title: 'New task',
        repo: 'my-repo'
      })
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when claimTask throws', async () => {
      mockClaimTask.mockImplementation(() => { throw new Error('lock contention'); })

      const { status, body } = await request('POST', '/queue/tasks/abc/claim', {
        executorId: 'runner-1'
      })
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })

    it('returns 500 when releaseTask throws', async () => {
      mockReleaseTask.mockImplementation(() => { throw new Error('constraint violation'); })

      const { status, body } = await request('POST', '/queue/tasks/abc/release', {
        claimedBy: 'runner-1'
      })
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(/internal server error/i)
    })
  })

  describe('POST /queue/tasks/:id/output — event persistence', () => {
    it('persists curated event types via insertEventBatch', async () => {
      const events = [
        { type: 'agent:started', timestamp: '2026-01-01T00:00:00Z', model: 'claude-sonnet' },
        { type: 'agent:thinking', timestamp: '2026-01-01T00:00:01Z', tokenCount: 100 },
        {
          type: 'agent:tool_call',
          timestamp: '2026-01-01T00:00:02Z',
          tool: 'Bash',
          summary: 'run cmd'
        },
        {
          type: 'agent:completed',
          timestamp: '2026-01-01T00:01:00Z',
          exitCode: 0,
          costUsd: 0.1,
          tokensIn: 500,
          tokensOut: 200,
          durationMs: 60000
        }
      ]

      const res = await request('POST', '/queue/tasks/task-123/output', { events })
      expect(res.status).toBe(200)

      // insertEventBatch should be called with curated types only (not agent:thinking)
      expect(mockInsertEventBatch).toHaveBeenCalledTimes(1)
      const [, batch] = mockInsertEventBatch.mock.calls[0] as [
        unknown,
        Array<{ eventType: string }>
      ]
      const eventTypes = batch.map((e) => e.eventType)
      expect(eventTypes).toContain('agent:started')
      expect(eventTypes).toContain('agent:tool_call')
      expect(eventTypes).toContain('agent:completed')
      expect(eventTypes).not.toContain('agent:thinking')
    })

    it('uses agentId from body when provided', async () => {
      const events = [
        { type: 'agent:started', timestamp: '2026-01-01T00:00:00Z', model: 'claude-sonnet' }
      ]

      await request('POST', '/queue/tasks/task-123/output', { events, agentId: 'agent-abc' })

      expect(mockInsertEventBatch).toHaveBeenCalledTimes(1)
      const [, batch] = mockInsertEventBatch.mock.calls[0] as [unknown, Array<{ agentId: string }>]
      expect(batch[0].agentId).toBe('agent-abc')
    })

    it('falls back to taskId when agentId is not provided', async () => {
      const events = [{ type: 'agent:error', timestamp: '2026-01-01T00:00:00Z', message: 'oops' }]

      await request('POST', '/queue/tasks/task-xyz/output', { events })

      expect(mockInsertEventBatch).toHaveBeenCalledTimes(1)
      const [, batch] = mockInsertEventBatch.mock.calls[0] as [unknown, Array<{ agentId: string }>]
      expect(batch[0].agentId).toBe('task-xyz')
    })

    it('does not fail the request when insertEventBatch throws', async () => {
      mockInsertEventBatch.mockImplementation(() => {
        throw new Error('DB error')
      })
      const events = [{ type: 'agent:started', timestamp: '2026-01-01T00:00:00Z', model: 'claude' }]
      const res = await request('POST', '/queue/tasks/task-123/output', { events })
      expect(res.status).toBe(200)
    })

    it('skips insertEventBatch when no curated events present', async () => {
      const events = [{ type: 'agent:thinking', timestamp: '2026-01-01T00:00:00Z', tokenCount: 50 }]
      await request('POST', '/queue/tasks/task-123/output', { events })
      expect(mockInsertEventBatch).not.toHaveBeenCalled()
    })
  })

  describe('GET /queue/tasks/:id/events', () => {
    it('returns events for a task', async () => {
      mockQueryEvents.mockReturnValue({
        events: [
          {
            id: 1,
            agent_id: 'task-abc',
            event_type: 'agent:started',
            payload: '{}',
            timestamp: 1000
          },
          {
            id: 2,
            agent_id: 'task-abc',
            event_type: 'agent:completed',
            payload: '{}',
            timestamp: 2000
          }
        ],
        hasMore: false
      })

      const res = await request('GET', '/queue/tasks/task-abc/events')
      expect(res.status).toBe(200)

      const body = res.body as { events: unknown[]; hasMore: boolean }
      expect(body.hasMore).toBe(false)
      expect(body.events).toHaveLength(2)

      const first = body.events[0] as Record<string, unknown>
      expect(first.agentId).toBe('task-abc')
      expect(first.eventType).toBe('agent:started')
      expect(first.timestamp).toBe(1000)
    })

    it('passes eventType filter to queryEvents', async () => {
      mockQueryEvents.mockReturnValue({ events: [], hasMore: false })
      await request('GET', '/queue/tasks/task-abc/events?eventType=agent:tool_call')
      expect(mockQueryEvents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: 'agent:tool_call' })
      )
    })

    it('passes afterTimestamp filter to queryEvents', async () => {
      mockQueryEvents.mockReturnValue({ events: [], hasMore: false })
      await request('GET', '/queue/tasks/task-abc/events?afterTimestamp=1234567890')
      expect(mockQueryEvents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ afterTimestamp: 1234567890 })
      )
    })

    it('passes limit to queryEvents', async () => {
      mockQueryEvents.mockReturnValue({ events: [], hasMore: false })
      await request('GET', '/queue/tasks/task-abc/events?limit=50')
      expect(mockQueryEvents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ limit: 50 })
      )
    })

    it('caps limit at 1000', async () => {
      mockQueryEvents.mockReturnValue({ events: [], hasMore: false })
      await request('GET', '/queue/tasks/task-abc/events?limit=99999')
      expect(mockQueryEvents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ limit: 1000 })
      )
    })

    it('returns hasMore=true when more events available', async () => {
      mockQueryEvents.mockReturnValue({
        events: [
          {
            id: 1,
            agent_id: 'task-abc',
            event_type: 'agent:started',
            payload: '{}',
            timestamp: 1000
          }
        ],
        hasMore: true
      })
      const res = await request('GET', '/queue/tasks/task-abc/events')
      const body = res.body as { hasMore: boolean }
      expect(body.hasMore).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Batch operations
  // -------------------------------------------------------------------------
  describe('POST /queue/tasks/batch', () => {
    it('batch updates 3 tasks, all succeed', async () => {
      mockUpdateTask
        .mockResolvedValueOnce({ id: 't1', title: 'Updated 1' })
        .mockResolvedValueOnce({ id: 't2', title: 'Updated 2' })
        .mockResolvedValueOnce({ id: 't3', title: 'Updated 3' })

      const { status, body } = await request('POST', '/queue/tasks/batch', {
        operations: [
          { op: 'update', id: 't1', patch: { title: 'Updated 1' } },
          { op: 'update', id: 't2', patch: { title: 'Updated 2' } },
          { op: 'update', id: 't3', patch: { title: 'Updated 3' } }
        ]
      })
      expect(status).toBe(200)
      const b = body as { results: Array<{ id: string; op: string; ok: boolean }> }
      expect(b.results).toHaveLength(3)
      expect(b.results.every((r) => r.ok)).toBe(true)
      expect(mockUpdateTask).toHaveBeenCalledTimes(3)
    })

    it('batch mixed: 2 updates + 1 delete', async () => {
      mockUpdateTask
        .mockResolvedValueOnce({ id: 't1', title: 'Updated 1' })
        .mockResolvedValueOnce({ id: 't2', title: 'Updated 2' })
      mockDeleteTask.mockReturnValueOnce(undefined)

      const { status, body } = await request('POST', '/queue/tasks/batch', {
        operations: [
          { op: 'update', id: 't1', patch: { title: 'Updated 1' } },
          { op: 'delete', id: 't3' },
          { op: 'update', id: 't2', patch: { title: 'Updated 2' } }
        ]
      })
      expect(status).toBe(200)
      const b = body as { results: Array<{ id: string; op: string; ok: boolean }> }
      expect(b.results).toHaveLength(3)
      expect(b.results[0]).toMatchObject({ id: 't1', op: 'update', ok: true })
      expect(b.results[1]).toMatchObject({ id: 't3', op: 'delete', ok: true })
      expect(b.results[2]).toMatchObject({ id: 't2', op: 'update', ok: true })
      expect(mockDeleteTask).toHaveBeenCalledWith('t3')
    })

    it('returns per-item error for invalid operation type', async () => {
      const { status, body } = await request('POST', '/queue/tasks/batch', {
        operations: [{ op: 'merge', id: 't1' }]
      })
      expect(status).toBe(200)
      const b = body as { results: Array<{ id: string; ok: boolean; error?: string }> }
      expect(b.results).toHaveLength(1)
      expect(b.results[0].ok).toBe(false)
      expect(b.results[0].error).toMatch(/Unknown operation/)
    })

    it('returns per-item error for missing id', async () => {
      const { status, body } = await request('POST', '/queue/tasks/batch', {
        operations: [{ op: 'update' }]
      })
      expect(status).toBe(200)
      const b = body as { results: Array<{ id: string; ok: boolean; error?: string }> }
      expect(b.results).toHaveLength(1)
      expect(b.results[0].ok).toBe(false)
      expect(b.results[0].error).toMatch(/id and op are required/)
    })

    it('returns 400 when exceeding 50 operations', async () => {
      const operations = Array.from({ length: 51 }, (_, i) => ({
        op: 'update',
        id: `t${i}`,
        patch: { title: `Task ${i}` }
      }))

      const { status, body } = await request('POST', '/queue/tasks/batch', { operations })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/Maximum 50/)
    })

    it('returns 400 for empty operations array', async () => {
      const { status, body } = await request('POST', '/queue/tasks/batch', {
        operations: []
      })
      expect(status).toBe(400)
      expect((body as { error: string }).error).toMatch(/operations array is required/)
    })
  })

  // -------------------------------------------------------------------------
  // Spec quality guardrail tests
  // -------------------------------------------------------------------------
  describe('Spec quality guardrails', () => {
    const validSpec = `${'x'.repeat(60)}\n## Problem\nSomething is broken\n## Solution\nFix it`

    describe('POST /queue/tasks structural validation', () => {
      it('rejects task with no spec (non-backlog)', async () => {
        const { status, body } = await request('POST', '/queue/tasks', {
          title: 'Test task',
          repo: 'bde',
          status: 'queued'
        })
        expect(status).toBe(400)
        const b = body as { details: string[] }
        expect(b.details).toContainEqual(expect.stringContaining('spec is required'))
      })

      it('rejects task with 20-char spec (non-backlog)', async () => {
        const { status, body } = await request('POST', '/queue/tasks', {
          title: 'Test task',
          repo: 'bde',
          status: 'queued',
          spec: '## A\n## B\nshort spec'
        })
        expect(status).toBe(400)
        const b = body as { details: string[] }
        expect(b.details).toContainEqual(expect.stringContaining('minimum'))
      })

      it('creates task with valid spec (50+ chars, 2+ headings)', async () => {
        const created = {
          id: 'new-1',
          title: 'Test task',
          repo: 'bde',
          status: 'backlog',
          spec: validSpec
        }
        mockCreateTask.mockReturnValue(created)

        const { status } = await request('POST', '/queue/tasks', {
          title: 'Test task',
          repo: 'bde',
          spec: validSpec
        })
        expect(status).toBe(201)
      })

      it('allows backlog task without spec', async () => {
        const created = { id: 'new-1', title: 'Test task', repo: 'bde', status: 'backlog' }
        mockCreateTask.mockReturnValue(created)

        const { status } = await request('POST', '/queue/tasks', {
          title: 'Test task',
          repo: 'bde'
        })
        expect(status).toBe(201)
      })
    })

    describe('PATCH /queue/tasks/:id/status to queued', () => {
      it('rejects queue transition on task with bad spec', async () => {
        mockGetTask.mockReturnValue({
          id: 'abc',
          title: 'Test',
          repo: 'bde',
          spec: 'too short',
          status: 'backlog'
        })

        const { status, body } = await request('PATCH', '/queue/tasks/abc/status', {
          status: 'queued'
        })
        expect(status).toBe(400)
        const b = body as { error: string }
        expect(b.error).toContain('spec quality checks failed')
      })

      it('allows queue transition with skipValidation=true on bad spec', async () => {
        mockUpdateTask.mockReturnValue({ id: 'abc', status: 'queued' })

        const { status } = await request('PATCH', '/queue/tasks/abc/status?skipValidation=true', {
          status: 'queued'
        })
        expect(status).toBe(200)
      })

      it('does NOT trigger semantic checks for non-queued status transitions', async () => {
        mockUpdateTask.mockReturnValue({ id: 'abc', status: 'active' })

        await request('PATCH', '/queue/tasks/abc/status', {
          status: 'active'
        })

        expect(mockCheckSpecSemantic).not.toHaveBeenCalled()
      })

      it('allows queue transition when spec is valid and semantic passes', async () => {
        mockGetTask.mockReturnValue({
          id: 'abc',
          title: 'Test',
          repo: 'bde',
          spec: validSpec,
          status: 'backlog'
        })
        mockCheckSpecSemantic.mockResolvedValue({
          passed: true,
          hasFails: false,
          hasWarns: false,
          results: {},
          failMessages: [],
          warnMessages: []
        })
        mockUpdateTask.mockReturnValue({ id: 'abc', status: 'queued' })

        const { status } = await request('PATCH', '/queue/tasks/abc/status', {
          status: 'queued'
        })
        expect(status).toBe(200)
      })

      it('rejects queue transition when semantic check fails', async () => {
        mockGetTask.mockReturnValue({
          id: 'abc',
          title: 'Test',
          repo: 'bde',
          spec: validSpec,
          status: 'backlog'
        })
        mockCheckSpecSemantic.mockResolvedValue({
          passed: false,
          hasFails: true,
          hasWarns: false,
          results: {},
          failMessages: ['clarity: Too vague'],
          warnMessages: []
        })

        const { status, body } = await request('PATCH', '/queue/tasks/abc/status', {
          status: 'queued'
        })
        expect(status).toBe(400)
        const b = body as { error: string; details: string[] }
        expect(b.error).toContain('semantic')
        expect(b.details).toContainEqual(expect.stringContaining('clarity'))
      })
    })
  })
})
