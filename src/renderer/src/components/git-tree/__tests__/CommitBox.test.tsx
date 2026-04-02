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

  // ---------- Branch coverage: commitLoading ----------

  it('shows "Committing..." text when commitLoading is true', () => {
    render(<CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={2} commitLoading={true} />)
    expect(screen.getByText('Committing...')).toBeInTheDocument()
  })

  it('disables commit when commitLoading is true even with message and staged files', () => {
    render(<CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={2} commitLoading={true} />)
    expect(screen.getByLabelText('Commit staged changes')).toBeDisabled()
  })

  it('shows spinner icon when commitLoading is true', () => {
    render(<CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={2} commitLoading={true} />)
    expect(screen.getByLabelText('Commit staged changes').getAttribute('aria-busy')).toBe('true')
  })

  it('hides staged count badge when commitLoading is true', () => {
    render(<CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={2} commitLoading={true} />)
    expect(screen.queryByText('(2)')).not.toBeInTheDocument()
  })

  it('shows commit title "Committing..." when commitLoading', () => {
    render(<CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={2} commitLoading={true} />)
    expect(screen.getByLabelText('Commit staged changes').getAttribute('title')).toBe('Committing...')
  })

  // ---------- Branch coverage: pushLoading ----------

  it('shows "Pushing..." text when pushLoading is true', () => {
    render(<CommitBox {...defaultProps} pushLoading={true} />)
    expect(screen.getByText('Pushing...')).toBeInTheDocument()
  })

  it('disables push button when pushLoading is true', () => {
    render(<CommitBox {...defaultProps} pushLoading={true} />)
    expect(screen.getByLabelText('Push to remote')).toBeDisabled()
  })

  it('shows push title "Pushing..." when pushLoading', () => {
    render(<CommitBox {...defaultProps} pushLoading={true} />)
    expect(screen.getByLabelText('Push to remote').getAttribute('title')).toBe('Pushing...')
  })

  it('shows push title "Push to remote" when not loading', () => {
    render(<CommitBox {...defaultProps} pushLoading={false} />)
    expect(screen.getByLabelText('Push to remote').getAttribute('title')).toBe('Push to remote')
  })

  it('shows push aria-busy=false when not loading', () => {
    render(<CommitBox {...defaultProps} pushLoading={false} />)
    expect(screen.getByLabelText('Push to remote').getAttribute('aria-busy')).toBe('false')
  })

  // ---------- Branch coverage: character counter ----------

  it('shows character counter when commit message is present', () => {
    render(<CommitBox {...defaultProps} commitMessage="feat: something" stagedCount={1} />)
    expect(screen.getByText('15/72')).toBeInTheDocument()
  })

  it('does not show character counter when message is empty', () => {
    render(<CommitBox {...defaultProps} commitMessage="" stagedCount={1} />)
    expect(screen.queryByText(/\/72/)).not.toBeInTheDocument()
  })

  it('applies over-limit class when first line exceeds 72 chars', () => {
    const longMessage = 'a'.repeat(73)
    const { container } = render(
      <CommitBox {...defaultProps} commitMessage={longMessage} stagedCount={1} />
    )
    expect(container.querySelector('.git-commit-box__char-count--over')).toBeInTheDocument()
  })

  it('does not apply over-limit class when first line is within 72 chars', () => {
    const shortMessage = 'a'.repeat(72)
    const { container } = render(
      <CommitBox {...defaultProps} commitMessage={shortMessage} stagedCount={1} />
    )
    expect(container.querySelector('.git-commit-box__char-count--over')).not.toBeInTheDocument()
  })

  it('counts only first line for char limit with multiline message', () => {
    const multiLine = 'short\n' + 'a'.repeat(100)
    render(<CommitBox {...defaultProps} commitMessage={multiLine} stagedCount={1} />)
    expect(screen.getByText('5/72')).toBeInTheDocument()
  })

  // ---------- Branch coverage: commit button title branches ----------

  it('shows "No staged changes" title when stagedCount is 0 and not loading', () => {
    render(<CommitBox {...defaultProps} commitMessage="msg" stagedCount={0} />)
    expect(screen.getByLabelText('Commit staged changes').getAttribute('title')).toBe('No staged changes')
  })

  it('shows "Enter a commit message" title when message empty but staged > 0', () => {
    render(<CommitBox {...defaultProps} commitMessage="" stagedCount={1} />)
    expect(screen.getByLabelText('Commit staged changes').getAttribute('title')).toBe('Enter a commit message')
  })

  it('shows keyboard shortcut title when commit is enabled', () => {
    render(<CommitBox {...defaultProps} commitMessage="msg" stagedCount={1} />)
    expect(screen.getByLabelText('Commit staged changes').getAttribute('title')).toBe('Commit staged changes (⌘↵)')
  })

  // ---------- Branch coverage: Cmd+Enter when canCommit is false ----------

  it('does not commit on Cmd+Enter when commitLoading', () => {
    const onCommit = vi.fn()
    render(
      <CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={1} commitLoading={true} onCommit={onCommit} />
    )
    const textarea = screen.getByLabelText('Commit message')
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(onCommit).not.toHaveBeenCalled()
  })

  // ---------- Branch coverage: non-shortcut keyDown ----------

  it('does not trigger commit on non-Enter keydown', () => {
    const onCommit = vi.fn()
    render(
      <CommitBox {...defaultProps} commitMessage="feat: test" stagedCount={1} onCommit={onCommit} />
    )
    const textarea = screen.getByLabelText('Commit message')
    fireEvent.keyDown(textarea, { key: 'a', metaKey: false })
    expect(onCommit).not.toHaveBeenCalled()
  })
})
