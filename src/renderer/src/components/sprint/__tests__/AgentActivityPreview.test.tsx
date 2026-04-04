import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentActivityPreview } from '../AgentActivityPreview'

describe('AgentActivityPreview', () => {
  it('renders recent agent events', () => {
    const events = [
      { id: 1, content: 'Reading file src/main.ts' },
      { id: 2, content: 'Writing test for login' }
    ]
    render(<AgentActivityPreview events={events} />)
    expect(screen.getByText(/Reading file/)).toBeInTheDocument()
    expect(screen.getByText(/Writing test/)).toBeInTheDocument()
  })

  it('shows empty state when no events', () => {
    render(<AgentActivityPreview events={[]} />)
    expect(screen.getByText(/waiting for output/i)).toBeInTheDocument()
  })

  it('truncates long event text', () => {
    const longText = 'x'.repeat(200)
    render(<AgentActivityPreview events={[{ id: 1, content: longText }]} />)
    const el = screen.getByText(/x+/)
    expect(el.textContent!.length).toBeLessThan(200)
  })

  it('shows only last N events when maxLines is set', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({ id: i, content: `Line ${i}` }))
    render(<AgentActivityPreview events={events} maxLines={3} />)
    expect(screen.queryByText('Line 6')).not.toBeInTheDocument()
    expect(screen.getByText('Line 7')).toBeInTheDocument()
    expect(screen.getByText('Line 9')).toBeInTheDocument()
  })

  it('applies empty class when no events', () => {
    const { container } = render(<AgentActivityPreview events={[]} />)
    expect(container.firstChild).toHaveClass('agent-preview--empty')
  })

  it('applies aria-label on the container when events present', () => {
    const events = [{ id: 1, content: 'some output' }]
    render(<AgentActivityPreview events={events} />)
    expect(screen.getByRole('generic', { name: /agent activity/i })).toBeInTheDocument()
  })
})
