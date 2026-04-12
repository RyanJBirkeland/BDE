/**
 * Tests for agent-event-mapper.ts batching and emission.
 *
 * Tests the batched SQLite write behavior — events are queued and flushed
 * either when the batch reaches 50 events or after 100ms timeout.
 * Broadcasts happen immediately for live tail UX.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const broadcastMock = vi.fn()
const insertEventBatchMock = vi.fn()
const getDbMock = vi.fn(() => ({}) as unknown)

vi.mock('../broadcast', () => ({
  broadcast: (...args: unknown[]) => broadcastMock(...args)
}))

vi.mock('../data/event-queries', () => ({
  insertEventBatch: (...args: unknown[]) => insertEventBatchMock(...args)
}))

vi.mock('../db', () => ({
  getDb: () => getDbMock()
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules() // Reset module state between tests
  broadcastMock.mockReset()
  insertEventBatchMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('emitAgentEvent batching', () => {
  it('queues events and broadcasts immediately', async () => {
    const { emitAgentEvent } = await import('../agent-event-mapper')

    emitAgentEvent('agent-1', { type: 'agent:text', text: 'hello', timestamp: 123 })

    // Broadcast should fire immediately
    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: { type: 'agent:text', text: 'hello', timestamp: 123 }
    })

    // SQLite write should NOT happen immediately (batched)
    expect(insertEventBatchMock).not.toHaveBeenCalled()
  })

  it('flushes batch when reaching 50 events', async () => {
    const { emitAgentEvent } = await import('../agent-event-mapper')

    // Emit 49 events — should not flush
    for (let i = 0; i < 49; i++) {
      emitAgentEvent('agent-1', { type: 'agent:text', text: `msg${i}`, timestamp: i })
    }
    expect(insertEventBatchMock).not.toHaveBeenCalled()

    // 50th event should trigger flush
    emitAgentEvent('agent-1', { type: 'agent:text', text: 'msg49', timestamp: 49 })

    expect(insertEventBatchMock).toHaveBeenCalledTimes(1)
    const [_db, batch] = insertEventBatchMock.mock.calls[0]
    expect(batch).toHaveLength(50)
    expect(batch[0].agentId).toBe('agent-1')
    expect(batch[0].eventType).toBe('agent:text')
    expect(JSON.parse(batch[0].payload)).toEqual({ type: 'agent:text', text: 'msg0', timestamp: 0 })
  })

  it('flushes batch after 100ms timeout', async () => {
    const { emitAgentEvent } = await import('../agent-event-mapper')

    // Emit 3 events
    emitAgentEvent('agent-1', { type: 'agent:text', text: 'a', timestamp: 1 })
    emitAgentEvent('agent-1', { type: 'agent:text', text: 'b', timestamp: 2 })
    emitAgentEvent('agent-1', { type: 'agent:text', text: 'c', timestamp: 3 })

    expect(insertEventBatchMock).not.toHaveBeenCalled()

    // Advance timers by 110ms (past the 100ms threshold)
    vi.advanceTimersByTime(110)

    expect(insertEventBatchMock).toHaveBeenCalledTimes(1)
    const [_db, batch] = insertEventBatchMock.mock.calls[0]
    expect(batch).toHaveLength(3)
  })

  it('flushes on explicit flushAgentEventBatcher call (shutdown)', async () => {
    const { emitAgentEvent, flushAgentEventBatcher } = await import('../agent-event-mapper')

    emitAgentEvent('agent-1', { type: 'agent:text', text: 'shutdown test', timestamp: 99 })

    expect(insertEventBatchMock).not.toHaveBeenCalled()

    // Explicit flush (simulating shutdown)
    flushAgentEventBatcher()

    expect(insertEventBatchMock).toHaveBeenCalledTimes(1)
    const [_db, batch] = insertEventBatchMock.mock.calls[0]
    expect(batch).toHaveLength(1)
    expect(batch[0].agentId).toBe('agent-1')
  })

  it('still broadcasts when SQLite batch write fails', async () => {
    const { emitAgentEvent, flushAgentEventBatcher } = await import('../agent-event-mapper')

    insertEventBatchMock.mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })

    emitAgentEvent('agent-2', { type: 'agent:text', text: 'hi', timestamp: 1 })

    expect(() => flushAgentEventBatcher()).not.toThrow()

    expect(insertEventBatchMock).toHaveBeenCalled()
    expect(broadcastMock).toHaveBeenCalled()
  })

  it('does not flush when queue is empty', async () => {
    const { flushAgentEventBatcher } = await import('../agent-event-mapper')

    flushAgentEventBatcher()

    expect(insertEventBatchMock).not.toHaveBeenCalled()
  })

  it('re-queues events on SQLite failure', async () => {
    const { emitAgentEvent, flushAgentEventBatcher } = await import('../agent-event-mapper')

    insertEventBatchMock.mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY')
    })

    // Emit 3 events and flush
    emitAgentEvent('agent-1', { type: 'agent:text', text: 'a', timestamp: 1 })
    emitAgentEvent('agent-1', { type: 'agent:text', text: 'b', timestamp: 2 })
    emitAgentEvent('agent-1', { type: 'agent:text', text: 'c', timestamp: 3 })
    flushAgentEventBatcher()

    // First flush should fail and re-queue
    expect(insertEventBatchMock).toHaveBeenCalledTimes(1)

    // Reset mock to succeed on retry
    insertEventBatchMock.mockReset()

    // Second flush should succeed with the re-queued events
    flushAgentEventBatcher()

    expect(insertEventBatchMock).toHaveBeenCalledTimes(1)
    const [_db, batch] = insertEventBatchMock.mock.calls[0]
    expect(batch).toHaveLength(3)
    expect(batch[0].agentId).toBe('agent-1')
    expect(JSON.parse(batch[0].payload)).toEqual({ type: 'agent:text', text: 'a', timestamp: 1 })
  })

  it('triggers circuit breaker after 5 consecutive failures', async () => {
    const { emitAgentEvent, flushAgentEventBatcher } = await import('../agent-event-mapper')

    insertEventBatchMock.mockImplementation(() => {
      throw new Error('SQLITE_LOCKED')
    })

    // Emit 2 events
    emitAgentEvent('agent-1', { type: 'agent:text', text: 'a', timestamp: 1 })
    emitAgentEvent('agent-1', { type: 'agent:text', text: 'b', timestamp: 2 })

    // Fail 5 times — events should be re-queued each time
    for (let i = 0; i < 4; i++) {
      flushAgentEventBatcher()
    }

    // 5th failure should trigger circuit breaker
    flushAgentEventBatcher()

    // Should have attempted 5 times
    expect(insertEventBatchMock).toHaveBeenCalledTimes(5)

    // Reset mock to succeed
    insertEventBatchMock.mockReset()

    // 6th flush should not re-queue (circuit breaker tripped)
    flushAgentEventBatcher()

    // Queue should now be empty — no events to flush
    expect(insertEventBatchMock).not.toHaveBeenCalled()
  })

  it('caps pending events at 10000', async () => {
    const { emitAgentEvent, flushAgentEventBatcher } = await import('../agent-event-mapper')

    // Make insertEventBatch fail to trigger re-queue
    insertEventBatchMock.mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })

    // Emit 50 events to trigger auto-flush
    for (let i = 0; i < 50; i++) {
      emitAgentEvent('agent-1', { type: 'agent:text', text: `msg${i}`, timestamp: i })
    }

    // Flush fails, re-queues 50 events
    expect(insertEventBatchMock).toHaveBeenCalledTimes(1)

    // Emit 10000 more events (should trigger multiple auto-flushes)
    for (let i = 50; i < 10050; i++) {
      emitAgentEvent('agent-1', { type: 'agent:text', text: `msg${i}`, timestamp: i })
    }

    // Reset mock to succeed and flush
    insertEventBatchMock.mockReset()
    flushAgentEventBatcher()

    // Should have capped at 10000
    const [_db, batch] = insertEventBatchMock.mock.calls[0]
    expect(batch.length).toBeLessThanOrEqual(10000)
  })

  it('resets consecutive failures on successful flush', async () => {
    const { emitAgentEvent, flushAgentEventBatcher } = await import('../agent-event-mapper')

    // Fail once
    insertEventBatchMock.mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY')
    })

    emitAgentEvent('agent-1', { type: 'agent:text', text: 'a', timestamp: 1 })
    flushAgentEventBatcher()

    // Now succeed
    insertEventBatchMock.mockReset()
    flushAgentEventBatcher()

    expect(insertEventBatchMock).toHaveBeenCalledTimes(1)

    // Fail 4 more times — should not trigger circuit breaker (counter was reset)
    insertEventBatchMock.mockReset()
    insertEventBatchMock.mockImplementation(() => {
      throw new Error('SQLITE_LOCKED')
    })

    for (let i = 0; i < 4; i++) {
      emitAgentEvent('agent-1', { type: 'agent:text', text: `b${i}`, timestamp: i + 2 })
      flushAgentEventBatcher()
    }

    // Should have attempted 4 times and still be re-queuing
    expect(insertEventBatchMock).toHaveBeenCalledTimes(4)

    // Reset and flush — should still have events
    insertEventBatchMock.mockReset()
    flushAgentEventBatcher()

    expect(insertEventBatchMock).toHaveBeenCalledTimes(1)
  })
})
