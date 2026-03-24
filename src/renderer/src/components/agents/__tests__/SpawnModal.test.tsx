import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSpawnAgent = vi.fn().mockResolvedValue({ pid: 1, logPath: '/tmp/log', id: 'agent-1' })
const mockFetchProcesses = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../stores/localAgents', () => ({
  useLocalAgentsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      spawnAgent: mockSpawnAgent,
      fetchProcesses: mockFetchProcesses,
      isSpawning: false,
    })
  ),
}))

vi.mock('../../../stores/ui', () => ({
  useUIStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ setView: vi.fn() })
    ),
    {
      getState: () => ({ setView: vi.fn() }),
    }
  ),
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => [
    { label: 'BDE', owner: 'owner', color: '#fff' },
    { label: 'life-os', owner: 'owner', color: '#fff' },
  ],
}))

import { SpawnModal } from '../SpawnModal'

describe('SpawnModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<SpawnModal open={false} onClose={onClose} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the modal title when open', () => {
    render(<SpawnModal open={true} onClose={onClose} />)
    expect(screen.getByText(/Spawn Agent/i)).toBeInTheDocument()
  })

  it('renders task prompt textarea', () => {
    render(<SpawnModal open={true} onClose={onClose} />)
    expect(screen.getByPlaceholderText(/Describe the task/i)).toBeInTheDocument()
  })

  it('renders repository selector with options', () => {
    render(<SpawnModal open={true} onClose={onClose} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    expect(screen.getByText(/BDE/)).toBeInTheDocument()
  })

  it('renders model chips', () => {
    render(<SpawnModal open={true} onClose={onClose} />)
    // CLAUDE_MODELS should include sonnet-like buttons
    const chips = document.querySelectorAll('.spawn-modal__chip')
    expect(chips.length).toBeGreaterThan(0)
  })

  it('renders Cancel and Spawn buttons', () => {
    render(<SpawnModal open={true} onClose={onClose} />)
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Spawn|Loading/i })).toBeInTheDocument()
  })

  it('Spawn button is disabled when task is empty', () => {
    render(<SpawnModal open={true} onClose={onClose} />)
    // Button is disabled when no task text, or loading repos
    const spawnBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
    expect(spawnBtn).not.toBeNull()
    expect(spawnBtn.disabled).toBe(true)
  })

  it('calls onClose when Cancel is clicked', () => {
    render(<SpawnModal open={true} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', () => {
    render(<SpawnModal open={true} onClose={onClose} />)
    const overlay = document.querySelector('.spawn-modal__overlay')!
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalled()
  })

  it('updates task text on input', async () => {
    const user = userEvent.setup()
    render(<SpawnModal open={true} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText(/Describe the task/i)
    await user.type(textarea, 'Fix the bug')
    expect(textarea).toHaveValue('Fix the bug')
  })

  it('shows character count', async () => {
    const user = userEvent.setup()
    render(<SpawnModal open={true} onClose={onClose} />)
    const textarea = screen.getByPlaceholderText(/Describe the task/i)
    await user.type(textarea, 'Hello')
    // Should show count/limit
    expect(screen.getByText(/5\s*\/\s*2000/)).toBeInTheDocument()
  })

  it('shows repo load error when getRepoPaths fails', async () => {
    // Override the api mock for this test
    const origGetRepoPaths = window.api.getRepoPaths
    vi.mocked(window.api.getRepoPaths).mockRejectedValueOnce(new Error('Network error'))

    render(<SpawnModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument()
    })

    window.api.getRepoPaths = origGetRepoPaths
  })

  it('submits the form and calls spawnAgent', async () => {
    const user = userEvent.setup()
    render(<SpawnModal open={true} onClose={onClose} />)

    const textarea = screen.getByPlaceholderText(/Describe the task/i)
    await user.type(textarea, 'Fix the login bug')

    await waitFor(() => {
      const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
      expect(submitBtn.disabled).toBe(false)
    })

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'Fix the login bug' })
      )
    })
  })

  it('calls onClose after successful spawn', async () => {
    const user = userEvent.setup()
    render(<SpawnModal open={true} onClose={onClose} />)

    const textarea = screen.getByPlaceholderText(/Describe the task/i)
    await user.type(textarea, 'Fix the login bug')

    await waitFor(() => {
      const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
      expect(submitBtn.disabled).toBe(false)
    })

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('shows error toast when spawn fails with generic error', async () => {
    const { toast } = await import('../../../stores/toasts')
    mockSpawnAgent.mockRejectedValueOnce(new Error('spawn process failed'))

    const user = userEvent.setup()
    render(<SpawnModal open={true} onClose={onClose} />)

    const textarea = screen.getByPlaceholderText(/Describe the task/i)
    await user.type(textarea, 'Fix the login bug')

    await waitFor(() => {
      const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement
      expect(submitBtn.disabled).toBe(false)
    })

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('spawn process failed'))
    })
  })

  it('closes history dropdown on Escape when shown', async () => {
    // Pre-load history
    localStorage.setItem('bde-spawn-history', JSON.stringify(['old task 1', 'old task 2']))

    render(<SpawnModal open={true} onClose={onClose} />)

    // Focus textarea to show history
    const textarea = screen.getByPlaceholderText(/Describe the task/i)
    fireEvent.focus(textarea)

    await waitFor(() => {
      expect(screen.getByText('old task 1')).toBeInTheDocument()
    })

    // Escape should close history (not the modal)
    fireEvent.keyDown(window, { key: 'Escape', bubbles: true, cancelable: true })

    await waitFor(() => {
      expect(screen.queryByText('old task 1')).not.toBeInTheDocument()
    })

    // onClose should NOT have been called (just history closed)
    expect(onClose).not.toHaveBeenCalled()

    localStorage.removeItem('bde-spawn-history')
  })

  it('selects history item on click', async () => {
    localStorage.setItem('bde-spawn-history', JSON.stringify(['historical task']))

    render(<SpawnModal open={true} onClose={onClose} />)

    const textarea = screen.getByPlaceholderText(/Describe the task/i)
    fireEvent.focus(textarea)

    await waitFor(() => {
      expect(screen.getByText('historical task')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('historical task'))

    expect(textarea).toHaveValue('historical task')

    localStorage.removeItem('bde-spawn-history')
  })

  it('model selection updates active chip', async () => {
    render(<SpawnModal open={true} onClose={onClose} />)

    const chips = document.querySelectorAll('.spawn-modal__chip')
    // Click the second chip
    if (chips.length > 1) {
      fireEvent.click(chips[1])
      expect(chips[1]).toHaveClass('spawn-modal__chip--active')
    }
  })
})
