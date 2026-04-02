import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../lib/render-markdown', () => ({
  renderMarkdown: (s: string) => s
}))

import { DiffCommentWidget } from '../DiffCommentWidget'
import type { PrComment } from '../../../../../shared/types'

function makeComment(overrides: Partial<PrComment> = {}): PrComment {
  return {
    id: 1,
    user: { login: 'alice', avatar_url: '' },
    body: 'test comment body',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    html_url: 'https://github.com',
    ...overrides
  }
}

describe('DiffCommentWidget', () => {
  it('renders nothing when comments array is empty', () => {
    const { container } = render(<DiffCommentWidget comments={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders comment count for a single comment', () => {
    render(<DiffCommentWidget comments={[makeComment()]} />)
    expect(screen.getByText('1 comment')).toBeInTheDocument()
  })

  it('renders plural comment count for multiple comments', () => {
    render(<DiffCommentWidget comments={[makeComment({ id: 1 }), makeComment({ id: 2 })]} />)
    expect(screen.getByText('2 comments')).toBeInTheDocument()
  })

  it('shows comment bodies by default (not collapsed)', () => {
    render(<DiffCommentWidget comments={[makeComment({ body: 'hello from alice' })]} />)
    expect(screen.getByText('hello from alice')).toBeInTheDocument()
  })

  it('hides comment bodies when toggle is clicked (collapse)', async () => {
    const user = userEvent.setup()
    render(<DiffCommentWidget comments={[makeComment({ body: 'visible body' })]} />)
    expect(screen.getByText('visible body')).toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('visible body')).not.toBeInTheDocument()
  })

  it('expands collapsed thread on second click', async () => {
    const user = userEvent.setup()
    render(<DiffCommentWidget comments={[makeComment({ body: 'expandable body' })]} />)
    const toggle = screen.getByRole('button')
    // collapse
    await user.click(toggle)
    expect(screen.queryByText('expandable body')).not.toBeInTheDocument()
    // expand
    await user.click(toggle)
    expect(screen.getByText('expandable body')).toBeInTheDocument()
  })

  it('renders comment author login', () => {
    render(
      <DiffCommentWidget comments={[makeComment({ user: { login: 'bob', avatar_url: '' } })]} />
    )
    expect(screen.getByText('bob')).toBeInTheDocument()
  })
})
