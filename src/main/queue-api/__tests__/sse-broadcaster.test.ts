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
})
