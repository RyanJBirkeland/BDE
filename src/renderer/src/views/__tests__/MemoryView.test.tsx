import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MemoryView from '../MemoryView'

// jsdom stub
Element.prototype.scrollIntoView = vi.fn()

vi.mock('../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeView: 'memory', setView: vi.fn() })
  ),
}))

vi.mock('../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe('MemoryView', () => {
  beforeEach(() => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('')
    vi.mocked(window.api.writeMemoryFile).mockResolvedValue(undefined)
  })

  it('renders the Files header', async () => {
    render(<MemoryView />)
    await waitFor(() => {
      expect(screen.getByText('Files')).toBeInTheDocument()
    })
  })

  it('shows empty state when no files', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([])
    render(<MemoryView />)
    await waitFor(() => {
      expect(screen.getByText('No memory files')).toBeInTheDocument()
    })
  })

  it('renders file list when files are returned', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() },
      { path: 'MEMORY.md', name: 'MEMORY.md', size: 200, modifiedAt: Date.now() },
    ])
    render(<MemoryView />)
    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument()
      expect(screen.getByText('MEMORY.md')).toBeInTheDocument()
    })
  })

  it('loads file content on selection', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() },
    ])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('Hello, world!')

    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument()
    })

    await user.click(screen.getByText('notes.md'))

    await waitFor(() => {
      expect(window.api.readMemoryFile).toHaveBeenCalledWith('notes.md')
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(textarea.value).toBe('Hello, world!')
    })
  })

  it('tracks dirty state on edit', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() },
    ])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('Initial content')

    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument()
    })

    await user.click(screen.getByText('notes.md'))

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    // Before editing, Save button is disabled
    const saveButton = screen.getByRole('button', { name: 'Save' })
    expect(saveButton).toBeDisabled()

    // Edit the textarea — triggers dirty state
    const textarea = screen.getByRole('textbox')
    await user.clear(textarea)
    await user.type(textarea, 'Changed content')

    // Save button should now be enabled (dirty)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    })
  })

  it('shows "Select a file to view" when no file is selected', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() },
    ])
    render(<MemoryView />)
    await waitFor(() => {
      expect(screen.getByText('Select a file to view')).toBeInTheDocument()
    })
  })

  it('groups date-named files under Daily Logs', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: '2024-01-15.md', name: '2024-01-15.md', size: 50, modifiedAt: Date.now() },
    ])
    render(<MemoryView />)
    await waitFor(() => {
      expect(screen.getByText('Daily Logs')).toBeInTheDocument()
      expect(screen.getByText('2024-01-15.md')).toBeInTheDocument()
    })
  })

  it('shows new file input when + button is clicked', async () => {
    const user = userEvent.setup()
    render(<MemoryView />)
    await waitFor(() => {
      expect(screen.getByTitle('New file')).toBeInTheDocument()
    })
    await user.click(screen.getByTitle('New file'))
    expect(screen.getByPlaceholderText('filename.md')).toBeInTheDocument()
  })
})
