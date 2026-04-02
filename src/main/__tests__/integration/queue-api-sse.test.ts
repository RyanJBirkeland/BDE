/**
 * Integration test: Queue API SSE event delivery.
 *
 * Starts the real server on a random port, connects an SSE client via
 * Node.js http module, and verifies event-stream responses and broadcast
 * delivery.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'

// ---------------------------------------------------------------------------
// Mock sprint-queries — intercept all Supabase calls
// ---------------------------------------------------------------------------

vi.mock('../../data/sprint-queries', () => ({
  getQueueStats: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn()
}))

// Mock settings — provide a known API key for auth
// Note: Use string literal directly in mock factory to avoid hoisting issues
vi.mock('../../settings', () => ({
  getSetting: vi.fn().mockReturnValue('sse-test-key'),
  setSetting: vi.fn()
}))

const SSE_TEST_KEY = 'sse-test-key'

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
import { sseBroadcaster } from '../../queue-api/router'

let port: number

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
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Connect to the SSE endpoint and collect raw chunks until closed or timeout. */
function connectSse(
  path: string,
  opts?: { timeoutMs?: number }
): Promise<{
  status: number
  headers: http.IncomingHttpHeaders
  chunks: string[]
  close: () => void
}> {
  const timeoutMs = opts?.timeoutMs ?? 5000
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('SSE connection timed out'))
    }, timeoutMs)

    const req = http.get(
      { hostname: '127.0.0.1', port, path, headers: { Authorization: `Bearer ${SSE_TEST_KEY}` } },
      (res) => {
        const chunks: string[] = []
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => chunks.push(chunk))

        // Resolve once we get the initial response headers
        clearTimeout(timer)
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          chunks,
          close: () => {
            res.destroy()
            req.destroy()
          }
        })
      }
    )
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/** Wait for a condition (polling) up to a timeout. */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 3000, intervalMs = 50 } = {}
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue API SSE event delivery', () => {
  it('returns 200 with text/event-stream content type', async () => {
    const sse = await connectSse('/queue/events')
    try {
      expect(sse.status).toBe(200)
      expect(sse.headers['content-type']).toBe('text/event-stream')
      expect(sse.headers['cache-control']).toBe('no-cache')

      // Should receive the initial :connected comment
      await waitFor(() => sse.chunks.length > 0)
      expect(sse.chunks.join('')).toContain(':connected')
    } finally {
      sse.close()
    }
  })

  it('delivers broadcast events to connected SSE client', async () => {
    const sse = await connectSse('/queue/events')
    try {
      // Wait for initial :connected message
      await waitFor(() => sse.chunks.length > 0)

      // Broadcast a task event
      const eventPayload = {
        taskId: 'task-123',
        type: 'agent:started',
        message: 'Agent started working'
      }
      sseBroadcaster.broadcast('task:output', eventPayload)

      // Wait for the broadcast to arrive
      await waitFor(() => {
        const combined = sse.chunks.join('')
        return combined.includes('event: task:output')
      })

      const combined = sse.chunks.join('')
      expect(combined).toContain('event: task:output')
      expect(combined).toContain(`"taskId":"task-123"`)
      expect(combined).toContain(`"message":"Agent started working"`)

      // Parse the data line to verify it's valid JSON
      const dataMatch = combined.match(/data: (.+)\n/)
      expect(dataMatch).not.toBeNull()
      const parsed = JSON.parse(dataMatch![1])
      expect(parsed).toMatchObject(eventPayload)
    } finally {
      sse.close()
    }
  })

  it('delivers multiple events in order', async () => {
    const sse = await connectSse('/queue/events')
    try {
      await waitFor(() => sse.chunks.length > 0)

      // Broadcast two events
      sseBroadcaster.broadcast('task:output', { taskId: 'task-1', seq: 1 })
      sseBroadcaster.broadcast('task:output', { taskId: 'task-2', seq: 2 })

      await waitFor(() => {
        const combined = sse.chunks.join('')
        return combined.includes('"seq":2')
      })

      const combined = sse.chunks.join('')
      const seq1Index = combined.indexOf('"seq":1')
      const seq2Index = combined.indexOf('"seq":2')
      expect(seq1Index).toBeLessThan(seq2Index)
    } finally {
      sse.close()
    }
  })

  it('broadcasts only to currently connected clients', async () => {
    // Connect two SSE clients
    const sse1 = await connectSse('/queue/events')
    const sse2 = await connectSse('/queue/events')
    try {
      // Wait for both to receive :connected
      await waitFor(() => sse1.chunks.length > 0 && sse2.chunks.length > 0)

      // Broadcast an event — both should receive it
      sseBroadcaster.broadcast('task:output', { test: 'multi-client' })

      await waitFor(() => {
        const c1 = sse1.chunks.join('')
        const c2 = sse2.chunks.join('')
        return c1.includes('"test":"multi-client"') && c2.includes('"test":"multi-client"')
      })

      expect(sse1.chunks.join('')).toContain('"test":"multi-client"')
      expect(sse2.chunks.join('')).toContain('"test":"multi-client"')
    } finally {
      sse1.close()
      sse2.close()
    }
  })
})
