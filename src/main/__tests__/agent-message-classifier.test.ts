import { describe, it, expect } from 'vitest'
import { mapRawMessage } from '../agent-message-classifier'

describe('mapRawMessage — type guard hardening', () => {
  it('returns [] for a non-object message', () => {
    expect(mapRawMessage(null)).toEqual([])
    expect(mapRawMessage(undefined)).toEqual([])
    expect(mapRawMessage('string')).toEqual([])
    expect(mapRawMessage(42)).toEqual([])
  })

  it('returns [] for a message with undefined type', () => {
    expect(mapRawMessage({})).toEqual([])
    expect(mapRawMessage({ type: undefined })).toEqual([])
  })

  it('classifies a well-formed assistant text message', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }]
      }
    }
    const events = mapRawMessage(raw)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('agent:text')
    expect((events[0] as { text: string }).text).toBe('Hello world')
  })

  it('classifies a tool_use block and validates input shape', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Read',
            input: { path: '/foo/bar.ts' }
          }
        ]
      }
    }
    const events = mapRawMessage(raw)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('agent:tool_call')
    const toolCall = events[0] as { tool: string; input: Record<string, unknown> | null }
    expect(toolCall.tool).toBe('Read')
    expect(toolCall.input).toEqual({ path: '/foo/bar.ts' })
  })

  it('sets input to null when tool_use has a non-object input', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: 'not-an-object'
          }
        ]
      }
    }
    const events = mapRawMessage(raw)
    expect(events).toHaveLength(1)
    const toolCall = events[0] as { input: unknown }
    expect(toolCall.input).toBeNull()
  })

  it('skips non-object content blocks gracefully', () => {
    const raw = {
      type: 'assistant',
      message: {
        content: [null, 'string-block', 42, { type: 'text', text: 'valid' }]
      }
    }
    const events = mapRawMessage(raw)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('agent:text')
  })

  it('handles assistant message with missing message field', () => {
    const raw = { type: 'assistant' }
    const events = mapRawMessage(raw)
    expect(events).toEqual([])
  })

  it('classifies a tool_result message', () => {
    const raw = {
      type: 'tool_result',
      tool_name: 'Read',
      content: 'file contents here',
      is_error: false
    }
    const events = mapRawMessage(raw)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('agent:tool_result')
    const result = events[0] as { tool: string; success: boolean; summary: string }
    expect(result.tool).toBe('Read')
    expect(result.success).toBe(true)
    expect(result.summary).toBe('file contents here')
  })
})
