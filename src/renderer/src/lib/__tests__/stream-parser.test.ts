import { describe, it, expect } from 'vitest'
import { parseStreamJson, stripAnsi } from '../stream-parser'

/** Helper: wrap an event as a stream_event JSON line */
function streamLine(event: Record<string, unknown>): string {
  return JSON.stringify({ type: 'stream_event', event })
}

describe('parseStreamJson', () => {
  it('accumulates tool call input from input_json_delta events', () => {
    const lines = [
      streamLine({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool_1', name: 'Read', input: '' }
      }),
      streamLine({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"file' }
      }),
      streamLine({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '":"src/' }
      }),
      streamLine({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'main.ts"}' }
      }),
      streamLine({ type: 'content_block_stop', index: 0 })
    ].join('\n')

    const { items } = parseStreamJson(lines)

    const toolItem = items.find((i) => i.kind === 'tool_use')
    expect(toolItem).toBeDefined()
    expect(toolItem!.kind).toBe('tool_use')
    if (toolItem!.kind === 'tool_use') {
      expect(toolItem!.name).toBe('Read')
      expect(toolItem!.input).toBe('{"file":"src/main.ts"}')
    }
  })

  it('accumulates text_delta into text blocks', () => {
    const lines = [
      streamLine({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello ' }
      }),
      streamLine({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'world' }
      }),
      streamLine({ type: 'content_block_stop' })
    ].join('\n')

    const { items } = parseStreamJson(lines)
    expect(items).toEqual([{ kind: 'text', text: 'Hello world' }])
  })

  it('handles text followed by tool_use with input_json_delta', () => {
    const lines = [
      streamLine({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Let me read that file.' }
      }),
      streamLine({ type: 'content_block_stop' }),
      streamLine({
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tool_2', name: 'Bash', input: '' }
      }),
      streamLine({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' }
      }),
      streamLine({ type: 'content_block_stop' })
    ].join('\n')

    const { items } = parseStreamJson(lines)
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ kind: 'text', text: 'Let me read that file.' })
    expect(items[1]).toEqual({ kind: 'tool_use', id: 'tool_2', name: 'Bash', input: '{"command":"ls"}' })
  })

  it('does not lose input_json_delta when no tool_use item exists', () => {
    // Edge case: delta arrives before content_block_start — should not crash
    const lines = [
      streamLine({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"x":1}' }
      })
    ].join('\n')

    expect(() => parseStreamJson(lines)).not.toThrow()
  })
})

describe('stripAnsi', () => {
  it('removes ANSI escape codes', () => {
    expect(stripAnsi('\u001b[32mgreen\u001b[0m')).toBe('green')
  })
})
