import { describe, it, expect } from 'vitest'
import { parseStreamJson, stripAnsi } from '../stream-parser'

// Helper: wrap an inner event in the stream-json envelope
function evt(inner: Record<string, unknown>): string {
  return JSON.stringify({ type: 'stream_event', event: inner })
}

describe('stripAnsi', () => {
  it('removes ANSI escape codes', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red')
  })

  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })
})

describe('parseStreamJson', () => {
  // ── 9. Empty input ──────────────────────────────────────────────────
  describe('empty input', () => {
    it('returns empty items and isStreaming=false for empty string', () => {
      const result = parseStreamJson('')
      expect(result.items).toEqual([])
      expect(result.isStreaming).toBe(false)
    })

    it('returns empty items for whitespace-only input', () => {
      const result = parseStreamJson('   \n  \n  ')
      expect(result.items).toEqual([])
      expect(result.isStreaming).toBe(false)
    })
  })

  // ── 1. text_delta accumulation ──────────────────────────────────────
  describe('text_delta accumulation', () => {
    it('merges consecutive text_delta events into one text block on stop', () => {
      const input = [
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }),
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }),
        evt({ type: 'content_block_stop' }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      expect(items).toEqual([{ kind: 'text', text: 'Hello world' }])
    })

    it('flushes trailing text as streaming when no stop event', () => {
      const input = [
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }),
      ].join('\n')

      const { items, isStreaming } = parseStreamJson(input)
      expect(items).toEqual([{ kind: 'text', text: 'partial' }])
      expect(isStreaming).toBe(true)
    })

    it('ignores deltas with non-text_delta type', () => {
      const input = [
        evt({ type: 'content_block_delta', delta: { type: 'other_delta', text: 'ignored' } }),
        evt({ type: 'content_block_stop' }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      expect(items).toEqual([])
    })
  })

  // ── 2. content_block_start with tool_use ────────────────────────────
  describe('content_block_start — tool_use', () => {
    it('creates a tool_use item from content_block_start', () => {
      const input = evt({
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'Read',
          input: {},
        },
      })

      const { items } = parseStreamJson(input)
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({
        kind: 'tool_use',
        id: 'toolu_01',
        name: 'Read',
        input: '{}',
      })
    })

    it('flushes accumulated text before tool_use block', () => {
      const input = [
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Thinking...' } }),
        evt({
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'toolu_02', name: 'Bash', input: '' },
        }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ kind: 'text', text: 'Thinking...' })
      expect(items[1].kind).toBe('tool_use')
    })

    it('handles content_block_start with non-tool_use type (no-op)', () => {
      const input = evt({
        type: 'content_block_start',
        content_block: { type: 'text', text: '' },
      })

      const { items } = parseStreamJson(input)
      expect(items).toEqual([])
    })
  })

  // ── 3. input_json_delta — currently unhandled (bug) ─────────────────
  describe('input_json_delta accumulation (known bug)', () => {
    it('accumulates input_json_delta into tool input', () => {
      // input_json_delta events are sent after content_block_start to
      // incrementally build the tool's input JSON. The parser currently
      // ignores them because the content_block_delta handler only checks
      // for delta.type === "text_delta".
      const input = [
        evt({
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'toolu_03', name: 'Edit', input: '' },
        }),
        evt({
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"file' },
        }),
        evt({
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '":"a.ts"}' },
        }),
        evt({ type: 'content_block_stop' }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      const tool = items.find((i) => i.kind === 'tool_use')
      // Fixed in AX-S3: input_json_delta now accumulates correctly
      expect(tool).toBeDefined()
      expect((tool as { input: string }).input).toBe('{"file":"a.ts"}')
    })
  })

  // ── 4. content_block_stop finalizes the block ───────────────────────
  describe('content_block_stop', () => {
    it('finalizes accumulated text into a text item', () => {
      const input = [
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } }),
        evt({ type: 'content_block_stop' }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      expect(items).toEqual([{ kind: 'text', text: 'done' }])
    })

    it('is a no-op when no text is accumulated', () => {
      const input = evt({ type: 'content_block_stop' })
      const { items } = parseStreamJson(input)
      expect(items).toEqual([])
    })
  })

  // ── 5. message_delta with stop_reason ───────────────────────────────
  describe('message_delta', () => {
    it('is currently a no-op (falls through to default)', () => {
      const input = [
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
        evt({ type: 'content_block_stop' }),
        evt({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      // message_delta doesn't produce items — only text block matters
      expect(items).toEqual([{ kind: 'text', text: 'hi' }])
    })
  })

  // ── 6. message_stop and cost/usage ──────────────────────────────────
  describe('message_stop', () => {
    it('sets isStreaming to false', () => {
      const input = [
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
        evt({ type: 'content_block_stop' }),
        evt({ type: 'message_stop' }),
      ].join('\n')

      const { items, isStreaming } = parseStreamJson(input)
      expect(items).toEqual([{ kind: 'text', text: 'hi' }])
      expect(isStreaming).toBe(false)
    })
  })

  describe('result event with cost', () => {
    it('captures cost_usd as a number', () => {
      const input = evt({
        type: 'result',
        subtype: 'success',
        result: 'Task completed',
        cost_usd: 0.042,
      })

      const { items, isStreaming } = parseStreamJson(input)
      expect(items).toEqual([
        { kind: 'result', subtype: 'success', result: 'Task completed', costUsd: 0.042 },
      ])
      expect(isStreaming).toBe(false)
    })

    it('sets costUsd to null when cost_usd is missing', () => {
      const input = evt({ type: 'result', subtype: 'error', result: 'failed' })
      const { items } = parseStreamJson(input)
      expect(items[0]).toMatchObject({ kind: 'result', costUsd: null })
    })

    it('flushes accumulated text before result', () => {
      const input = [
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'working...' } }),
        evt({ type: 'result', subtype: 'success', result: 'done', cost_usd: 0.01 }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ kind: 'text', text: 'working...' })
      expect(items[1].kind).toBe('result')
    })
  })

  // ── 7. assistant verbose turn ───────────────────────────────────────
  describe('assistant verbose turn', () => {
    it('overrides streaming deltas with authoritative content', () => {
      const input = [
        // Streaming deltas arrive first
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'streaming' } }),
        evt({ type: 'content_block_stop' }),
        // Then the verbose assistant turn replaces them
        evt({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Authoritative response' },
              { type: 'tool_use', id: 'toolu_10', name: 'Bash', input: { command: 'ls' } },
            ],
          },
        }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      // Streaming text was replaced; only assistant content remains
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ kind: 'text', text: 'Authoritative response' })
      expect(items[1]).toEqual({
        kind: 'tool_use',
        id: 'toolu_10',
        name: 'Bash',
        input: JSON.stringify({ command: 'ls' }, null, 2),
      })
    })

    it('discards empty/whitespace text blocks from assistant message', () => {
      const input = evt({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '   ' },
            { type: 'text', text: 'Real content' },
          ],
        },
      })

      const { items } = parseStreamJson(input)
      expect(items).toEqual([{ kind: 'text', text: 'Real content' }])
    })

    it('handles assistant with no message gracefully', () => {
      const input = evt({ type: 'assistant' })
      const { items } = parseStreamJson(input)
      expect(items).toEqual([])
    })

    it('preserves tool_result items before assistant turn', () => {
      const input = [
        evt({ type: 'tool_result', tool_use_id: 'toolu_r1', content: 'output' }),
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'delta' } }),
        evt({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'final' }] },
        }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      // tool_result is preserved, streaming text is discarded, assistant text added
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ kind: 'tool_result', toolUseId: 'toolu_r1', content: 'output' })
      expect(items[1]).toEqual({ kind: 'text', text: 'final' })
    })
  })

  // ── tool_use event (direct, non-streaming) ─────────────────────────
  describe('tool_use event (direct)', () => {
    it('creates a tool_use item with object input', () => {
      const input = evt({
        type: 'tool_use',
        id: 'toolu_05',
        name: 'Grep',
        input: { pattern: 'foo', path: '.' },
      })

      const { items } = parseStreamJson(input)
      expect(items).toEqual([
        {
          kind: 'tool_use',
          id: 'toolu_05',
          name: 'Grep',
          input: JSON.stringify({ pattern: 'foo', path: '.' }, null, 2),
        },
      ])
    })

    it('handles string input', () => {
      const input = evt({ type: 'tool_use', id: 'toolu_06', name: 'Bash', input: 'ls -la' })
      const { items } = parseStreamJson(input)
      expect(items[0]).toMatchObject({ kind: 'tool_use', input: 'ls -la' })
    })

    it('handles missing input', () => {
      const input = evt({ type: 'tool_use', id: 'toolu_07', name: 'Bash' })
      const { items } = parseStreamJson(input)
      expect(items[0]).toMatchObject({ kind: 'tool_use', input: '' })
    })

    it('defaults name to "tool" when missing', () => {
      const input = evt({ type: 'tool_use', id: 'toolu_08' })
      const { items } = parseStreamJson(input)
      expect(items[0]).toMatchObject({ kind: 'tool_use', name: 'tool' })
    })
  })

  // ── tool_result event ──────────────────────────────────────────────
  describe('tool_result event', () => {
    it('parses string content', () => {
      const input = evt({ type: 'tool_result', tool_use_id: 'toolu_t1', content: 'file contents' })
      const { items } = parseStreamJson(input)
      expect(items).toEqual([
        { kind: 'tool_result', toolUseId: 'toolu_t1', content: 'file contents' },
      ])
    })

    it('stringifies object content', () => {
      const input = evt({
        type: 'tool_result',
        tool_use_id: 'toolu_t2',
        content: { data: 123 },
      })
      const { items } = parseStreamJson(input)
      expect(items[0]).toMatchObject({
        kind: 'tool_result',
        content: JSON.stringify({ data: 123 }),
      })
    })
  })

  // ── 8. Plain text fallback ─────────────────────────────────────────
  describe('plain text fallback', () => {
    it('renders non-JSON lines as plain text', () => {
      const input = 'this is not json'
      const { items } = parseStreamJson(input)
      expect(items).toEqual([{ kind: 'plain', text: 'this is not json' }])
    })

    it('handles mixed JSON and non-JSON lines', () => {
      const input = [
        'Starting agent...',
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
        evt({ type: 'content_block_stop' }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ kind: 'plain', text: 'Starting agent...' })
      expect(items[1]).toEqual({ kind: 'text', text: 'hi' })
    })
  })

  // ── 10. Partial/malformed JSON ─────────────────────────────────────
  describe('malformed JSON', () => {
    it('treats truncated JSON as plain text', () => {
      const input = '{"type":"content_block_del'
      const { items } = parseStreamJson(input)
      expect(items).toEqual([{ kind: 'plain', text: '{"type":"content_block_del' }])
    })

    it('continues parsing after malformed line', () => {
      const input = [
        '{broken json',
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }),
        evt({ type: 'content_block_stop' }),
      ].join('\n')

      const { items } = parseStreamJson(input)
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ kind: 'plain', text: '{broken json' })
      expect(items[1]).toEqual({ kind: 'text', text: 'ok' })
    })
  })

  // ── isStreaming logic ──────────────────────────────────────────────
  describe('isStreaming', () => {
    it('is true when items exist but no stop/result event', () => {
      const input = evt({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'streaming...' },
      })
      expect(parseStreamJson(input).isStreaming).toBe(true)
    })

    it('is false after message_stop', () => {
      const input = [
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } }),
        evt({ type: 'content_block_stop' }),
        evt({ type: 'message_stop' }),
      ].join('\n')
      expect(parseStreamJson(input).isStreaming).toBe(false)
    })

    it('is false after result event', () => {
      const input = evt({ type: 'result', subtype: 'success', result: '', cost_usd: 0 })
      expect(parseStreamJson(input).isStreaming).toBe(false)
    })

    it('is false for empty input', () => {
      expect(parseStreamJson('').isStreaming).toBe(false)
    })
  })

  // ── Unwrapping stream_event envelope ───────────────────────────────
  describe('stream_event envelope', () => {
    it('unwraps events from stream_event wrapper', () => {
      const wrapped = JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'wrapped' } },
      })
      const { items } = parseStreamJson(wrapped)
      expect(items).toEqual([{ kind: 'text', text: 'wrapped' }])
    })

    it('handles bare events without stream_event wrapper', () => {
      const bare = JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'bare' },
      })
      const { items } = parseStreamJson(bare)
      expect(items).toEqual([{ kind: 'text', text: 'bare' }])
    })
  })

  // ── Multi-block sequence (integration) ─────────────────────────────
  describe('full multi-block conversation', () => {
    it('parses a realistic sequence of events', () => {
      const input = [
        evt({ type: 'message_start', message: { id: 'msg_01', role: 'assistant' } }),
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'I will ' } }),
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'read the file.' } }),
        evt({ type: 'content_block_stop' }),
        evt({
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'toolu_20', name: 'Read', input: '' },
        }),
        evt({ type: 'content_block_stop' }),
        evt({ type: 'tool_result', tool_use_id: 'toolu_20', content: 'file contents here' }),
        evt({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done!' } }),
        evt({ type: 'content_block_stop' }),
        evt({ type: 'message_stop' }),
      ].join('\n')

      const { items, isStreaming } = parseStreamJson(input)
      expect(items).toEqual([
        { kind: 'text', text: 'I will read the file.' },
        { kind: 'tool_use', id: 'toolu_20', name: 'Read', input: '' },
        { kind: 'tool_result', toolUseId: 'toolu_20', content: 'file contents here' },
        { kind: 'text', text: 'Done!' },
      ])
      expect(isStreaming).toBe(false)
    })
  })
})
