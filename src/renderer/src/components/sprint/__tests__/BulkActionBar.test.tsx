import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BulkActionBar } from '../BulkActionBar'

describe('BulkActionBar', () => {
  const mockOnSetPriority = vi.fn()
  const mockOnDelete = vi.fn()
  const mockOnMarkDone = vi.fn()
  const mockOnClearSelection = vi.fn()

  const defaultProps = {
    selectedCount: 0,
    onSetPriority: mockOnSetPriority,
    onDelete: mockOnDelete,
    onMarkDone: mockOnMarkDone,
    onClearSelection: mockOnClearSelection
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when selectedCount is 0', () => {
    const { container } = render(<BulkActionBar {...defaultProps} selectedCount={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders with selected count when selectedCount > 0', () => {
    render(<BulkActionBar {...defaultProps} selectedCount={3} />)
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument()
  })

  it('shows priority dropdown button', () => {
    render(<BulkActionBar {...defaultProps} selectedCount={2} />)
    expect(screen.getByText(/set priority/i)).toBeInTheDocument()
  })

  it('shows delete button', () => {
    render(<BulkActionBar {...defaultProps} selectedCount={2} />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('shows mark done button', () => {
    render(<BulkActionBar {...defaultProps} selectedCount={2} />)
    expect(screen.getByRole('button', { name: /mark done/i })).toBeInTheDocument()
  })

  it('clicking mark done calls onMarkDone', async () => {
    const user = userEvent.setup()
    render(<BulkActionBar {...defaultProps} selectedCount={2} />)
    await user.click(screen.getByRole('button', { name: /mark done/i }))
    expect(mockOnMarkDone).toHaveBeenCalled()
  })

  it('clicking delete shows confirmation', async () => {
    const user = userEvent.setup()
    render(<BulkActionBar {...defaultProps} selectedCount={2} />)
    await user.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument()
  })

  it('confirming delete calls onDelete', async () => {
    const user = userEvent.setup()
    render(<BulkActionBar {...defaultProps} selectedCount={2} />)
    await user.click(screen.getByRole('button', { name: /delete/i }))
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i })
    const confirmButton = deleteButtons[deleteButtons.length - 1]
    await user.click(confirmButton)
    expect(mockOnDelete).toHaveBeenCalled()
  })

  it('canceling delete does not call onDelete', async () => {
    const user = userEvent.setup()
    render(<BulkActionBar {...defaultProps} selectedCount={2} />)
    await user.click(screen.getByRole('button', { name: /delete/i }))
    const cancelButton = screen.getByRole('button', { name: /cancel|no/i })
    await user.click(cancelButton)
    expect(mockOnDelete).not.toHaveBeenCalled()
  })

  it('priority dropdown shows P1-P5 options', async () => {
    const user = userEvent.setup()
    render(<BulkActionBar {...defaultProps} selectedCount={2} />)
    const priorityButton = screen.getByText(/set priority/i)
    await user.click(priorityButton)

    expect(screen.getByText('P1')).toBeInTheDocument()
    expect(screen.getByText('P2')).toBeInTheDocument()
    expect(screen.getByText('P3')).toBeInTheDocument()
    expect(screen.getByText('P4')).toBeInTheDocument()
    expect(screen.getByText('P5')).toBeInTheDocument()
  })

  it('selecting priority calls onSetPriority with correct value', async () => {
    const user = userEvent.setup()
    render(<BulkActionBar {...defaultProps} selectedCount={2} />)
    const priorityButton = screen.getByText(/set priority/i)
    await user.click(priorityButton)
    await user.click(screen.getByText('P2'))
    expect(mockOnSetPriority).toHaveBeenCalledWith(2)
  })
})
