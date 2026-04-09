import { describe, it, expect } from 'vitest'
import { chatItemsToMessages } from '../agent-messages'
import type { ChatItem } from '../stream-parser'

describe('chatItemsToMessages', () => {
  it('converts text items to assistant messages', () => {
    const items: ChatItem[] = [{ kind: 'text', text: 'Hello world' }]
    const result = chatItemsToMessages(items)
    expect(result).toEqual([{ role: 'assistant', content: 'Hello world' }])
  })

  it('skips empty text items', () => {
    const items: ChatItem[] = [{ kind: 'text', text: '   ' }]
    const result = chatItemsToMessages(items)
    expect(result).toEqual([])
  })

  it('converts tool_use items to tool messages', () => {
    const items: ChatItem[] = [
      { kind: 'tool_use', name: 'Read', input: '{"path": "/tmp"}', id: 'tu1' }
    ]
    const result = chatItemsToMessages(items)
    expect(result).toEqual([{ role: 'tool', toolName: 'Read', content: '{"path": "/tmp"}' }])
  })

  it('converts tool_result items to tool messages', () => {
    const items: ChatItem[] = [{ kind: 'tool_result', toolUseId: 'tu1', content: 'file contents' }]
    const result = chatItemsToMessages(items)
    expect(result).toEqual([{ role: 'tool', toolName: 'Result', content: 'file contents' }])
  })

  it('skips empty tool_result items', () => {
    const items: ChatItem[] = [{ kind: 'tool_result', toolUseId: 'tu1', content: '' }]
    const result = chatItemsToMessages(items)
    expect(result).toEqual([])
  })

  it('converts result items to system messages (success)', () => {
    const items: ChatItem[] = [
      { kind: 'result', subtype: 'success', result: 'All done', costUsd: 0.123 }
    ]
    const result = chatItemsToMessages(items)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('system')
    expect(result[0].content).toContain('All done')
    expect(result[0].content).toContain('$0.123')
  })

  it('converts result items to system messages (failure)', () => {
    const items: ChatItem[] = [{ kind: 'result', subtype: 'error', result: '', costUsd: null }]
    const result = chatItemsToMessages(items)
    expect(result[0].content).toContain('Failed')
  })

  it('converts plain items to system messages', () => {
    const items: ChatItem[] = [{ kind: 'plain', text: 'Starting...' }]
    const result = chatItemsToMessages(items)
    expect(result).toEqual([{ role: 'system', content: 'Starting...' }])
  })

  it('skips empty plain items', () => {
    const items: ChatItem[] = [{ kind: 'plain', text: '' }]
    const result = chatItemsToMessages(items)
    expect(result).toEqual([])
  })

  it('converts error items to system messages', () => {
    const items: ChatItem[] = [{ kind: 'error', text: 'Something broke' }]
    const result = chatItemsToMessages(items)
    expect(result[0].content).toContain('Error: Something broke')
  })

  it('handles unknown kinds gracefully', () => {
    const items = [{ kind: 'unknown' }] as unknown as ChatItem[]
    const result = chatItemsToMessages(items)
    expect(result).toEqual([])
  })

  it('handles multiple items', () => {
    const items: ChatItem[] = [
      { kind: 'text', text: 'Hello' },
      { kind: 'tool_use', name: 'Bash', input: 'ls', id: 'tu1' },
      { kind: 'tool_result', toolUseId: 'tu1', content: 'file.txt' },
      { kind: 'result', subtype: 'success', result: 'Done', costUsd: 0.05 }
    ]
    const result = chatItemsToMessages(items)
    expect(result).toHaveLength(4)
  })
})
