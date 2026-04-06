import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('../AssignEpicPopover', () => ({
  AssignEpicPopover: () => null
}))

import { BulkActionBar } from '../BulkActionBar'

describe('BulkActionBar', () => {
  const defaultProps = {
    selectedCount: 2,
    selectedTaskIds: new Set(['t1', 't2']),
    onClearSelection: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.api.sprint as unknown as Record<string, unknown>).batchUpdate = vi
      .fn()
      .mockResolvedValue({
        results: [
          { id: 't1', ok: true },
          { id: 't2', ok: true }
        ]
      })
  })

  it('returns null when no tasks selected', () => {
    const { container } = render(
      <BulkActionBar selectedCount={0} selectedTaskIds={new Set()} onClearSelection={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows selected count', () => {
    render(<BulkActionBar {...defaultProps} />)
    expect(screen.getByText('2 tasks selected')).toBeInTheDocument()
  })

  it('shows action buttons', () => {
    render(<BulkActionBar {...defaultProps} />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByText('Requeue')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('clears selection when X is clicked', () => {
    render(<BulkActionBar {...defaultProps} />)
    const clearBtn = screen.getByLabelText('Clear selection')
    fireEvent.click(clearBtn)
    expect(defaultProps.onClearSelection).toHaveBeenCalled()
  })
})
