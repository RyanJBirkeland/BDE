import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommitBox } from '../CommitBox'

const defaultProps = {
  commitMessage: '',
  stagedCount: 0,
  onMessageChange: vi.fn(),
  onCommit: vi.fn(),
  onPush: vi.fn()
}

describe('CommitBox', () => {
  it('renders commit message textarea', () => {
    render(<CommitBox {...defaultProps} />)
    expect(screen.getByLabelText('Commit message')).toBeInTheDocument()
  })

  it('renders Commit button', () => {
    render(<CommitBox {...defaultProps} />)
    expect(screen.getByLabelText('Commit staged changes')).toBeInTheDocument()
  })

  it('renders Push button', () => {
    render(<CommitBox {...defaultProps} />)
    expect(screen.getByLabelText('Push to remote')).toBeInTheDocument()
  })

  it('Commit button is disabled when message is empty', () => {
    render(<CommitBox {...defaultProps} commitMessage="" stagedCount={1} />)
    expect(screen.getByLabelText('Commit staged changes')).toBeDisabled()
  })

  it('Commit button is disabled when no staged files', () => {
    render(<CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={0} />)
    expect(screen.getByLabelText('Commit staged changes')).toBeDisabled()
  })

  it('Commit button is enabled when message and staged files both present', () => {
    render(<CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={2} />)
    expect(screen.getByLabelText('Commit staged changes')).not.toBeDisabled()
  })

  it('calls onMessageChange when textarea value changes', () => {
    const onMessageChange = vi.fn()
    render(<CommitBox {...defaultProps} onMessageChange={onMessageChange} />)
    fireEvent.change(screen.getByLabelText('Commit message'), {
      target: { value: 'new message' }
    })
    expect(onMessageChange).toHaveBeenCalledWith('new message')
  })

  it('calls onCommit when Commit button clicked', () => {
    const onCommit = vi.fn()
    render(
      <CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={1} onCommit={onCommit} />
    )
    fireEvent.click(screen.getByLabelText('Commit staged changes'))
    expect(onCommit).toHaveBeenCalled()
  })

  it('calls onPush when Push button clicked', () => {
    const onPush = vi.fn()
    render(<CommitBox {...defaultProps} onPush={onPush} />)
    fireEvent.click(screen.getByLabelText('Push to remote'))
    expect(onPush).toHaveBeenCalled()
  })

  it('commits on Cmd+Enter keyboard shortcut', () => {
    const onCommit = vi.fn()
    render(
      <CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={1} onCommit={onCommit} />
    )
    const textarea = screen.getByLabelText('Commit message')
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(onCommit).toHaveBeenCalled()
  })

  it('does not commit on Cmd+Enter when disabled', () => {
    const onCommit = vi.fn()
    render(<CommitBox {...defaultProps} commitMessage="" stagedCount={0} onCommit={onCommit} />)
    const textarea = screen.getByLabelText('Commit message')
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('shows staged file count in commit button', () => {
    render(<CommitBox {...defaultProps} commitMessage="msg" stagedCount={3} />)
    expect(screen.getByText('(3)')).toBeInTheDocument()
  })

  it('does not show count badge when stagedCount is 0', () => {
    render(<CommitBox {...defaultProps} commitMessage="msg" stagedCount={0} />)
    expect(screen.queryByText('(0)')).not.toBeInTheDocument()
  })

  it('commits on Ctrl+Enter keyboard shortcut', () => {
    const onCommit = vi.fn()
    render(
      <CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={1} onCommit={onCommit} />
    )
    const textarea = screen.getByLabelText('Commit message')
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(onCommit).toHaveBeenCalled()
  })
})
