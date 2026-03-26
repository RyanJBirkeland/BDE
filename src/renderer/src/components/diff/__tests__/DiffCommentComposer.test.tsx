import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiffCommentComposer } from '../DiffCommentComposer'

describe('DiffCommentComposer', () => {
  it('renders a textarea with placeholder', () => {
    render(<DiffCommentComposer onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByPlaceholderText(/leave a comment/i)).toBeInTheDocument()
  })

  it('submit button is disabled when textarea is empty', () => {
    render(<DiffCommentComposer onSubmit={vi.fn()} onCancel={vi.fn()} />)
    const submitBtn = screen.getByRole('button', { name: /add review comment/i })
    expect(submitBtn).toBeDisabled()
  })

  it('submit button is enabled when textarea has content', async () => {
    const user = userEvent.setup()
    render(<DiffCommentComposer onSubmit={vi.fn()} onCancel={vi.fn()} />)
    const textarea = screen.getByPlaceholderText(/leave a comment/i)
    await user.type(textarea, 'hello world')
    const submitBtn = screen.getByRole('button', { name: /add review comment/i })
    expect(submitBtn).not.toBeDisabled()
  })

  it('calls onSubmit with trimmed body when submit button clicked', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<DiffCommentComposer onSubmit={onSubmit} onCancel={vi.fn()} />)
    const textarea = screen.getByPlaceholderText(/leave a comment/i)
    await user.type(textarea, '  my comment  ')
    await user.click(screen.getByRole('button', { name: /add review comment/i }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith('my comment')
  })

  it('does not call onSubmit when body is only whitespace', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<DiffCommentComposer onSubmit={onSubmit} onCancel={vi.fn()} />)
    const textarea = screen.getByPlaceholderText(/leave a comment/i)
    await user.type(textarea, '   ')
    // button should remain disabled — click won't trigger submit even if we force it
    const submitBtn = screen.getByRole('button', { name: /add review comment/i })
    expect(submitBtn).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<DiffCommentComposer onSubmit={vi.fn()} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('pre-fills textarea with initialBody', () => {
    render(
      <DiffCommentComposer onSubmit={vi.fn()} onCancel={vi.fn()} initialBody="pre-filled text" />
    )
    const textarea = screen.getByPlaceholderText(/leave a comment/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('pre-filled text')
  })
})
