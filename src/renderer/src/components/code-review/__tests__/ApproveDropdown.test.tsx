import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApproveDropdown } from '../ApproveDropdown'

const defaultProps = {
  onMergeLocally: vi.fn(),
  onSquashMerge: vi.fn(),
  onCreatePR: vi.fn(),
  onRequestRevision: vi.fn(),
  onDiscard: vi.fn()
}

// V2: ApproveDropdown is now a kebab (MoreHorizontal) button with
// aria-label "More review actions" — not labeled "Approve".
describe('ApproveDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders trigger button with More review actions label', () => {
    render(<ApproveDropdown {...defaultProps} />)
    expect(screen.getByRole('button', { name: /more review actions/i })).toBeInTheDocument()
  })

  it('opens dropdown menu when trigger is clicked', async () => {
    const user = userEvent.setup()
    render(<ApproveDropdown {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: /more review actions/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /merge locally/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /squash & merge/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /create pr/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /request revision/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /discard/i })).toBeInTheDocument()
  })

  it('closes dropdown and calls callback when a menu item is clicked', async () => {
    const user = userEvent.setup()
    render(<ApproveDropdown {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: /more review actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /squash & merge/i }))
    expect(defaultProps.onSquashMerge).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('disables trigger button when disabled prop is true', () => {
    render(<ApproveDropdown {...defaultProps} disabled />)
    expect(screen.getByRole('button', { name: /more review actions/i })).toBeDisabled()
  })

  it('does not open dropdown when disabled', async () => {
    const user = userEvent.setup()
    render(<ApproveDropdown {...defaultProps} disabled />)
    await user.click(screen.getByRole('button', { name: /more review actions/i }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('disables trigger button when loading', () => {
    render(<ApproveDropdown {...defaultProps} loading />)
    expect(screen.getByRole('button', { name: /more review actions/i })).toBeDisabled()
  })

  it('marks trigger as busy when loading', () => {
    render(<ApproveDropdown {...defaultProps} loading />)
    expect(screen.getByRole('button', { name: /more review actions/i })).toHaveAttribute('aria-busy', 'true')
  })

  it('does not open dropdown when loading', async () => {
    const user = userEvent.setup()
    render(<ApproveDropdown {...defaultProps} loading />)
    await user.click(screen.getByRole('button', { name: /more review actions/i }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not show aria-busy when not loading', () => {
    render(<ApproveDropdown {...defaultProps} />)
    const trigger = screen.getByRole('button', { name: /more review actions/i })
    expect(trigger).not.toHaveAttribute('aria-busy', 'true')
  })
})
