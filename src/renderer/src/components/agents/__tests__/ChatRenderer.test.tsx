import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AgentEvent } from '../../../../../shared/types'
import { pairEvents } from '../../../lib/pair-events'
import { ChatRenderer } from '../ChatRenderer'

// Mock heavy child components to avoid DOM measurement complexity
vi.mock('../ChatBubble', () => ({
  ChatBubble: ({ text, variant }: { text: string; variant: string }) => (
    <div data-testid={`chat-bubble-${variant}`}>{text}</div>
  )
}))

vi.mock('../ThinkingBlock', () => ({
  ThinkingBlock: ({ tokenCount }: { tokenCount: number }) => (
    <div data-testid="thinking-block">Thinking ({tokenCount} tokens)</div>
  )
}))

vi.mock('../ToolCallBlock', () => ({
  ToolCallBlock: ({ tool, summary }: { tool: string; summary: string }) => (
    <div data-testid="tool-call-block">
      {tool}: {summary}
    </div>
  )
}))

vi.mock('../PlaygroundCard', () => ({
  PlaygroundCard: ({ filename, sizeBytes }: { filename: string; sizeBytes: number }) => (
    <div data-testid="playground-card">
      {filename} ({sizeBytes} bytes)
    </div>
  )
}))

// Stub virtualizer — jsdom has no layout engine, measurements are all 0
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 60,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 60,
        size: 60
      })),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn()
  })
}))

describe('pairEvents', () => {
  it('pairs tool_call with following tool_result of same tool', () => {
    const events: AgentEvent[] = [
      { type: 'agent:tool_call', tool: 'Read', summary: 'src/foo.ts', timestamp: 100 },
      {
        type: 'agent:tool_result',
        tool: 'Read',
        success: true,
        summary: '50 lines',
        timestamp: 101
      }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool_pair')
  })

  it('leaves unpaired tool_call as standalone', () => {
    const events: AgentEvent[] = [
      { type: 'agent:tool_call', tool: 'Read', summary: 'src/foo.ts', timestamp: 100 },
      { type: 'agent:text', text: 'hello', timestamp: 102 }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('tool_call')
  })

  it('maps text events to text blocks', () => {
    const events: AgentEvent[] = [{ type: 'agent:text', text: 'hello', timestamp: 100 }]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
  })

  it('maps user_message events to user_message blocks', () => {
    const events: AgentEvent[] = [
      { type: 'agent:user_message', text: 'do the thing', timestamp: 100 }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('user_message')
  })

  it('maps thinking events to thinking blocks', () => {
    const events: AgentEvent[] = [
      { type: 'agent:thinking', tokenCount: 150, text: 'Let me think...', timestamp: 100 }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('thinking')
  })

  it('maps error events to error blocks', () => {
    const events: AgentEvent[] = [
      { type: 'agent:error', message: 'something broke', timestamp: 100 }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('error')
  })

  it('maps started events to started blocks', () => {
    const events: AgentEvent[] = [
      { type: 'agent:started', model: 'claude-sonnet-4-6', timestamp: 100 }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('started')
  })

  it('maps completed events to completed blocks', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0.1,
        tokensIn: 100,
        tokensOut: 50,
        durationMs: 5000,
        timestamp: 100
      }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('completed')
  })

  it('handles a full conversation with mixed events', () => {
    const events: AgentEvent[] = [
      { type: 'agent:started', model: 'sonnet', timestamp: 1 },
      { type: 'agent:thinking', tokenCount: 50, timestamp: 2 },
      { type: 'agent:text', text: 'I will read the file', timestamp: 3 },
      { type: 'agent:tool_call', tool: 'Read', summary: 'src/app.ts', timestamp: 4 },
      {
        type: 'agent:tool_result',
        tool: 'Read',
        success: true,
        summary: '100 lines',
        timestamp: 5
      },
      { type: 'agent:text', text: 'Here is the fix', timestamp: 6 },
      { type: 'agent:tool_call', tool: 'Edit', summary: 'src/app.ts', timestamp: 7 },
      { type: 'agent:tool_result', tool: 'Edit', success: true, summary: 'applied', timestamp: 8 },
      {
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0.05,
        tokensIn: 200,
        tokensOut: 100,
        durationMs: 10000,
        timestamp: 9
      }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(7)
    expect(blocks.map((b) => b.type)).toEqual([
      'started',
      'thinking',
      'text',
      'tool_pair',
      'text',
      'tool_pair',
      'completed'
    ])
  })

  it('does not pair tool_call with non-matching tool_result', () => {
    const events: AgentEvent[] = [
      { type: 'agent:tool_call', tool: 'Read', summary: 'foo', timestamp: 1 },
      { type: 'agent:tool_result', tool: 'Write', success: true, summary: 'ok', timestamp: 2 }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('tool_call')
  })

  it('returns empty array for empty events', () => {
    expect(pairEvents([])).toEqual([])
  })

  it('maps rate_limited events to rate_limited blocks', () => {
    const events: AgentEvent[] = [
      { type: 'agent:rate_limited', retryDelayMs: 5000, attempt: 2, timestamp: 100 }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('rate_limited')
  })

  it('handles orphaned tool_result as tool_call block', () => {
    const events: AgentEvent[] = [
      { type: 'agent:tool_result', tool: 'Read', success: true, summary: 'content', timestamp: 100 }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('tool_call')
  })

  it('maps playground events to playground blocks', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:playground',
        filename: 'demo.html',
        html: '<h1>Test</h1>',
        sizeBytes: 12,
        timestamp: 100
      }
    ]
    const blocks = pairEvents(events)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('playground')
    if (blocks[0].type === 'playground') {
      expect(blocks[0].filename).toBe('demo.html')
      expect(blocks[0].html).toBe('<h1>Test</h1>')
      expect(blocks[0].sizeBytes).toBe(12)
    }
  })
})

describe('ChatRenderer component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders container for empty events list', () => {
    const { container } = render(<ChatRenderer events={[]} />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders text event as agent chat bubble', () => {
    const events: AgentEvent[] = [{ type: 'agent:text', text: 'Hello from agent', timestamp: 1000 }]
    render(<ChatRenderer events={events} />)
    expect(screen.getByTestId('chat-bubble-agent')).toBeInTheDocument()
    expect(screen.getByText('Hello from agent')).toBeInTheDocument()
  })

  it('renders user_message as user chat bubble', () => {
    const events: AgentEvent[] = [
      { type: 'agent:user_message', text: 'User sent this', timestamp: 1000 }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByTestId('chat-bubble-user')).toBeInTheDocument()
    expect(screen.getByText('User sent this')).toBeInTheDocument()
  })

  it('renders thinking block', () => {
    const events: AgentEvent[] = [
      { type: 'agent:thinking', tokenCount: 77, text: 'reasoning', timestamp: 1000 }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByTestId('thinking-block')).toBeInTheDocument()
    expect(screen.getByText(/77 tokens/)).toBeInTheDocument()
  })

  it('renders tool call block', () => {
    const events: AgentEvent[] = [
      { type: 'agent:tool_call', tool: 'bash', summary: 'ls -la', input: {}, timestamp: 1000 },
      { type: 'agent:text', text: 'after', timestamp: 1001 }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByTestId('tool-call-block')).toBeInTheDocument()
  })

  it('renders paired tool as tool block', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:tool_call',
        tool: 'read_file',
        summary: 'reading',
        input: {},
        timestamp: 1000
      },
      {
        type: 'agent:tool_result',
        tool: 'read_file',
        summary: 'content',
        success: true,
        output: '',
        timestamp: 1001
      }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByTestId('tool-call-block')).toBeInTheDocument()
  })

  it('renders error as error chat bubble', () => {
    const events: AgentEvent[] = [
      { type: 'agent:error', message: 'Something failed', timestamp: 1000 }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByTestId('chat-bubble-error')).toBeInTheDocument()
    expect(screen.getByText('Something failed')).toBeInTheDocument()
  })

  it('renders rate_limited block', () => {
    const events: AgentEvent[] = [
      { type: 'agent:rate_limited', retryDelayMs: 10000, attempt: 1, timestamp: 1000 }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByText(/Rate limited.*attempt 1/i)).toBeInTheDocument()
    expect(screen.getByText(/10s/)).toBeInTheDocument()
  })

  it('renders completed block with success message', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:completed',
        exitCode: 0,
        costUsd: 0.05,
        tokensIn: 1000,
        tokensOut: 500,
        durationMs: 30000,
        timestamp: 1000
      }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByText(/Completed/)).toBeInTheDocument()
    expect(screen.getByText(/\$0\.0500/)).toBeInTheDocument()
  })

  it('renders completed block with failure message', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:completed',
        exitCode: 2,
        costUsd: 0.01,
        tokensIn: 200,
        tokensOut: 100,
        durationMs: 5000,
        timestamp: 1000
      }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByText(/Failed.*exit 2/i)).toBeInTheDocument()
  })

  it('renders started block with model name', () => {
    const events: AgentEvent[] = [
      { type: 'agent:started', model: 'claude-3-7-sonnet', timestamp: Date.now() }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByText(/claude-3-7-sonnet/)).toBeInTheDocument()
  })

  it('renders multiple events in sequence', () => {
    const events: AgentEvent[] = [
      { type: 'agent:text', text: 'Message one', timestamp: 1001 },
      { type: 'agent:text', text: 'Message two', timestamp: 1002 }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByText('Message one')).toBeInTheDocument()
    expect(screen.getByText('Message two')).toBeInTheDocument()
  })

  it('renders playground event as playground card', () => {
    const events: AgentEvent[] = [
      {
        type: 'agent:playground',
        filename: 'preview.html',
        html: '<html><body>Preview</body></html>',
        sizeBytes: 30,
        timestamp: 1000
      }
    ]
    render(<ChatRenderer events={events} />)
    expect(screen.getByTestId('playground-card')).toBeInTheDocument()
    expect(screen.getByText(/preview.html/)).toBeInTheDocument()
  })
})
