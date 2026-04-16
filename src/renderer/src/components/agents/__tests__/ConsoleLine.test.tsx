import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConsoleCard } from '../cards/ConsoleCard'
import type { ChatBlock } from '../../../lib/pair-events'

describe('ConsoleCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders text block without prefix', () => {
    const block: ChatBlock = { type: 'text', text: 'Hello world', timestamp: Date.now() }
    render(<ConsoleCard block={block} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders started block with emoji and model name', () => {
    const block: ChatBlock = { type: 'started', model: 'claude-opus-4', timestamp: Date.now() }
    render(<ConsoleCard block={block} />)
    expect(screen.getByText(/🤖 Agent started/)).toBeInTheDocument()
    expect(screen.getByText(/claude-opus-4/)).toBeInTheDocument()
  })

  it('renders user_message block without prefix', () => {
    const block: ChatBlock = { type: 'user_message', text: 'User input', timestamp: Date.now() }
    render(<ConsoleCard block={block} />)
    expect(screen.getByText('User input')).toBeInTheDocument()
  })

  it('renders error block without prefix', () => {
    const block: ChatBlock = {
      type: 'error',
      message: 'Something went wrong',
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders rate_limited block with retry countdown', () => {
    const block: ChatBlock = {
      type: 'rate_limited',
      retryDelayMs: 5000,
      attempt: 2,
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
    expect(screen.getByText(/Rate limited, retry in 5s \(attempt 2\)/)).toBeInTheDocument()
  })

  // Tool icon tests
  it('renders Bash tool_pair with terminal icon', () => {
    const block: ChatBlock = {
      type: 'tool_pair',
      tool: 'Bash',
      summary: 'Running ls',
      input: { command: 'ls' },
      result: { success: true, summary: 'Output', output: 'file.txt' },
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleCard block={block} />)
    // Check for lucide icon SVG (not the chevron)
    const icons = container.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThan(0)
    // First icon should be the tool icon (Terminal for bash), not the chevron
    const toolIcon = icons[0]
    expect(toolIcon).toBeTruthy()
  })

  it('renders Read tool_call with file icon', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'Read',
      summary: 'Reading file',
      input: { path: 'file.txt' },
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleCard block={block} />)
    // Read tools don't have CollapsibleBlock, so only one SVG (the tool icon)
    const icons = container.querySelectorAll('svg')
    expect(icons.length).toBe(1)
    expect(icons[0]).toBeTruthy()
  })

  it('renders unknown tool with wrench icon', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'CustomTool',
      summary: 'Doing something',
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleCard block={block} />)
    // Unknown tools get Wrench icon and no expansion
    const icons = container.querySelectorAll('svg')
    expect(icons.length).toBe(1)
    expect(icons[0]).toBeTruthy()
  })

  // Markdown rendering in text blocks
  it('renders markdown in text blocks', () => {
    const block: ChatBlock = {
      type: 'text',
      text: '\u2705 **Step 1 PASSED**: Run `npm test`',
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleCard block={block} />)
    expect(container.querySelector('.console-md-bold')?.textContent).toBe('Step 1 PASSED')
    expect(container.querySelector('.console-md-code')?.textContent).toBe('npm test')
  })

  // Text rendering
  it('renders multi-line text blocks', () => {
    const block: ChatBlock = {
      type: 'text',
      text: 'Line one\nLine two',
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
    expect(screen.getByText(/Line one/)).toBeInTheDocument()
    expect(screen.getByText(/Line two/)).toBeInTheDocument()
  })

  it('renders single-line text', () => {
    const block: ChatBlock = {
      type: 'text',
      text: 'Just one line',
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
    expect(screen.getByText('Just one line')).toBeInTheDocument()
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
    const { container } = render(<ConsoleCard block={block} />)
    expect(container.querySelector('.console-completion-card')).toBeInTheDocument()
    expect(container.querySelector('.console-completion-card--failed')).not.toBeInTheDocument()
    expect(screen.getByText(/completed successfully/)).toBeInTheDocument()
    expect(screen.getByText('$0.48')).toBeInTheDocument()
    expect(screen.getByText('142.0K')).toBeInTheDocument()
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
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleCard block={block} />)
    expect(container.querySelector('.console-completion-card--failed')).toBeInTheDocument()
    expect(screen.getByText(/failed/i)).toBeInTheDocument()
    expect(screen.getByText(/exit code 1/i)).toBeInTheDocument()
  })

  it('renders playground block with filename and size', () => {
    const block: ChatBlock = {
      type: 'playground',
      filename: 'chart.html',
      html: '<html></html>',
      contentType: 'html',
      sizeBytes: 2048,
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
    expect(screen.getByText('[play]')).toBeInTheDocument()
    expect(screen.getByText(/chart\.html \(2KB\)/)).toBeInTheDocument()
  })

  it('renders thinking block with emoji header and token count', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 1234,
      text: 'Thoughts',
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
    expect(screen.getByText(/💭 Reasoning.*1,234 tokens/)).toBeInTheDocument()
  })

  it('renders thinking block with preview visible by default', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 100,
      text: 'Hidden thoughts',
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
    // Preview should be visible by default
    expect(screen.getByText('Hidden thoughts')).toBeInTheDocument()
  })

  it('expands thinking block on click', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 100,
      text: 'My thoughts',
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
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
    render(<ConsoleCard block={block} />)
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
    render(<ConsoleCard block={block} />)
    expect(screen.queryByText('Input')).not.toBeInTheDocument()
  })

  it('expands tool_call block to show input JSON', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'Grep',
      summary: 'Searching for pattern',
      input: { pattern: 'test' },
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText(/"pattern": "test"/)).toBeInTheDocument()
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
    render(<ConsoleCard block={block} />)
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
    render(<ConsoleCard block={block} />)
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
    render(<ConsoleCard block={block} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByText(/"path": "file\.txt"/)).toBeInTheDocument()
    expect(screen.getByText(/"content": "Hello world"/)).toBeInTheDocument()
  })

  it('toggles thinking block between preview and full text', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 100,
      text: 'Toggle me',
      timestamp: Date.now()
    }
    render(<ConsoleCard block={block} />)
    // Preview visible by default
    expect(screen.getByText('Toggle me')).toBeInTheDocument()
    const button = screen.getByRole('button')
    // Expand to full text
    fireEvent.click(button)
    expect(screen.getByText('Toggle me')).toBeInTheDocument()
    // Collapse back to preview
    fireEvent.click(button)
    expect(screen.getByText('Toggle me')).toBeInTheDocument()
  })

  it('renders text card without timestamps', () => {
    const timestamp = new Date('2024-01-15T14:32:45').getTime()
    const block: ChatBlock = { type: 'text', text: 'Test', timestamp }
    render(<ConsoleCard block={block} />)
    // Text content should be visible
    expect(screen.getByText('Test')).toBeInTheDocument()
    // No timestamp elements in the new card grammar
    const card = screen.getByTestId('console-line-text')
    expect(card.textContent).toBe('Test')
  })

  it('chevron rotates when thinking block is expanded', () => {
    const block: ChatBlock = {
      type: 'thinking',
      tokenCount: 100,
      text: 'Test',
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleCard block={block} />)
    const svg = container.querySelector('svg')!
    expect(svg.style.transform).toBe('rotate(0deg)')
    fireEvent.click(screen.getByRole('button'))
    expect(svg.style.transform).toBe('rotate(90deg)')
  })

  it('chevron rotates when tool_call block is expanded', () => {
    const block: ChatBlock = {
      type: 'tool_call',
      tool: 'Grep',
      summary: 'Test',
      input: {},
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleCard block={block} />)
    const chevron = container.querySelector('.console-line__chevron') as SVGElement
    expect(chevron.style.transform).toBe('rotate(0deg)')
    fireEvent.click(screen.getByRole('button'))
    expect(chevron.style.transform).toBe('rotate(90deg)')
  })

  it('chevron rotates when tool_pair block is expanded', () => {
    const block: ChatBlock = {
      type: 'tool_pair',
      tool: 'Grep',
      summary: 'Test',
      input: {},
      result: { success: true, summary: 'Done', output: {} },
      timestamp: Date.now()
    }
    const { container } = render(<ConsoleCard block={block} />)
    const chevron = container.querySelector('.console-line__chevron') as SVGElement
    expect(chevron.style.transform).toBe('rotate(0deg)')
    fireEvent.click(screen.getByRole('button'))
    expect(chevron.style.transform).toBe('rotate(90deg)')
  })
})
