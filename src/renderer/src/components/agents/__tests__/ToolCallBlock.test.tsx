import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolCallBlock } from '../ToolCallBlock'

const baseProps = {
  tool: 'Read',
  summary: 'src/app.ts',
  timestamp: new Date('2024-06-01T14:30:00Z').getTime()
}

describe('ToolCallBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders tool name', () => {
    render(<ToolCallBlock {...baseProps} />)
    expect(screen.getByText('Read')).toBeInTheDocument()
  })

  it('renders summary text', () => {
    render(<ToolCallBlock {...baseProps} />)
    expect(screen.getByText('src/app.ts')).toBeInTheDocument()
  })

  it('renders collapsed by default', () => {
    render(<ToolCallBlock {...baseProps} input={{ path: '/foo' }} />)
    expect(screen.queryByText('Input')).not.toBeInTheDocument()
  })

  it('has aria-label for expand when collapsed', () => {
    render(<ToolCallBlock {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Expand tool call' })).toBeInTheDocument()
  })

  it('has aria-label for collapse when expanded', () => {
    render(<ToolCallBlock {...baseProps} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button', { name: 'Collapse tool call' })).toBeInTheDocument()
  })

  it('shows success badge when result is successful', () => {
    render(<ToolCallBlock {...baseProps} result={{ success: true, summary: 'ok' }} />)
    expect(screen.getByText('success')).toBeInTheDocument()
  })

  it('shows failed badge when result is not successful', () => {
    render(<ToolCallBlock {...baseProps} result={{ success: false, summary: 'err' }} />)
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('does not show badge when result is not provided', () => {
    render(<ToolCallBlock {...baseProps} />)
    expect(screen.queryByText('success')).not.toBeInTheDocument()
    expect(screen.queryByText('failed')).not.toBeInTheDocument()
  })

  it('expands to show input JSON on click', () => {
    const input = { file: 'test.ts', line: 42 }
    render(<ToolCallBlock {...baseProps} input={input} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText(/"file": "test.ts"/)).toBeInTheDocument()
    expect(screen.getByText(/"line": 42/)).toBeInTheDocument()
  })

  it('expands to show output JSON when result has output', () => {
    const result = { success: true, summary: 'done', output: { lines: 50 } }
    render(<ToolCallBlock {...baseProps} result={result} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByText(/"lines": 50/)).toBeInTheDocument()
  })

  it('does not show output section when result has no output', () => {
    const result = { success: true, summary: 'done' }
    render(<ToolCallBlock {...baseProps} result={result} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Output')).not.toBeInTheDocument()
  })

  it('does not show input section when input is undefined', () => {
    render(<ToolCallBlock {...baseProps} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Input')).not.toBeInTheDocument()
  })

  it('toggles back to collapsed on second click', () => {
    render(<ToolCallBlock {...baseProps} input={{ x: 1 }} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByText('Input')).toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.queryByText('Input')).not.toBeInTheDocument()
  })

  it('renders formatted timestamp', () => {
    render(<ToolCallBlock {...baseProps} />)
    // formatTime produces a time string; just check the button contains some time text
    const button = screen.getByRole('button')
    // The timestamp span is inside the button
    expect(button.textContent).toContain(':')
  })

  it('renders chevron rotated when expanded', () => {
    const { container } = render(<ToolCallBlock {...baseProps} />)
    const svg = container.querySelector('svg')!
    expect(svg.style.transform).toBe('rotate(0deg)')
    fireEvent.click(screen.getByRole('button'))
    expect(svg.style.transform).toBe('rotate(90deg)')
  })

  it('handles both input and output displayed simultaneously', () => {
    const input = { cmd: 'ls' }
    const result = { success: true, summary: 'ok', output: { files: ['a.ts'] } }
    render(<ToolCallBlock {...baseProps} input={input} result={result} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
  })

  it('renders data-testid on the container', () => {
    render(<ToolCallBlock {...baseProps} />)
    expect(screen.getByTestId('tool-call-block')).toBeInTheDocument()
  })
})
