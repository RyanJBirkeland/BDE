import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThinkingBlock } from '../ThinkingBlock'

describe('ThinkingBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders THINKING label', () => {
    render(<ThinkingBlock tokenCount={100} />)
    expect(screen.getByText('THINKING')).toBeInTheDocument()
  })

  it('renders token count with locale formatting', () => {
    render(<ThinkingBlock tokenCount={1234} />)
    expect(screen.getByText('1,234 tokens')).toBeInTheDocument()
  })

  it('renders collapsed by default (no text content visible)', () => {
    render(<ThinkingBlock tokenCount={50} text="Hidden thoughts" />)
    expect(screen.queryByText('Hidden thoughts')).not.toBeInTheDocument()
  })

  it('expands on button click to show text', () => {
    render(<ThinkingBlock tokenCount={50} text="My thinking here" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('My thinking here')).toBeInTheDocument()
  })

  it('toggles back to collapsed on second click', () => {
    render(<ThinkingBlock tokenCount={50} text="Toggle me" />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByText('Toggle me')).toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.queryByText('Toggle me')).not.toBeInTheDocument()
  })

  it('does not show content when expanded but text is undefined', () => {
    render(<ThinkingBlock tokenCount={50} />)
    fireEvent.click(screen.getByRole('button'))
    // Only the button content should be present, no expanded panel
    const container = screen.getByRole('button').parentElement!
    // The expanded div only appears when `expanded && text`, so with no text there's just the button
    expect(container.children).toHaveLength(1)
  })

  it('does not show content when expanded but text is empty string', () => {
    render(<ThinkingBlock tokenCount={50} text="" />)
    fireEvent.click(screen.getByRole('button'))
    // Empty string is falsy, so expanded panel should not render
    const container = screen.getByRole('button').parentElement!
    expect(container.children).toHaveLength(1)
  })

  it('renders zero token count', () => {
    render(<ThinkingBlock tokenCount={0} />)
    expect(screen.getByText('0 tokens')).toBeInTheDocument()
  })

  it('renders chevron icon rotated when expanded', () => {
    const { container } = render(<ThinkingBlock tokenCount={10} text="x" />)
    const svg = container.querySelector('svg')!
    // Initially not rotated
    expect(svg.style.transform).toBe('rotate(0deg)')
    fireEvent.click(screen.getByRole('button'))
    expect(svg.style.transform).toBe('rotate(90deg)')
  })
})
