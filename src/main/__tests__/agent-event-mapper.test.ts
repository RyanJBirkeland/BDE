/**
 * Tests for agent-event-mapper.ts batching and emission.
 *
 * Tests the batched SQLite write behavior — events are queued and flushed
 * either when the batch reaches 50 events or after 100ms timeout.
 * Broadcasts happen via broadcastCoalesced (agent:event:batch channel).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const broadcastCoalescedMock = vi.fn()
const insertEventBatchMock = vi.fn()
const getDbMock = vi.fn(() => ({}) as unknown)
const loggerInfoMock = vi.fn()
const loggerWarnMock = vi.fn()
const loggerErrorMock = vi.fn()
const loggerDebugMock = vi.fn()

vi.mock('../broadcast', () => ({
  broadcastCoalesced: (...args: unknown[]) => broadcastCoalescedMock(...args)
}))

vi.mock('../data/event-queries', () => ({
  insertEventBatch: (...args: unknown[]) => insertEventBatchMock(...args)
}))

vi.mock('../db', () => ({
  getDb: () => getDbMock()
}))

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
    debug: loggerDebugMock
  })
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules() // Reset module state between tests
  broadcastCoalescedMock.mockReset()
  insertEventBatchMock.mockReset()
  loggerInfoMock.mockReset()
  loggerWarnMock.mockReset()
  loggerErrorMock.mockReset()
  loggerDebugMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('emitAgentEvent batching', () => {
  it('queues events and broadcasts immediately', async () => {
    const { emitAgentEvent } = await import('../agent-event-mapper')

    emitAgentEvent('agent-1', { type: 'agent:text', text: 'hello', timestamp: 123 })

    // Broadcast should be queued via broadcastCoalesced immediately
    expect(broadcastCoalescedMock).toHaveBeenCalledTimes(1)
    expect(broadcastCoalescedMock).toHaveBeenCalledWith('agent:event', {
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
    expect(broadcastCoalescedMock).toHaveBeenCalled()
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

describe('mapRawMessage tool_result from user content blocks', () => {
  it('emits agent:tool_result for user-message tool_result blocks, using the tool name seen in the prior assistant tool_use', async () => {
    const { mapRawMessage } = await import('../agent-event-mapper')

    const assistantEvents = mapRawMessage({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'reading' },
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'Read',
            input: { file_path: 'README.md' }
          }
        ]
      }
    })
    expect(assistantEvents.map((e) => e.type)).toEqual(['agent:text', 'agent:tool_call'])

    const userEvents = mapRawMessage({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_abc',
            content: 'file contents here',
            is_error: false
          }
        ]
      }
    })
    expect(userEvents).toHaveLength(1)
    const resultEvent = userEvents[0] as Extract<
      ReturnType<typeof mapRawMessage>[number],
      { type: 'agent:tool_result' }
    >
    expect(resultEvent.type).toBe('agent:tool_result')
    expect(resultEvent.tool).toBe('Read')
    expect(resultEvent.success).toBe(true)
    expect(resultEvent.output).toBe('file contents here')
  })

  it('marks tool_result success=false when is_error is true', async () => {
    const { mapRawMessage } = await import('../agent-event-mapper')

    mapRawMessage({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_err', name: 'Bash', input: { command: 'x' } }]
      }
    })

    const events = mapRawMessage({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_err', content: 'boom', is_error: true }
        ]
      }
    })
    expect(events).toHaveLength(1)
    const result = events[0] as Extract<
      ReturnType<typeof mapRawMessage>[number],
      { type: 'agent:tool_result' }
    >
    expect(result.success).toBe(false)
    expect(result.tool).toBe('Bash')
  })

  it('emits tool_result with tool="unknown" when no matching tool_use was seen', async () => {
    const { mapRawMessage } = await import('../agent-event-mapper')

    const events = mapRawMessage({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_orphan',
            content: 'whatever',
            is_error: false
          }
        ]
      }
    })
    expect(events).toHaveLength(1)
    const result = events[0] as Extract<
      ReturnType<typeof mapRawMessage>[number],
      { type: 'agent:tool_result' }
    >
    expect(result.tool).toBe('unknown')
  })

  it('ignores non-tool_result content blocks inside user messages', async () => {
    const { mapRawMessage } = await import('../agent-event-mapper')

    const events = mapRawMessage({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'just a message' }]
      }
    })
    expect(events).toEqual([])
  })
})

describe('EP-15: DLQ sentinel on permanent batch failure', () => {
  it('logs WARN with droppedCount and sampleAgentIds, clears pending, resets counter', async () => {
    const {
      emitAgentEvent,
      flushAgentEventBatcher,
      getDroppedEventCount,
      __resetDroppedEventCount
    } = await import('../agent-event-mapper')

    __resetDroppedEventCount()

    insertEventBatchMock.mockImplementation(() => {
      throw new Error('SQLITE_LOCKED')
    })

    // Emit 3 events across two agents
    emitAgentEvent('agent-A', { type: 'agent:text', text: 'a', timestamp: 1 })
    emitAgentEvent('agent-A', { type: 'agent:text', text: 'b', timestamp: 2 })
    emitAgentEvent('agent-B', { type: 'agent:text', text: 'c', timestamp: 3 })

    // Fail 5 consecutive times
    for (let i = 0; i < 5; i++) {
      flushAgentEventBatcher()
    }

    // The 5th flush should have triggered the DLQ sentinel WARN
    const dlqWarn = loggerWarnMock.mock.calls.find((call) =>
      String(call[0]).includes('event-batcher: permanent failure — dropping events')
    )
    expect(dlqWarn).toBeDefined()
    const payload = String(dlqWarn?.[0])
    expect(payload).toContain('"droppedCount":3')
    expect(payload).toContain('agent-A')
    expect(payload).toContain('agent-B')
    expect(payload).toContain('SQLITE_LOCKED')

    // The dropped counter should reflect the loss
    expect(getDroppedEventCount()).toBe(3)

    // Reset mock; another flush should be a no-op (pending was cleared)
    insertEventBatchMock.mockReset()
    flushAgentEventBatcher()
    expect(insertEventBatchMock).not.toHaveBeenCalled()

    // After the DLQ drop the failure counter resets — subsequent failures
    // count fresh, not as failure #6.
    insertEventBatchMock.mockImplementation(() => {
      throw new Error('SQLITE_LOCKED')
    })
    emitAgentEvent('agent-C', { type: 'agent:text', text: 'd', timestamp: 4 })
    flushAgentEventBatcher()
    // One attempt, event re-queued — circuit breaker not tripped.
    expect(insertEventBatchMock).toHaveBeenCalledTimes(1)
  })
})

describe('EP-15: per-run tool-name map isolation', () => {
  it('does not share tool-use IDs between concurrent agents', async () => {
    const { mapRawMessage, __resetAllToolNameTracking } = await import('../agent-event-mapper')
    __resetAllToolNameTracking()

    // Agent A registers a tool_use with id "toolu_shared" -> Read
    mapRawMessage(
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_shared', name: 'Read', input: { file_path: 'a.md' } }
          ]
        }
      },
      'agent-A'
    )

    // Agent B sees a tool_result with the same tool_use_id but never registered
    // it for itself. Without per-agent isolation, agent B would label it "Read".
    const eventsForB = mapRawMessage(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_shared', content: 'x', is_error: false }
          ]
        }
      },
      'agent-B'
    )
    const resultB = eventsForB[0] as Extract<
      ReturnType<typeof mapRawMessage>[number],
      { type: 'agent:tool_result' }
    >
    expect(resultB.tool).toBe('unknown')

    // Agent A still resolves the tool name correctly.
    const eventsForA = mapRawMessage(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_shared', content: 'y', is_error: false }
          ]
        }
      },
      'agent-A'
    )
    const resultA = eventsForA[0] as Extract<
      ReturnType<typeof mapRawMessage>[number],
      { type: 'agent:tool_result' }
    >
    expect(resultA.tool).toBe('Read')
  })

  it('clears per-agent tool-name entries on agent:started', async () => {
    const { mapRawMessage, emitAgentEvent, __resetAllToolNameTracking } =
      await import('../agent-event-mapper')
    __resetAllToolNameTracking()
    insertEventBatchMock.mockReset()

    // Agent X registers a tool_use, then a new run starts (agent:started).
    mapRawMessage(
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_stale', name: 'Read', input: { file_path: 'a.md' } }
          ]
        }
      },
      'agent-X'
    )

    emitAgentEvent('agent-X', { type: 'agent:started', model: 'sonnet', timestamp: 1 })

    // Tool result arriving after the new run should not pick up the stale name.
    const events = mapRawMessage(
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_stale', content: 'z', is_error: false }
          ]
        }
      },
      'agent-X'
    )
    const result = events[0] as Extract<
      ReturnType<typeof mapRawMessage>[number],
      { type: 'agent:tool_result' }
    >
    expect(result.tool).toBe('unknown')
  })
})

describe('mapRawMessage rate-limits unrecognized message-type logs', () => {
  it('logs an unknown message type at most once across 100 calls', async () => {
    const { mapRawMessage, __resetUnknownMessageTypeSentinel } =
      await import('../agent-event-mapper')
    __resetUnknownMessageTypeSentinel()

    for (let i = 0; i < 100; i++) {
      mapRawMessage({ type: 'mystery_control_frame' })
    }

    expect(loggerInfoMock).toHaveBeenCalledTimes(1)
    expect(loggerInfoMock).toHaveBeenCalledWith(expect.stringContaining('mystery_control_frame'))
  })

  it('logs distinct unknown types separately, but each at most once', async () => {
    const { mapRawMessage, __resetUnknownMessageTypeSentinel } =
      await import('../agent-event-mapper')
    __resetUnknownMessageTypeSentinel()

    for (let i = 0; i < 50; i++) {
      mapRawMessage({ type: 'frame_a' })
      mapRawMessage({ type: 'frame_b' })
    }

    expect(loggerInfoMock).toHaveBeenCalledTimes(2)
    const loggedTypes = loggerInfoMock.mock.calls.map((c) => c[0]).join('\n')
    expect(loggedTypes).toContain('frame_a')
    expect(loggedTypes).toContain('frame_b')
  })

  it('__resetUnknownMessageTypeSentinel allows the first-occurrence log path again', async () => {
    const { mapRawMessage, __resetUnknownMessageTypeSentinel } =
      await import('../agent-event-mapper')
    __resetUnknownMessageTypeSentinel()

    mapRawMessage({ type: 'frame_x' })
    mapRawMessage({ type: 'frame_x' })
    expect(loggerInfoMock).toHaveBeenCalledTimes(1)

    __resetUnknownMessageTypeSentinel()
    mapRawMessage({ type: 'frame_x' })
    expect(loggerInfoMock).toHaveBeenCalledTimes(2)
  })
})
