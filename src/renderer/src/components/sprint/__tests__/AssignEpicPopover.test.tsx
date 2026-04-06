import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../stores/taskGroups', () => ({
  useTaskGroups: vi.fn(() => ({
    groups: [
      { id: 'g1', name: 'Sprint 1', icon: '🚀' },
      { id: 'g2', name: 'Sprint 2', icon: '📦' }
    ],
    loadGroups: vi.fn(),
    addTaskToGroup: vi.fn().mockResolvedValue(undefined)
  }))
}))

vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

import { AssignEpicPopover } from '../AssignEpicPopover'

describe('AssignEpicPopover', () => {
  const defaultProps = {
    selectedTaskIds: new Set(['t1', 't2']),
    onAssignComplete: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the trigger button', () => {
    render(<AssignEpicPopover {...defaultProps} />)
    expect(screen.getByText('Assign to Epic')).toBeInTheDocument()
  })

  it('opens dropdown on button click', () => {
    render(<AssignEpicPopover {...defaultProps} />)
    fireEvent.click(screen.getByText('Assign to Epic'))
    expect(screen.getByText('Select an epic...')).toBeInTheDocument()
  })

  it('shows group options in dropdown', () => {
    render(<AssignEpicPopover {...defaultProps} />)
    fireEvent.click(screen.getByText('Assign to Epic'))
    expect(screen.getByText(/Sprint 1/)).toBeInTheDocument()
    expect(screen.getByText(/Sprint 2/)).toBeInTheDocument()
  })

  it('closes on Cancel click', () => {
    render(<AssignEpicPopover {...defaultProps} />)
    fireEvent.click(screen.getByText('Assign to Epic'))
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })

  it('disables trigger when no tasks selected', () => {
    render(<AssignEpicPopover selectedTaskIds={new Set()} onAssignComplete={vi.fn()} />)
    expect(screen.getByText('Assign to Epic').closest('button')).toBeDisabled()
  })
})
