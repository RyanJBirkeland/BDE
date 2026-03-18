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
      notes: '',
      prompt: 'Fix the bug',
      spec: null,
      priority: 3,
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
      notes: '',
      prompt: 'My task',
      spec: null,
      priority: 3,
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

  it('shows Design with Paul tab', () => {
    render(<NewTicketModal {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Design with Paul' })).toBeInTheDocument()
  })

  it('switching to Design mode shows Paul opening message and hides footer', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Design with Paul' }))

    expect(screen.getByText(/What are you thinking about building/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Type your response/)).toBeInTheDocument()
    expect(screen.getByText('Spec Preview')).toBeInTheDocument()
    // Footer buttons should be hidden in design mode
    expect(screen.queryByRole('button', { name: /Save — Paul writes the spec/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save to Backlog' })).not.toBeInTheDocument()
  })

  it('Design mode: spec preview shows empty state initially', async () => {
    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Design with Paul' }))

    expect(screen.getByText('Spec will appear here as Paul drafts it.')).toBeInTheDocument()
  })

  it('Design mode: sends message via invokeTool with bde-design-mode session', async () => {
    const mockInvoke = vi.mocked(window.api.invokeTool)
    mockInvoke.mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: 'What scope are you targeting?' }] },
    })

    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Design with Paul' }))
    const textarea = screen.getByPlaceholderText(/Type your response/)
    await user.type(textarea, 'I want to add a cost dashboard')
    await user.click(screen.getByText('\u2192'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'sessions_send',
        expect.objectContaining({
          sessionKey: 'bde-design-mode',
          timeoutSeconds: 45,
        })
      )
    })
  })

  it('Design mode: extracts spec from ~~~spec fence and shows in preview', async () => {
    const specContent = 'Ticket Title: Add cost dashboard\n\n## Problem\nNo cost visibility'
    vi.mocked(window.api.invokeTool).mockResolvedValue({
      ok: true,
      result: {
        content: [{ type: 'text', text: `Here is the spec:\n\n~~~spec\n${specContent}\n~~~` }],
      },
    })

    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Design with Paul' }))
    await user.type(screen.getByPlaceholderText(/Type your response/), 'Build a cost dashboard')
    await user.click(screen.getByText('\u2192'))

    await waitFor(() => {
      expect(screen.getByText('Save Spec to Backlog')).toBeInTheDocument()
    })
  })

  it('Design mode: Save Spec to Backlog calls onCreate with extracted data', async () => {
    const specContent = 'Ticket Title: Add cost dashboard\n\n## Problem\nNo cost visibility'
    vi.mocked(window.api.invokeTool).mockResolvedValue({
      ok: true,
      result: {
        content: [{ type: 'text', text: `~~~spec\n${specContent}\n~~~` }],
      },
    })

    const user = userEvent.setup()
    render(<NewTicketModal {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Design with Paul' }))
    await user.type(screen.getByPlaceholderText(/Type your response/), 'Build a cost dashboard')
    await user.click(screen.getByText('\u2192'))

    await waitFor(() => {
      expect(screen.getByText('Save Spec to Backlog')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Save Spec to Backlog'))

    expect(defaultProps.onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Add cost dashboard',
        spec: specContent,
        prompt: specContent,
        repo: 'BDE',
      })
    )
    expect(defaultProps.onClose).toHaveBeenCalled()
  })
})
