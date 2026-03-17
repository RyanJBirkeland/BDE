import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTicketModal } from '../NewTicketModal'

describe('NewTicketModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onCreate: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when not open', () => {
    const { container } = render(<NewTicketModal {...defaultProps} open={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('defaults to Quick mode with title input and repo selector', () => {
    render(<NewTicketModal {...defaultProps} />)

    expect(screen.getByText('Quick')).toBeInTheDocument()
    expect(screen.getByText('Template')).toBeInTheDocument()
    expect(screen.getByText('Design with Paul')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Fix toast z-index/)).toBeInTheDocument()
    expect(screen.getByText('Repo')).toBeInTheDocument()
  })

  it('Quick mode submit button says "Save — Paul writes the spec"', () => {
    render(<NewTicketModal {...defaultProps} />)
    expect(
      screen.getByRole('button', { name: /Save — Paul writes the spec/ })
    ).toBeInTheDocument()
  })

  it('Quick mode submit is disabled when title is empty', () => {
    render(<NewTicketModal {...defaultProps} />)
    const submitBtn = screen.getByRole('button', { name: /Save — Paul writes the spec/ })
    expect(submitBtn).toBeDisabled()
  })

  it('Quick mode calls onCreate with spec: null and prompt: title', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.type(screen.getByPlaceholderText(/Fix toast z-index/), 'Fix the bug')
    await user.click(screen.getByRole('button', { name: /Save — Paul writes the spec/ }))

    expect(defaultProps.onCreate).toHaveBeenCalledWith({
      title: 'Fix the bug',
      repo: 'BDE',
      description: '',
      prompt: 'Fix the bug',
      spec: null,
      priority: 1,
    })
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('switching to Template mode shows full form', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Template' }))

    expect(screen.getByText('Priority')).toBeInTheDocument()
    expect(screen.getByText('Spec')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Write your spec in markdown or pick a template above...')
    ).toBeInTheDocument()
  })

  it('Template mode submit button says "Save to Backlog"', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Template' }))
    expect(screen.getByRole('button', { name: 'Save to Backlog' })).toBeInTheDocument()
  })

  it('Template mode calls onCreate with spec and prompt', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Template' }))
    await user.type(screen.getByPlaceholderText(/Add recipe search/), 'My task')
    await user.click(screen.getByRole('button', { name: 'Save to Backlog' }))

    expect(defaultProps.onCreate).toHaveBeenCalledWith({
      title: 'My task',
      repo: 'BDE',
      description: '',
      prompt: 'My task',
      spec: null,
      priority: 1,
    })
  })

  it('repo selector shows all valid repo options in Quick mode', () => {
    render(<NewTicketModal {...defaultProps} />)
    const options = screen.getAllByRole('option')
    const repoOptions = options.filter((o) =>
      ['BDE', 'life-os', 'feast'].includes(o.textContent ?? '')
    )
    expect(repoOptions).toHaveLength(3)
  })

  it('Design mode shows placeholder', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Design with Paul' }))
    expect(screen.getByText('Design with Paul is coming soon.')).toBeInTheDocument()
  })

  it('Template mode: Ask Paul button triggers invokeTool call', async () => {
    const mockInvoke = vi.mocked(window.api.invokeTool)
    mockInvoke.mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: '## Generated Spec' }] },
    })

    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Template' }))
    await user.type(screen.getByPlaceholderText(/Add recipe search/), 'Build feature X')

    const askPaulBtn = screen.getByRole('button', { name: 'Ask Paul' })
    await user.click(askPaulBtn)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'sessions_send',
        expect.objectContaining({
          sessionKey: 'main',
          timeoutSeconds: 30,
        })
      )
    })
  })

  it('Template mode: Ask Paul button is disabled when title is empty', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Template' }))
    const askPaulBtn = screen.getByRole('button', { name: 'Ask Paul' })
    expect(askPaulBtn).toBeDisabled()
  })

  it('Template mode: populates spec textarea with AI-generated content', async () => {
    vi.mocked(window.api.invokeTool).mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: '## AI Spec Content' }] },
    })

    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Template' }))
    await user.type(screen.getByPlaceholderText(/Add recipe search/), 'Build feature X')
    await user.click(screen.getByRole('button', { name: 'Ask Paul' }))

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(
        'Write your spec in markdown or pick a template above...'
      ) as HTMLTextAreaElement
      expect(textarea.value).toBe('## AI Spec Content')
    })
  })

  it('Template mode: template chip populates spec with template content', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Template' }))
    await user.click(screen.getByRole('button', { name: 'Feature' }))

    const textarea = screen.getByPlaceholderText(
      'Write your spec in markdown or pick a template above...'
    ) as HTMLTextAreaElement
    expect(textarea.value).toContain('## Problem')
    expect(textarea.value).toContain('## Solution')
  })

  it('Template mode: toggling same template chip clears spec', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Template' }))
    await user.click(screen.getByRole('button', { name: 'Feature' }))
    await user.click(screen.getByRole('button', { name: 'Feature' }))

    const textarea = screen.getByPlaceholderText(
      'Write your spec in markdown or pick a template above...'
    ) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('clears form and resets to Quick mode when modal reopens', () => {
    const { rerender } = render(<NewTicketModal {...defaultProps} open={false} />)
    rerender(<NewTicketModal {...defaultProps} open={true} />)

    // Should be in Quick mode by default
    expect(screen.getByPlaceholderText(/Fix toast z-index/)).toBeInTheDocument()
  })
})
