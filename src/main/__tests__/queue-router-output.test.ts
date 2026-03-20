import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IncomingMessage, ServerResponse } from 'http'
import { EventEmitter } from 'events'

// Mock electron BrowserWindow
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}))

// Mock sprint-local
vi.mock('../handlers/sprint-local', () => ({
  getTask: vi.fn(),
  listTasks: vi.fn().mockReturnValue([]),
  claimTask: vi.fn(),
  updateTask: vi.fn(),
  getQueueStats: vi.fn().mockReturnValue({}),
}))

// Mock sprint-listeners (used by event-store)
vi.mock('../handlers/sprint-listeners', () => ({
  onSprintMutation: vi.fn().mockReturnValue(() => {}),
}))

// Mock sse
vi.mock('../queue-api/sse', () => ({
  addSseClient: vi.fn(),
}))

import { handleRequest } from '../queue-api/router'
import { getTask } from '../handlers/sprint-local'

function createMockReq(method: string, url: string, body?: unknown): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage
  req.method = method
  req.url = url

  // Simulate body data
  setTimeout(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(JSON.stringify(body)))
    }
    req.emit('end')
  }, 0)

  return req
}

function createMockRes(): ServerResponse & { _data: string; _statusCode: number } {
  const res = new EventEmitter() as ServerResponse & { _data: string; _statusCode: number }
  res._data = ''
  res._statusCode = 200
  res.writeHead = vi.fn((status: number) => {
    res._statusCode = status
    return res
  }) as unknown as typeof res.writeHead
  res.end = vi.fn((...args: unknown[]) => {
    const data = typeof args[0] === 'string' ? args[0] : undefined
    if (data) res._data = data
    return res
  }) as unknown as typeof res.end
  return res
}

function getBody(res: { _data: string }): Record<string, unknown> {
  return JSON.parse(res._data) as Record<string, unknown>
}

describe('POST /queue/tasks/:id/output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when body has no events array', async () => {
    vi.mocked(getTask).mockReturnValue({ id: 'task-1' } as ReturnType<typeof getTask>)
    const req = createMockReq('POST', '/queue/tasks/task-1/output', { notEvents: true })
    const res = createMockRes()
    await handleRequest(req, res)
    expect(res._statusCode).toBe(400)
    expect(getBody(res).error).toContain('events')
  })

  it('returns 400 when events array is empty', async () => {
    vi.mocked(getTask).mockReturnValue({ id: 'task-1' } as ReturnType<typeof getTask>)
    const req = createMockReq('POST', '/queue/tasks/task-1/output', { events: [] })
    const res = createMockRes()
    await handleRequest(req, res)
    expect(res._statusCode).toBe(400)
  })

  it('returns 400 when event taskId mismatches URL', async () => {
    vi.mocked(getTask).mockReturnValue({ id: 'task-1' } as ReturnType<typeof getTask>)
    const req = createMockReq('POST', '/queue/tasks/task-1/output', {
      events: [{ taskId: 'task-other', timestamp: '2026-01-01T00:00:00Z', type: 'agent:started' }],
    })
    const res = createMockRes()
    await handleRequest(req, res)
    expect(res._statusCode).toBe(400)
    expect(getBody(res).error).toContain('does not match')
  })

  it('returns 400 when event is missing required fields', async () => {
    vi.mocked(getTask).mockReturnValue({ id: 'task-1' } as ReturnType<typeof getTask>)
    const req = createMockReq('POST', '/queue/tasks/task-1/output', {
      events: [{ taskId: 'task-1' }], // missing timestamp and type
    })
    const res = createMockRes()
    await handleRequest(req, res)
    expect(res._statusCode).toBe(400)
    expect(getBody(res).error).toContain('timestamp')
  })

  it('returns 404 when task does not exist', async () => {
    vi.mocked(getTask).mockReturnValue(undefined as unknown as ReturnType<typeof getTask>)
    const req = createMockReq('POST', '/queue/tasks/nonexistent/output', {
      events: [{ taskId: 'nonexistent', timestamp: '2026-01-01T00:00:00Z', type: 'agent:started' }],
    })
    const res = createMockRes()
    await handleRequest(req, res)
    expect(res._statusCode).toBe(404)
  })

  it('returns 200 with received count on valid request', async () => {
    vi.mocked(getTask).mockReturnValue({ id: 'task-1' } as ReturnType<typeof getTask>)
    const req = createMockReq('POST', '/queue/tasks/task-1/output', {
      events: [
        { taskId: 'task-1', timestamp: '2026-01-01T00:00:00Z', type: 'agent:started', model: 'sonnet' },
        { taskId: 'task-1', timestamp: '2026-01-01T00:00:01Z', type: 'agent:tool_call', tool: 'edit', summary: 'test' },
      ],
    })
    const res = createMockRes()
    await handleRequest(req, res)
    expect(res._statusCode).toBe(200)
    expect(getBody(res)).toEqual({ received: 2 })
  })
})
