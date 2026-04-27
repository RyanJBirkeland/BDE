import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TurnTracker, type InsertTurnFn } from '../turn-tracker'

describe('turn-tracker', () => {
  let tracker: TurnTracker
  let insertTurnSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    insertTurnSpy = vi.fn()
    tracker = new TurnTracker('run-123', { insertTurn: insertTurnSpy as InsertTurnFn })
  })

  describe('processMessage', () => {
    it('should ignore non-object messages', () => {
      tracker.processMessage(null)
      tracker.processMessage('string')
      tracker.processMessage(123)
      tracker.processMessage(undefined)

      const totals = tracker.totals()
      expect(totals.turnCount).toBe(0)
    })

    it('should ignore non-assistant messages', () => {
      tracker.processMessage({ type: 'user', message: { content: [] } })
      tracker.processMessage({ type: 'tool_result', message: {} })

      const totals = tracker.totals()
      expect(totals.turnCount).toBe(0)
    })

    it('should track assistant message token usage from message.usage', () => {
      tracker.processMessage({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 150
          },
          content: []
        }
      })

      const totals = tracker.totals()
      expect(totals.tokensIn).toBe(100)
      expect(totals.tokensOut).toBe(50)
      expect(totals.cacheTokensCreated).toBe(200)
      expect(totals.cacheTokensRead).toBe(150)
      expect(totals.turnCount).toBe(1)
    })

    it('should fallback to msg.usage if message.usage absent', () => {
      tracker.processMessage({
        type: 'assistant',
        usage: {
          input_tokens: 75,
          output_tokens: 25
        },
        content: []
      })

      const totals = tracker.totals()
      expect(totals.tokensIn).toBe(75)
      expect(totals.tokensOut).toBe(25)
    })

    it('should accumulate tokens across turns', () => {
      tracker.processMessage({
        type: 'assistant',
        message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] }
      })
      tracker.processMessage({
        type: 'assistant',
        message: { usage: { input_tokens: 200, output_tokens: 75 }, content: [] }
      })

      const totals = tracker.totals()
      expect(totals.tokensIn).toBe(300)
      expect(totals.tokensOut).toBe(125)
      expect(totals.turnCount).toBe(2)
    })

    it('should count tool_use blocks in content', () => {
      tracker.processMessage({
        type: 'assistant',
        message: {
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'tool_use', name: 'Read', input: {} },
            { type: 'tool_use', name: 'Grep', input: {} }
          ]
        }
      })

      expect(insertTurnSpy).toHaveBeenCalledWith({
        runId: 'run-123',
        turn: 1,
        tokensIn: 100,
        tokensOut: 50,
        toolCalls: 2,
        cacheTokensCreated: 0,
        cacheTokensRead: 0
      })
    })

    it('should reset tool call count after each turn', () => {
      tracker.processMessage({
        type: 'assistant',
        message: {
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [{ type: 'tool_use', name: 'Read', input: {} }]
        }
      })

      tracker.processMessage({
        type: 'assistant',
        message: {
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            { type: 'tool_use', name: 'Grep', input: {} },
            { type: 'tool_use', name: 'Bash', input: {} }
          ]
        }
      })

      expect(insertTurnSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ toolCalls: 1 }))
      expect(insertTurnSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ toolCalls: 2 }))
    })

    it('should handle missing usage gracefully', () => {
      tracker.processMessage({
        type: 'assistant',
        message: { content: [] }
      })

      const totals = tracker.totals()
      expect(totals.tokensIn).toBe(0)
      expect(totals.tokensOut).toBe(0)
      expect(totals.turnCount).toBe(1)
    })

    it('should call insertTurn on assistant messages', () => {
      tracker.processMessage({
        type: 'assistant',
        message: {
          usage: { input_tokens: 100, output_tokens: 50 },
          content: []
        }
      })

      expect(insertTurnSpy).toHaveBeenCalledWith({
        runId: 'run-123',
        turn: 1,
        tokensIn: 100,
        tokensOut: 50,
        toolCalls: 0,
        cacheTokensCreated: 0,
        cacheTokensRead: 0
      })
    })

    it('should log warning but not throw when insertTurn fails', () => {
      const loggerWarnSpy = vi.fn()
      const trackerWithLogger = new TurnTracker('run-123', {
        insertTurn: insertTurnSpy as InsertTurnFn,
        logger: { info: vi.fn(), warn: loggerWarnSpy, error: vi.fn(), debug: vi.fn() }
      })
      insertTurnSpy.mockImplementation(() => {
        throw new Error('DB error')
      })

      expect(() => {
        trackerWithLogger.processMessage({
          type: 'assistant',
          message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] }
        })
      }).not.toThrow()

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write turn record')
      )
    })
  })

  describe('totals', () => {
    it('should return current totals', () => {
      const totals = tracker.totals()

      expect(totals).toEqual({
        tokensIn: 0,
        tokensOut: 0,
        cacheTokensCreated: 0,
        cacheTokensRead: 0,
        turnCount: 0
      })
    })

    it('should reflect accumulated state', () => {
      tracker.processMessage({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 150
          },
          content: []
        }
      })

      const totals = tracker.totals()
      expect(totals.tokensIn).toBe(100)
      expect(totals.tokensOut).toBe(50)
      expect(totals.cacheTokensCreated).toBe(200)
      expect(totals.cacheTokensRead).toBe(150)
      expect(totals.turnCount).toBe(1)
    })
  })
})
