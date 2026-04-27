import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateEpicModal } from '../CreateEpicModal'
import { useTaskGroups } from '../../../stores/taskGroups'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onKeyDown, role, ...rest }: any) => {
      const { createElement } = require('react')
      return createElement('div', { onKeyDown, role, ...rest }, children)
    }
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false
}))

vi.mock('../../../lib/motion', () => ({
  VARIANTS: { scaleIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: { duration: 0 },
  useReducedMotion: () => false
}))

vi.mock('../../../stores/taskGroups', () => ({
  useTaskGroups: vi.fn()
}))

describe('CreateEpicModal', () => {
  const mockCreateGroup = vi.fn()
  const mockSelectGroup = vi.fn()
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTaskGroups).mockReturnValue({
      createGroup: mockCreateGroup,
      selectGroup: mockSelectGroup,
      groups: [],
      selectedGroupId: null,
      groupTasks: [],
      loading: false,
      loadGroups: vi.fn(),
      loadGroupTasks: vi.fn(),
      updateGroup: vi.fn(),
      deleteGroup: vi.fn(),
      addTaskToGroup: vi.fn(),
      removeTaskFromGroup: vi.fn(),
      queueAllTasks: vi.fn()
    })
  })

  it('renders nothing when open is false', () => {
    const { container } = render(<CreateEpicModal open={false} onClose={onClose} />)
    expect(container.textContent).toBe('')
  })

  it('renders form fields when open is true', () => {
    render(<CreateEpicModal open={true} onClose={onClose} />)
    expect(screen.getByText('New Epic')).toBeInTheDocument()
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument()
    expect(screen.getByLabelText('Icon')).toBeInTheDocument()
    expect(screen.getByLabelText('Goal (optional)')).toBeInTheDocument()
  })

  it('shows Create Epic button', () => {
    render(<CreateEpicModal open={true} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Create Epic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('disables Create button when name is empty', () => {
    render(<CreateEpicModal open={true} onClose={onClose} />)
    const createButton = screen.getByRole('button', { name: 'Create Epic' })
    expect(createButton).toBeDisabled()
  })

  it('enables Create button when name is filled', async () => {
    const user = userEvent.setup()
    render(<CreateEpicModal open={true} onClose={onClose} />)
    const nameInput = screen.getByLabelText(/Name/)
    await user.type(nameInput, 'Test Epic')
    const createButton = screen.getByRole('button', { name: 'Create Epic' })
    expect(createButton).not.toBeDisabled()
  })

  it('calls createGroup and selectGroup when Create button is clicked', async () => {
    const user = userEvent.setup()
    const newGroup = { id: 'new-123', name: 'Test Epic', icon: 'E', goal: '' }
    mockCreateGroup.mockResolvedValue(newGroup)

    render(<CreateEpicModal open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText(/Name/), 'Test Epic')
    await user.click(screen.getByRole('button', { name: 'Create Epic' }))

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith({
        name: 'Test Epic',
        icon: 'E',
        accent_color: 'var(--fleet-accent)',
        goal: undefined
      })
    })
    expect(mockSelectGroup).toHaveBeenCalledWith('new-123')
    expect(onClose).toHaveBeenCalled()
  })

  it('submits with custom icon and goal', async () => {
    const user = userEvent.setup()
    const newGroup = { id: 'new-456', name: 'My Epic', icon: 'M', goal: 'Build stuff' }
    mockCreateGroup.mockResolvedValue(newGroup)

    render(<CreateEpicModal open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText(/Name/), 'My Epic')
    const iconInput = screen.getByLabelText('Icon')
    await user.clear(iconInput)
    await user.type(iconInput, 'M')
    await user.type(screen.getByLabelText('Goal (optional)'), 'Build stuff')
    await user.click(screen.getByRole('button', { name: 'Create Epic' }))

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith({
        name: 'My Epic',
        icon: 'M',
        accent_color: 'var(--fleet-accent)',
        goal: 'Build stuff'
      })
    })
    expect(mockSelectGroup).toHaveBeenCalledWith('new-456')
    expect(onClose).toHaveBeenCalled()
  })

  it('enforces single-character icon', async () => {
    render(<CreateEpicModal open={true} onClose={onClose} />)

    const iconInput = screen.getByLabelText('Icon') as HTMLInputElement

    // Simulate pasting multiple characters
    fireEvent.change(iconInput, { target: { value: 'ABC' } })

    // Should only keep the last character
    expect(iconInput.value).toBe('C')
  })

  it('trims whitespace from name and goal', async () => {
    const user = userEvent.setup()
    const newGroup = { id: 'new-789', name: 'Epic', icon: 'E', goal: 'Goal' }
    mockCreateGroup.mockResolvedValue(newGroup)

    render(<CreateEpicModal open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText(/Name/), '  Epic  ')
    await user.type(screen.getByLabelText('Goal (optional)'), '  Goal  ')
    await user.click(screen.getByRole('button', { name: 'Create Epic' }))

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith({
        name: 'Epic',
        icon: 'E',
        accent_color: 'var(--fleet-accent)',
        goal: 'Goal'
      })
    })
  })

  it('does not close or submit if createGroup returns null', async () => {
    const user = userEvent.setup()
    mockCreateGroup.mockResolvedValue(null)

    render(<CreateEpicModal open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText(/Name/), 'Failed Epic')
    await user.click(screen.getByRole('button', { name: 'Create Epic' }))

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalled()
    })
    expect(mockSelectGroup).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Cancel button is clicked', async () => {
    const user = userEvent.setup()
    render(<CreateEpicModal open={true} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when overlay is clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(<CreateEpicModal open={true} onClose={onClose} />)
    const overlay = container.querySelector('.prompt-modal__overlay')!
    await user.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Escape key is pressed', () => {
    render(<CreateEpicModal open={true} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('submits form when Cmd+Enter is pressed with valid input', async () => {
    const newGroup = { id: 'new-cmd', name: 'Cmd Epic', icon: 'E', goal: '' }
    mockCreateGroup.mockResolvedValue(newGroup)

    render(<CreateEpicModal open={true} onClose={onClose} />)

    const nameInput = screen.getByLabelText(/Name/)
    fireEvent.change(nameInput, { target: { value: 'Cmd Epic' } })

    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter', metaKey: true })

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith({
        name: 'Cmd Epic',
        icon: 'E',
        accent_color: 'var(--fleet-accent)',
        goal: undefined
      })
    })
  })

  it('does not submit when Cmd+Enter is pressed with empty name', () => {
    render(<CreateEpicModal open={true} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Enter', code: 'Enter', metaKey: true })
    expect(mockCreateGroup).not.toHaveBeenCalled()
  })

  it('shows loading state while submitting', async () => {
    const user = userEvent.setup()
    let resolveCreate: any
    mockCreateGroup.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve
      })
    )

    render(<CreateEpicModal open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText(/Name/), 'Epic')
    await user.click(screen.getByRole('button', { name: 'Create Epic' }))

    // Should show "Creating..." button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Creating...' })).toBeInTheDocument()
    })

    // Buttons should be disabled while submitting
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    // Resolve the promise
    resolveCreate({ id: 'new-loading', name: 'Epic', icon: 'E' })
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('has aria-modal="true" attribute', () => {
    render(<CreateEpicModal open={true} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('resets form when reopened', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CreateEpicModal open={true} onClose={onClose} />)

    await user.type(screen.getByLabelText(/Name/), 'Old Epic')
    await user.type(screen.getByLabelText('Goal (optional)'), 'Old Goal')

    rerender(<CreateEpicModal open={false} onClose={onClose} />)
    rerender(<CreateEpicModal open={true} onClose={onClose} />)

    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement
    const goalInput = screen.getByLabelText('Goal (optional)') as HTMLTextAreaElement
    expect(nameInput.value).toBe('')
    expect(goalInput.value).toBe('')
  })
})
