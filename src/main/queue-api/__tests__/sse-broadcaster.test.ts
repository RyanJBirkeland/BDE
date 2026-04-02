// src/main/queue-api/__tests__/sse-broadcaster.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createSseBroadcaster } from '../sse-broadcaster'

function mockRes() {
  return {
    writeHead: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn(),
    on: vi.fn()
  } as any
}

describe('SSE Broadcaster', () => {
  it('broadcasts events to connected clients', () => {
    const broadcaster = createSseBroadcaster()
    const res = mockRes()
    broadcaster.addClient(res)
    broadcaster.broadcast('task:queued', { id: '1', title: 'Test' })
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: task:queued'))
  })

  it('removes disconnected clients on error', () => {
    const broadcaster = createSseBroadcaster()
    const res = mockRes()
    res.write.mockImplementation(() => {
      throw new Error('closed')
    })
    broadcaster.addClient(res)
    broadcaster.broadcast('test', {})
    expect(broadcaster.clientCount()).toBe(0)
  })

  it('sends :connected on addClient', () => {
    const broadcaster = createSseBroadcaster()
    const res = mockRes()
    broadcaster.addClient(res)
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'Content-Type': 'text/event-stream'
      })
    )
    expect(res.write).toHaveBeenCalledWith(':connected\n\n')
  })

  // QA-32: Test coverage for close() and heartbeat
  it('closes all clients and clears interval on close()', () => {
    const broadcaster = createSseBroadcaster()
    const res1 = mockRes()
    const res2 = mockRes()
    broadcaster.addClient(res1)
    broadcaster.addClient(res2)
    expect(broadcaster.clientCount()).toBe(2)

    broadcaster.close()

    expect(res1.end).toHaveBeenCalled()
    expect(res2.end).toHaveBeenCalled()
    expect(broadcaster.clientCount()).toBe(0)
  })

  it('rejects connections when max client limit is reached', () => {
    const broadcaster = createSseBroadcaster()
    const clients: any[] = []
    // Add clients up to the limit (100)
    for (let i = 0; i < 100; i++) {
      const res = mockRes()
      broadcaster.addClient(res)
      clients.push(res)
    }
    expect(broadcaster.clientCount()).toBe(100)

    // Try to add one more
    const rejectedRes = mockRes()
    broadcaster.addClient(rejectedRes)

    expect(rejectedRes.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' })
    expect(rejectedRes.end).toHaveBeenCalledWith(
      JSON.stringify({ error: 'Too many SSE connections' })
    )
    expect(broadcaster.clientCount()).toBe(100)

    broadcaster.close()
  })

  it('sends heartbeat to all clients', () => {
    vi.useFakeTimers()
    const broadcaster = createSseBroadcaster()
    const res1 = mockRes()
    const res2 = mockRes()
    broadcaster.addClient(res1)
    broadcaster.addClient(res2)

    // Clear previous write calls
    res1.write.mockClear()
    res2.write.mockClear()

    // Advance time by 30 seconds to trigger heartbeat
    vi.advanceTimersByTime(30_000)

    expect(res1.write).toHaveBeenCalledWith(':heartbeat\n\n')
    expect(res2.write).toHaveBeenCalledWith(':heartbeat\n\n')

    broadcaster.close()
    vi.useRealTimers()
  })

  it('removes clients that fail during heartbeat', () => {
    vi.useFakeTimers()
    const broadcaster = createSseBroadcaster()
    const res1 = mockRes()
    const res2 = mockRes()
    res1.write.mockImplementation((data: string) => {
      if (data === ':heartbeat\n\n') {
        throw new Error('connection closed')
      }
      return true
    })

    broadcaster.addClient(res1)
    broadcaster.addClient(res2)
    expect(broadcaster.clientCount()).toBe(2)

    // Trigger heartbeat
    vi.advanceTimersByTime(30_000)

    // res1 should be removed, res2 should remain
    expect(broadcaster.clientCount()).toBe(1)

    broadcaster.close()
    vi.useRealTimers()
  })
})
