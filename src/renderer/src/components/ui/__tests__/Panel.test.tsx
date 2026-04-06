import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Panel } from '../Panel'

describe('Panel', () => {
  it('renders children', () => {
    render(<Panel>Body content</Panel>)
    expect(screen.getByText('Body content')).toBeInTheDocument()
  })

  it('renders title when provided', () => {
    render(<Panel title="My Panel">Content</Panel>)
    expect(screen.getByText('My Panel')).toBeInTheDocument()
  })

  it('does not render header when no title', () => {
    const { container } = render(<Panel>Content</Panel>)
    expect(container.querySelector('.bde-panel__header')).not.toBeInTheDocument()
  })

  it('renders actions in header', () => {
    render(
      <Panel title="Panel" actions={<button>Action</button>}>
        Content
      </Panel>
    )
    expect(screen.getByText('Action')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<Panel className="custom-panel">Content</Panel>)
    expect(container.firstChild).toHaveClass('custom-panel')
  })

  it('has base bde-panel class', () => {
    const { container } = render(<Panel>Content</Panel>)
    expect(container.firstChild).toHaveClass('bde-panel')
  })
})
