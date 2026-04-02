import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConsoleLine } from '../ConsoleLine'
import type { ChatBlock } from '../../../lib/pair-events'

describe('ConsoleLine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders text block with [agent] prefix', () => {
    const block: ChatBlock = { type: 'text', text: 'Hello world', timestamp: Date.now() }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[agent]')).toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders started block with model name', () => {
    const block: ChatBlock = { type: 'started', model: 'claude-opus-4', timestamp: Date.now() }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[agent]')).toBeInTheDocument()
    expect(screen.getByText('Started with model claude-opus-4')).toBeInTheDocument()
  })

  it('renders user_message block with [user] prefix', () => {
    const block: ChatBlock = { type: 'user_message', text: 'User input', timestamp: Date.now() }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[user]')).toBeInTheDocument()
    expect(screen.getByText('User input')).toBeInTheDocument()
  })

  it('renders error block with [error] prefix', () => {
    const block: ChatBlock = {
      type: 'error',
      message: 'Something went wrong',
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[error]')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders rate_limited block with [rate] prefix and retry info', () => {
    const block: ChatBlock = {
      type: 'rate_limited',
      retryDelayMs: 5000,
      attempt: 2,
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[rate]')).toBeInTheDocument()
    expect(screen.getByText(/Rate limited, retry in 5s \(attempt 2\)/)).toBeInTheDocument()
  })

  // Tool icon tests
  it('renders Bash tool_pair with orange tool icon', () => {
    const block: ChatBlock = {
      type: 'tool_pair',
      tool: 'Bash',
      summary: 'Running ls',
      input: { command: 'ls' },
      result: { success: true, summary: 'Output', output: 'file.txt' },
      timestamp: Date.now(),
    }
    const { container } = render(<ConsoleLine block={block} />)
    const icon = container.querySelector('.console-tool-icon--bash')
    expect(icon).toBeInTheDocument()
    expect(icon?.textContent).toBe('$')
  })

  it('renders Read tool_call with blue tool icon', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'Read',
      summary: 'Reading file',
      input: { path: 'file.txt' },
      timestamp: Date.now(),
    }
    const { container } = render(<ConsoleLine block={block} />)
    const icon = container.querySelector('.console-tool-icon--read')
    expect(icon).toBeInTheDocument()
    expect(icon?.textContent).toBe('R')
  })

  it('renders unknown tool with default icon', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'CustomTool',
      summary: 'Doing something',
      timestamp: Date.now(),
    }
    const { container } = render(<ConsoleLine block={block} />)
    const icon = container.querySelector('.console-tool-icon--default')
    expect(icon).toBeInTheDocument()
  })

  // Markdown rendering in text blocks
  it('renders markdown in text blocks', () => {
    const block: ChatBlock = {
      type: 'text',
      text: '\u2705 **Step 1 PASSED**: Run `npm test`',
      timestamp: Date.now(),
    }
    const { container } = render(<ConsoleLine block={block} />)
    expect(container.querySelector('.console-md-bold')?.textContent).toBe('Step 1 PASSED')
    expect(container.querySelector('.console-md-code')?.textContent).toBe('npm test')
  })

  // Grouped text styling
  it('applies grouped styling to multi-line text blocks', () => {
    const block: ChatBlock = {
      type: 'text',
      text: 'Line one\nLine two',
      timestamp: Date.now(),
    }
    const { container } = render(<ConsoleLine block={block} />)
    expect(container.querySelector('.console-line__content--grouped')).toBeInTheDocument()
  })

  it('does not apply grouped styling to single-line text', () => {
    const block: ChatBlock = {
      type: 'text',
      text: 'Just one line',
      timestamp: Date.now(),
    }
    const { container } = render(<ConsoleLine block={block} />)
    expect(container.querySelector('.console-line__content--grouped')).not.toBeInTheDocument()
  })

  // Completion card tests
  it('renders completion card with stats for successful completion', () => {
    const block: ChatBlock = {
      type: 'completed',
      exitCode: 0,
      costUsd: 0.48,
      tokensIn: 142000,
      tokensOut: 8200,
      durationMs: 314000,
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleLine block={block} />)
    expect(container.querySelector('.console-completion-card')).toBeInTheDocument()
    expect(container.querySelector('.console-completion-card--failed')).not.toBeInTheDocument()
    expect(screen.getByText(/completed successfully/)).toBeInTheDocument()
    expect(screen.getByText('$0.48')).toBeInTheDocument()
    expect(screen.getByText('142K')).toBeInTheDocument()
    expect(screen.getByText('8.2K')).toBeInTheDocument()
    expect(screen.getByText('5m 14s')).toBeInTheDocument()
  })

  it('renders failed completion card with exit code', () => {
    const block: ChatBlock = {
      type: 'completed',
      exitCode: 1,
      costUsd: 1.22,
      tokensIn: 380000,
      tokensOut: 24000,
      durationMs: 723000,
      timestamp: Date.now(),
    }
    const { container } = render(<ConsoleLine block={block} />)
    expect(container.querySelector('.console-completion-card--failed')).toBeInTheDocument()
    expect(screen.getByText(/failed/i)).toBeInTheDocument()
    expect(screen.getByText(/exit code 1/i)).toBeInTheDocument()
  })

  it('renders playground block with filename and size', () => {
    const block: ChatBlock = {
      type: 'playground',
      filename: 'chart.html',
      html: '<html></html>',
      sizeBytes: 2048,
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[play]')).toBeInTheDocument()
    expect(screen.getByText(/chart\.html \(2KB\)/)).toBeInTheDocument()
  })

  it('renders thinking block with [think] prefix and token count badge', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 1234,
      text: 'Thoughts',
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[think]')).toBeInTheDocument()
    expect(screen.getByText('1,234 tokens')).toBeInTheDocument()
  })

  it('renders thinking block collapsed by default', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 100,
      text: 'Hidden thoughts',
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    expect(screen.queryByText('Hidden thoughts')).not.toBeInTheDocument()
  })

  it('expands thinking block on click', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 100,
      text: 'My thoughts',
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('My thoughts')).toBeInTheDocument()
  })

  it('renders tool_call block with tool name', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'Read',
      summary: 'Reading file.txt',
      input: { path: 'file.txt' },
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[tool]')).toBeInTheDocument()
    expect(screen.getByText(/Read.*Reading file\.txt/)).toBeInTheDocument()
  })

  it('renders tool_call block collapsed by default', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'Read',
      summary: 'Reading file.txt',
      input: { path: 'file.txt' },
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    expect(screen.queryByText('Input')).not.toBeInTheDocument()
  })

  it('expands tool_call block to show input JSON', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'Read',
      summary: 'Reading file.txt',
      input: { path: 'file.txt' },
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText(/"path": "file\.txt"/)).toBeInTheDocument()
  })

  it('renders tool_pair block with success badge', () => {
    const block: ChatBlock = {
      type: 'tool_pair',
      tool: 'Read',
      summary: 'Reading file.txt',
      input: { path: 'file.txt' },
      result: { success: true, summary: 'File contents', output: 'Hello' },
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[tool]')).toBeInTheDocument()
    expect(screen.getByText('success')).toBeInTheDocument()
  })

  it('renders tool_pair block with failed badge', () => {
    const block: ChatBlock = {
      type: 'tool_pair',
      tool: 'Read',
      summary: 'Reading missing.txt',
      input: { path: 'missing.txt' },
      result: { success: false, summary: 'File not found', output: null },
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    expect(screen.getByText('[tool]')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('expands tool_pair block to show input and output JSON', () => {
    const block: ChatBlock = {
      type: 'tool_pair',
      tool: 'Read',
      summary: 'Reading file.txt',
      input: { path: 'file.txt' },
      result: { success: true, summary: 'File contents', output: { content: 'Hello world' } },
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByText(/"path": "file\.txt"/)).toBeInTheDocument()
    expect(screen.getByText(/"content": "Hello world"/)).toBeInTheDocument()
  })

  it('toggles collapsible blocks back to collapsed on second click', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 100,
      text: 'Toggle me',
      timestamp: Date.now()
    }
    render(<ConsoleLine block={block} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByText('Toggle me')).toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.queryByText('Toggle me')).not.toBeInTheDocument()
  })

  it('formats timestamp as HH:MM:SS', () => {
    const timestamp = new Date('2024-01-15T14:32:45').getTime()
    const block: ChatBlock = { type: 'text', text: 'Test', timestamp }
    render(<ConsoleLine block={block} />)
    // The exact format depends on locale, but we can check that a timestamp is rendered
    const timestampElements = screen.getByTestId('console-line-text').querySelectorAll('span')
    const timestampText = Array.from(timestampElements).pop()?.textContent
    expect(timestampText).toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })

  it('chevron rotates when thinking block is expanded', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 100,
      text: 'Test',
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleLine block={block} />)
    const svg = container.querySelector('svg')!
    expect(svg.style.transform).toBe('rotate(0deg)')
    fireEvent.click(screen.getByRole('button'))
    expect(svg.style.transform).toBe('rotate(90deg)')
  })

  it('chevron rotates when tool_call block is expanded', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'Read',
      summary: 'Test',
      input: {},
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleLine block={block} />)
    const svg = container.querySelector('svg')!
    expect(svg.style.transform).toBe('rotate(0deg)')
    fireEvent.click(screen.getByRole('button'))
    expect(svg.style.transform).toBe('rotate(90deg)')
  })

  it('chevron rotates when tool_pair block is expanded', () => {
    const block: ChatBlock = {
      type: 'tool_pair',
      tool: 'Read',
      summary: 'Test',
      input: {},
      result: { success: true, summary: 'Done', output: {} },
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleLine block={block} />)
    const svg = container.querySelector('svg')!
    expect(svg.style.transform).toBe('rotate(0deg)')
    fireEvent.click(screen.getByRole('button'))
    expect(svg.style.transform).toBe('rotate(90deg)')
  })
})
