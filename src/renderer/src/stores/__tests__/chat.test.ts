import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, type LogLine } from '../chat'

function makeLine(overrides: Partial<LogLine> = {}): LogLine {
  return {
    id: `line-${Date.now()}`,
    role: 'assistant',
    content: 'Hello',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('chat store', () => {
  beforeEach(() => {
    useChatStore.setState({ lines: {} })
  })

  it('addLine appends a line to the correct session key', () => {
    const line = makeLine({ id: 'l1' })
    useChatStore.getState().addLine('session-a', line)

    const lines = useChatStore.getState().lines['session-a']
    expect(lines).toHaveLength(1)
    expect(lines[0].id).toBe('l1')
  })

  it('addLine appends multiple lines in order', () => {
    useChatStore.getState().addLine('s1', makeLine({ id: 'a', content: 'first' }))
    useChatStore.getState().addLine('s1', makeLine({ id: 'b', content: 'second' }))

    const lines = useChatStore.getState().lines['s1']
    expect(lines).toHaveLength(2)
    expect(lines[0].content).toBe('first')
    expect(lines[1].content).toBe('second')
  })

  it('different session keys do not bleed into each other', () => {
    useChatStore.getState().addLine('s1', makeLine({ id: 'a' }))
    useChatStore.getState().addLine('s2', makeLine({ id: 'b' }))

    expect(useChatStore.getState().lines['s1']).toHaveLength(1)
    expect(useChatStore.getState().lines['s2']).toHaveLength(1)
    expect(useChatStore.getState().lines['s1'][0].id).toBe('a')
    expect(useChatStore.getState().lines['s2'][0].id).toBe('b')
  })

  it('clearSession empties a specific session', () => {
    useChatStore.getState().addLine('s1', makeLine())
    useChatStore.getState().addLine('s2', makeLine())

    useChatStore.getState().clearSession('s1')

    expect(useChatStore.getState().lines['s1']).toBeUndefined()
    expect(useChatStore.getState().lines['s2']).toHaveLength(1)
  })

  it('clearAll resets all lines', () => {
    useChatStore.getState().addLine('s1', makeLine())
    useChatStore.getState().addLine('s2', makeLine())

    useChatStore.getState().clearAll()

    expect(useChatStore.getState().lines).toEqual({})
  })
})
