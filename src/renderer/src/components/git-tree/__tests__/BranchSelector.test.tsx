import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BranchSelector } from '../BranchSelector'

const defaultProps = {
  currentBranch: 'main',
  branches: ['main', 'feat/test', 'fix/bug'],
  hasUncommittedChanges: false,
  onCheckout: vi.fn()
}

describe('BranchSelector', () => {
  it('renders current branch name', () => {
    render(<BranchSelector {...defaultProps} />)
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('shows accessible label with branch name', () => {
    render(<BranchSelector {...defaultProps} />)
    expect(screen.getByLabelText(/Current branch: main/)).toBeInTheDocument()
  })

  it('is disabled when uncommitted changes exist', () => {
    render(<BranchSelector {...defaultProps} hasUncommittedChanges={true} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is enabled when no uncommitted changes', () => {
    render(<BranchSelector {...defaultProps} hasUncommittedChanges={false} />)
    expect(screen.getByRole('button')).not.toBeDisabled()
  })

  it('opens dropdown when clicked', () => {
    render(<BranchSelector {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox', { name: 'Branches' })).toBeInTheDocument()
  })

  it('shows all branches in dropdown', () => {
    render(<BranchSelector {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('marks current branch as selected in dropdown', () => {
    render(<BranchSelector {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    const options = screen.getAllByRole('option')
    const mainOption = options.find((o) => o.getAttribute('aria-selected') === 'true')
    expect(mainOption).toBeTruthy()
    expect(mainOption?.textContent).toContain('main')
  })

  it('calls onCheckout when a different branch is selected', () => {
    const onCheckout = vi.fn()
    render(<BranchSelector {...defaultProps} onCheckout={onCheckout} />)
    fireEvent.click(screen.getByRole('button'))
    const options = screen.getAllByRole('option')
    const featOption = options.find((o) => o.textContent?.includes('feat/test'))
    fireEvent.click(featOption!)
    expect(onCheckout).toHaveBeenCalledWith('feat/test')
  })

  it('does not call onCheckout when current branch is selected', () => {
    const onCheckout = vi.fn()
    render(<BranchSelector {...defaultProps} onCheckout={onCheckout} />)
    fireEvent.click(screen.getByRole('button'))
    const options = screen.getAllByRole('option')
    const mainOption = options.find((o) => o.textContent?.includes('main'))
    fireEvent.click(mainOption!)
    expect(onCheckout).not.toHaveBeenCalled()
  })

  it('closes dropdown after selecting a branch', () => {
    render(<BranchSelector {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    const options = screen.getAllByRole('option')
    const featOption = options.find((o) => o.textContent?.includes('feat/test'))
    fireEvent.click(featOption!)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes dropdown when backdrop is clicked', () => {
    render(<BranchSelector {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    // Click the backdrop (fixed overlay)
    const backdrop = document.querySelector('[style*="position: fixed"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows empty message when no branches', () => {
    render(<BranchSelector {...defaultProps} branches={[]} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('No branches found')).toBeInTheDocument()
  })

  it('does not open dropdown when disabled', () => {
    render(<BranchSelector {...defaultProps} hasUncommittedChanges={true} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
