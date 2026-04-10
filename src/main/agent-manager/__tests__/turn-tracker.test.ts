import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TurnTracker } from '../turn-tracker'
import * as agentQueries from '../../data/agent-queries'

vi.mock('../../db', () => ({
  getDb: vi.fn(() => mockDb)
}))

vi.mock('../../data/agent-queries', () => ({
  insertAgentRunTurn: vi.fn()
}))

const mockDb = {} as import('better-sqlite3').Database

describe('turn-tracker', () => {
  let tracker: TurnTracker

  beforeEach(() => {
    vi.mocked(agentQueries.insertAgentRunTurn).mockClear()
    tracker = new TurnTracker('run-123', mockDb)
  })

  describe('observe', () => {
    it('should ignore non-object messages', () => {
      tracker.observe(null)
      tracker.observe('string')
      tracker.observe(123)
      tracker.observe(undefined)

      const totals = tracker.totals()
      expect(totals.turnCount).toBe(0)
    })

    it('should ignore non-assistant messages', () => {
      tracker.observe({ type: 'user', message: { content: [] } })
      tracker.observe({ type: 'tool_result', message: {} })

      const totals = tracker.totals()
      expect(totals.turnCount).toBe(0)
    })

    it('should track assistant message token usage from message.usage', () => {
      tracker.observe({
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
      tracker.observe({
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
      tracker.observe({
        type: 'assistant',
        message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] }
      })
      tracker.observe({
        type: 'assistant',
        message: { usage: { input_tokens: 200, output_tokens: 75 }, content: [] }
      })

      const totals = tracker.totals()
      expect(totals.tokensIn).toBe(300)
      expect(totals.tokensOut).toBe(125)
      expect(totals.turnCount).toBe(2)
    })

    it('should count tool_use blocks in content', () => {
      tracker.observe({
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

      expect(agentQueries.insertAgentRunTurn).toHaveBeenCalledWith(mockDb, {
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
      tracker.observe({
        type: 'assistant',
        message: {
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [{ type: 'tool_use', name: 'Read', input: {} }]
        }
      })

      tracker.observe({
        type: 'assistant',
        message: {
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            { type: 'tool_use', name: 'Grep', input: {} },
            { type: 'tool_use', name: 'Bash', input: {} }
          ]
        }
      })

      expect(agentQueries.insertAgentRunTurn).toHaveBeenNthCalledWith(1, mockDb, expect.objectContaining({ toolCalls: 1 }))
      expect(agentQueries.insertAgentRunTurn).toHaveBeenNthCalledWith(2, mockDb, expect.objectContaining({ toolCalls: 2 }))
    })

    it('should handle missing usage gracefully', () => {
      tracker.observe({
        type: 'assistant',
        message: { content: [] }
      })

      const totals = tracker.totals()
      expect(totals.tokensIn).toBe(0)
      expect(totals.tokensOut).toBe(0)
      expect(totals.turnCount).toBe(1)
    })

    it('should call insertAgentRunTurn on assistant messages', () => {
      tracker.observe({
        type: 'assistant',
        message: {
          usage: { input_tokens: 100, output_tokens: 50 },
          content: []
        }
      })

      expect(agentQueries.insertAgentRunTurn).toHaveBeenCalledWith(mockDb, {
        runId: 'run-123',
        turn: 1,
        tokensIn: 100,
        tokensOut: 50,
        toolCalls: 0,
        cacheTokensCreated: 0,
        cacheTokensRead: 0
      })
    })

    it('should log warning but not throw when insertAgentRunTurn fails', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.mocked(agentQueries.insertAgentRunTurn).mockImplementation(() => {
        throw new Error('DB error')
      })

      expect(() => {
        tracker.observe({
          type: 'assistant',
          message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] }
        })
      }).not.toThrow()

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[turn-tracker]'),
        expect.any(Error)
      )

      consoleWarnSpy.mockRestore()
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
      tracker.observe({
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
