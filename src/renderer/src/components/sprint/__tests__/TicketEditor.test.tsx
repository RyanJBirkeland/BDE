import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TicketEditor } from '../TicketEditor'
import type { TicketDraft } from '../TicketEditor'

// Mock window.api
beforeEach(() => {
  global.window = {
    api: {
      getRepoPaths: vi.fn().mockResolvedValue({ 'test-repo': '/path/to/repo' })
    }
  } as any
})

function makeTickets(overrides: Partial<TicketDraft>[] = []): TicketDraft[] {
  return overrides.map((override) => ({
    title: 'Test Ticket',
    prompt: 'Test prompt',
    repo: 'test-repo',
    priority: 1,
    ...override
  }))
}

describe('TicketEditor', () => {
  it('renders all ticket titles', () => {
    const tickets = makeTickets([
      { title: 'Alpha Ticket' },
      { title: 'Beta Ticket' },
      { title: 'Gamma Ticket' }
    ])
    render(<TicketEditor initialTickets={tickets} />)
    expect(screen.getByDisplayValue('Alpha Ticket')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Beta Ticket')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Gamma Ticket')).toBeInTheDocument()
  })

  it('renders Create All button', () => {
    const tickets = makeTickets([{ title: 'Test' }])
    render(<TicketEditor initialTickets={tickets} />)
    expect(screen.getByText(/Create All/i)).toBeInTheDocument()
  })

  it('renders Dismiss button', () => {
    const tickets = makeTickets([{ title: 'Test' }])
    render(<TicketEditor initialTickets={tickets} />)
    expect(screen.getByText('Dismiss')).toBeInTheDocument()
  })

  it('shows ticket count in Create All button', () => {
    const tickets = makeTickets([{ title: 'A' }, { title: 'B' }, { title: 'C' }])
    render(<TicketEditor initialTickets={tickets} />)
    expect(screen.getByText('Create All (3)')).toBeInTheDocument()
  })

  it('updates ticket title on input change', () => {
    const tickets = makeTickets([{ title: 'Original' }])
    render(<TicketEditor initialTickets={tickets} />)
    const input = screen.getByDisplayValue('Original') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated' } })
    expect(input.value).toBe('Updated')
  })

  it('shows empty state when initialized with no tickets', () => {
    render(<TicketEditor initialTickets={[]} />)
    expect(screen.getByText('+ Add Ticket')).toBeInTheDocument()
  })

  it('can remove a ticket', () => {
    const tickets = makeTickets([{ title: 'A' }, { title: 'B' }])
    render(<TicketEditor initialTickets={tickets} />)
    const removeButtons = screen.getAllByTitle('Remove ticket')
    fireEvent.click(removeButtons[0])
    expect(screen.queryByDisplayValue('A')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('B')).toBeInTheDocument()
  })

  it('dismisses the editor and shows raw JSON', () => {
    const tickets = makeTickets([{ title: 'Test' }])
    render(<TicketEditor initialTickets={tickets} />)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(screen.queryByText('Create All (1)')).not.toBeInTheDocument()
  })
})
