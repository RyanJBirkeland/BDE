import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TicketEditor } from '../TicketEditor'

// Mock the sprint store
const mockCreateTask = vi.fn()
vi.mock('../../../stores/sprint', () => ({
  useSprintStore: {
    getState: () => ({ createTask: mockCreateTask }),
  },
}))

vi.mock('../../../stores/ui', () => ({
  useUIStore: {
    getState: () => ({ setView: vi.fn() }),
  },
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const sampleTickets = [
  { title: 'Add login page', prompt: 'Create a login page with email/password', repo: 'bde', priority: 1 },
  { title: 'Add logout button', prompt: 'Add a logout button to the header', repo: 'bde', priority: 2 },
]

describe('TicketEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateTask.mockResolvedValue(undefined)
  })

  it('renders all tickets from initialTickets', async () => {
    render(<TicketEditor initialTickets={sampleTickets} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Add login page')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Add logout button')).toBeInTheDocument()
    })
  })

  it('shows ticket count in header', () => {
    render(<TicketEditor initialTickets={sampleTickets} />)
    expect(screen.getByText('2 tickets')).toBeInTheDocument()
  })

  it('allows editing ticket title', async () => {
    const user = userEvent.setup()
    render(<TicketEditor initialTickets={sampleTickets} />)

    const titleInput = screen.getByDisplayValue('Add login page')
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated title')

    expect(screen.getByDisplayValue('Updated title')).toBeInTheDocument()
  })

  it('removes a ticket when remove button is clicked', async () => {
    const user = userEvent.setup()
    render(<TicketEditor initialTickets={sampleTickets} />)

    const removeButtons = screen.getAllByTitle('Remove ticket')
    await user.click(removeButtons[0])

    expect(screen.queryByDisplayValue('Add login page')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Add logout button')).toBeInTheDocument()
    expect(screen.getByText('1 ticket')).toBeInTheDocument()
  })

  it('adds a new blank ticket', async () => {
    const user = userEvent.setup()
    render(<TicketEditor initialTickets={sampleTickets} />)

    await user.click(screen.getByText('+ Add Ticket'))

    expect(screen.getByText('3 tickets')).toBeInTheDocument()
  })

  it('calls createTask for each ticket when "Create All" is clicked', async () => {
    const user = userEvent.setup()
    render(<TicketEditor initialTickets={sampleTickets} />)

    await user.click(screen.getByText('Create All (2)'))

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledTimes(2)
    })

    expect(mockCreateTask).toHaveBeenCalledWith({
      title: 'Add login page',
      repo: 'bde',
      prompt: 'Create a login page with email/password',
      priority: 1,
      spec: 'Create a login page with email/password',
    })

    expect(mockCreateTask).toHaveBeenCalledWith({
      title: 'Add logout button',
      repo: 'bde',
      prompt: 'Add a logout button to the header',
      priority: 2,
      spec: 'Add a logout button to the header',
    })
  })

  it('shows confirmation message after successful creation', async () => {
    const user = userEvent.setup()
    render(<TicketEditor initialTickets={sampleTickets} />)

    await user.click(screen.getByText('Create All (2)'))

    await waitFor(() => {
      expect(screen.getByText('2 tickets created in backlog')).toBeInTheDocument()
    })
    expect(screen.getByText('View Sprint Board')).toBeInTheDocument()
  })

  it('collapses to raw JSON on dismiss', async () => {
    const user = userEvent.setup()
    render(<TicketEditor initialTickets={sampleTickets} />)

    await user.click(screen.getByText('Dismiss'))

    expect(screen.queryByDisplayValue('Add login page')).not.toBeInTheDocument()
    // Should show JSON text
    expect(screen.getByText(/Add login page/)).toBeInTheDocument()
  })

  it('strips template field and sets spec to prompt on create', async () => {
    const user = userEvent.setup()
    const ticketsWithTemplate = [
      { title: 'Test', prompt: 'Do the thing', repo: 'bde', priority: 1, template: 'feature' },
    ] as Array<{ title: string; prompt: string; repo: string; priority: number; template?: string }>

    render(<TicketEditor initialTickets={ticketsWithTemplate} />)

    await user.click(screen.getByText('Create All (1)'))

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith({
        title: 'Test',
        repo: 'bde',
        prompt: 'Do the thing',
        priority: 1,
        spec: 'Do the thing',
      })
    })
  })

  it('expands prompt textarea when toggle is clicked', async () => {
    const user = userEvent.setup()
    render(<TicketEditor initialTickets={sampleTickets} />)

    // Prompt should be collapsed initially — show first line
    const toggles = screen.getAllByText(/Prompt/)
    await user.click(toggles[0])

    // After expanding, the textarea should be visible with the full content
    await waitFor(() => {
      const textareas = document.querySelectorAll('textarea')
      expect(textareas.length).toBeGreaterThan(0)
    })
  })

  it('reorders tickets with move up/down buttons', async () => {
    const user = userEvent.setup()
    render(<TicketEditor initialTickets={sampleTickets} />)

    // Move second ticket up
    const moveUpButtons = screen.getAllByTitle('Move up')
    await user.click(moveUpButtons[1])

    // After reorder, first input should be "Add logout button"
    const inputs = screen.getAllByPlaceholderText('Short descriptive title')
    expect((inputs[0] as HTMLInputElement).value).toBe('Add logout button')
    expect((inputs[1] as HTMLInputElement).value).toBe('Add login page')
  })
})
