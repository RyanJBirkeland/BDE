/**
 * pair-events.test.ts — Tests for event pairing logic
 */
import { describe, it, expect } from 'vitest'
import { pairEvents } from '../pair-events'
import type { AgentEvent } from '../../../../shared/types'

describe('pairEvents', () => {
  it('pairs tool_call + tool_result into tool_pair block', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:tool_call',
        tool: 'Read',
        summary: 'Reading file.txt',
        input: { path: 'file.txt' },
        timestamp: 1000
      },
      {
        type: 'agent:tool_result',
        tool: 'Read',
        summary: 'File contents',
        success: true,
        output: 'Hello world',
        timestamp: 1100
      }
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      type: 'tool_pair',
      tool: 'Read',
      summary: 'Reading file.txt',
      input: { path: 'file.txt' },
      result: {
        success: true,
        summary: 'File contents',
        output: 'Hello world'
      },
      timestamp: 1000
    })
  })

  it('renders orphaned tool_result as tool_call block', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:tool_result',
        tool: 'Write',
        summary: 'File written',
        success: true,
        timestamp: 2000
      }
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      type: 'tool_call',
      tool: 'Write',
      summary: 'File written',
      timestamp: 2000
    })
  })

  it('merges consecutive text events into single text block', () => {
    const events: AgentEvent[] = [
      { type: 'agent:text', text: 'Hello from agent', timestamp: 3000 },
      { type: 'agent:text', text: 'Another message', timestamp: 3100 }
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      type: 'text',
      text: 'Hello from agent\nAnother message',
      timestamp: 3000
    })
  })

  it('returns empty array for empty events', () => {
    const events: AgentEvent[] = []
    const blocks = pairEvents(events)
    expect(blocks).toEqual([])
  })

  it('does not pair tool_call and tool_result with different tool names', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:tool_call',
        tool: 'Read',
        summary: 'Reading file.txt',
        timestamp: 4000
      },
      {
        type: 'agent:tool_result',
        tool: 'Write', // Different tool
        summary: 'File written',
        success: true,
        timestamp: 4100
      }
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      type: 'tool_call',
      tool: 'Read',
      summary: 'Reading file.txt',
      timestamp: 4000
    })
    expect(blocks[1]).toEqual({
      type: 'tool_call',
      tool: 'Write',
      summary: 'File written',
      timestamp: 4100
    })
  })

  it('maps agent:stderr events to stderr blocks', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:stderr',
        text: 'Warning: something went wrong',
        timestamp: 6000
      },
      {
        type: 'agent:stderr',
        text: 'Segmentation fault (core dumped)',
        timestamp: 6100
      }
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({
      type: 'stderr',
      text: 'Warning: something went wrong',
      timestamp: 6000
    })
    expect(blocks[1]).toEqual({
      type: 'stderr',
      text: 'Segmentation fault (core dumped)',
      timestamp: 6100
    })
  })

  it('interleaves stderr with other event types', () => {
    const events: AgentEvent[] = [
      { type: 'agent:started', model: 'claude-sonnet-4-5', timestamp: 7000 },
      { type: 'agent:stderr', text: 'debug: initializing', timestamp: 7050 },
      { type: 'agent:text', text: 'Hello', timestamp: 7100 },
      { type: 'agent:stderr', text: 'debug: done', timestamp: 7150 }
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(4)
    expect(blocks[0].type).toBe('started')
    expect(blocks[1].type).toBe('stderr')
    expect(blocks[2].type).toBe('text')
    expect(blocks[3].type).toBe('stderr')
  })

  it('merges consecutive text blocks into single block', () => {
    const events: AgentEvent[] = [
      { type: 'agent:text', text: 'First line', timestamp: 3000 },
      { type: 'agent:text', text: 'Second line', timestamp: 3100 },
      { type: 'agent:text', text: 'Third line', timestamp: 3200 },
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({
      type: 'text',
      text: 'First line\nSecond line\nThird line',
      timestamp: 3000,
    })
  })

  it('does not merge text blocks separated by other event types', () => {
    const events: AgentEvent[] = [
      { type: 'agent:text', text: 'Before', timestamp: 3000 },
      { type: 'agent:tool_call', tool: 'Bash', summary: 'Run ls', timestamp: 3100 },
      { type: 'agent:text', text: 'After', timestamp: 3200 },
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({ type: 'text', text: 'Before', timestamp: 3000 })
    expect(blocks[2]).toEqual({ type: 'text', text: 'After', timestamp: 3200 })
  })

  it('preserves single text block without modification', () => {
    const events: AgentEvent[] = [
      { type: 'agent:text', text: 'Only one', timestamp: 3000 },
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ type: 'text', text: 'Only one', timestamp: 3000 })
  })

  it('handles mixed event types correctly', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:started',
        model: 'claude-opus-4',
        timestamp: 5000
      },
      {
        type: 'agent:text',
        text: 'Starting task',
        timestamp: 5100
      },
      {
        type: 'agent:thinking',
        tokenCount: 150,
        text: 'Thinking...',
        timestamp: 5200
      },
      {
        type: 'agent:tool_call',
        tool: 'Bash',
        summary: 'Running ls',
        timestamp: 5300
      },
      {
        type: 'agent:tool_result',
        tool: 'Bash',
        summary: 'Command output',
        success: true,
        output: 'file1.txt\nfile2.txt',
        timestamp: 5400
      },
      {
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0.05,
        tokensIn: 1000,
        tokensOut: 500,
        durationMs: 5000,
        timestamp: 5500
      }
    ]

    const blocks = pairEvents(events)

    expect(blocks).toHaveLength(5)
    expect(blocks[0].type).toBe('started')
    expect(blocks[1].type).toBe('text')
    expect(blocks[2].type).toBe('thinking')
    expect(blocks[3].type).toBe('tool_pair')
    expect(blocks[4].type).toBe('completed')
  })
})
