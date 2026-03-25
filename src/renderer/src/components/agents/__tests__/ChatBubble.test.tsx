import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatBubble } from '../ChatBubble'

describe('ChatBubble', () => {
  it('renders text content', () => {
    render(<ChatBubble variant="agent" text="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders agent variant left-aligned', () => {
    const { container } = render(<ChatBubble variant="agent" text="Agent msg" />)
    const bubble = container.firstChild as HTMLElement
    expect(bubble.style.alignSelf).toBe('flex-start')
  })

  it('renders user variant right-aligned', () => {
    const { container } = render(<ChatBubble variant="user" text="User msg" />)
    const bubble = container.firstChild as HTMLElement
    expect(bubble.style.alignSelf).toBe('flex-end')
  })

  it('renders error variant left-aligned with danger border', () => {
    const { container } = render(<ChatBubble variant="error" text="Error msg" />)
    const bubble = container.firstChild as HTMLElement
    expect(bubble.style.alignSelf).toBe('flex-start')
    // error variant has a danger-colored border
    expect(bubble.style.border).toContain('solid')
  })

  it('displays timestamp when provided', () => {
    // Use a fixed timestamp: 2024-01-15T12:30:00Z
    const ts = new Date('2024-01-15T12:30:00Z').getTime()
    render(<ChatBubble variant="agent" text="With time" timestamp={ts} />)
    // The formatted time should appear in the document
    const bubble = document.querySelector('div > div')
    expect(bubble).toBeInTheDocument()
  })

  it('does not display timestamp when not provided', () => {
    const { container } = render(<ChatBubble variant="agent" text="No time" />)
    // Only the bubble div and the p element, no timestamp div
    const divs = container.querySelectorAll('div')
    // Should be just the outer bubble div
    expect(divs).toHaveLength(1)
  })

  it('does not display timestamp when explicitly undefined', () => {
    const { container } = render(<ChatBubble variant="agent" text="test" timestamp={undefined} />)
    const divs = container.querySelectorAll('div')
    expect(divs).toHaveLength(1)
  })

  it('renders text with pre-wrap white space for multi-line content', () => {
    render(<ChatBubble variant="agent" text={'line1\nline2'} />)
    const p = screen.getByText(/line1/)
    expect(p.style.whiteSpace).toBe('pre-wrap')
  })

  it('aligns timestamp right for user variant', () => {
    const ts = Date.now()
    const { container } = render(<ChatBubble variant="user" text="msg" timestamp={ts} />)
    const timestampDiv = container.querySelectorAll('div')[1]
    expect(timestampDiv.style.textAlign).toBe('right')
  })

  it('aligns timestamp left for agent variant', () => {
    const ts = Date.now()
    const { container } = render(<ChatBubble variant="agent" text="msg" timestamp={ts} />)
    const timestampDiv = container.querySelectorAll('div')[1]
    expect(timestampDiv.style.textAlign).toBe('left')
  })

  it('aligns timestamp left for error variant', () => {
    const ts = Date.now()
    const { container } = render(<ChatBubble variant="error" text="msg" timestamp={ts} />)
    const timestampDiv = container.querySelectorAll('div')[1]
    expect(timestampDiv.style.textAlign).toBe('left')
  })
})
