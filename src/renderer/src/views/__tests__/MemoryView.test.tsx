import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MemoryView from '../MemoryView'

// jsdom stub
Element.prototype.scrollIntoView = vi.fn()

vi.mock('../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeView: 'memory', setView: vi.fn() })
  )
}))

vi.mock('../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
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
      { path: 'MEMORY.md', name: 'MEMORY.md', size: 200, modifiedAt: Date.now() }
    ])
    render(<MemoryView />)
    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument()
      expect(screen.getByText('MEMORY.md')).toBeInTheDocument()
    })
  })

  it('loads file content on selection', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() }
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
      const textarea = document.querySelector('textarea')! as HTMLTextAreaElement
      expect(textarea.value).toBe('Hello, world!')
    })
  })

  it('tracks dirty state on edit', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() }
    ])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('Initial content')

    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument()
    })

    await user.click(screen.getByText('notes.md'))

    await waitFor(() => {
      expect(document.querySelector('textarea')!).toBeInTheDocument()
    })

    // Before editing, Save button is disabled
    const saveButton = screen.getByRole('button', { name: 'Save' })
    expect(saveButton).toBeDisabled()

    // Edit the textarea — triggers dirty state
    const textarea = document.querySelector('textarea')!
    await user.clear(textarea)
    await user.type(textarea, 'Changed content')

    // Save button should now be enabled (dirty)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    })
  })

  it('shows "Select a file to view" when no file is selected', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() }
    ])
    render(<MemoryView />)
    await waitFor(() => {
      expect(screen.getByText('Select a file to view')).toBeInTheDocument()
    })
  })

  it('groups date-named files under Daily Logs', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: '2024-01-15.md', name: '2024-01-15.md', size: 50, modifiedAt: Date.now() }
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

  it('create new file: type filename → Enter → writeMemoryFile called with empty content', async () => {
    vi.mocked(window.api.listMemoryFiles)
      .mockResolvedValueOnce([]) // initial load
      .mockResolvedValue([
        { path: 'new-note.md', name: 'new-note.md', size: 0, modifiedAt: Date.now() }
      ]) // after reload
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('')

    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByTitle('New file')).toBeInTheDocument()
    })

    await user.click(screen.getByTitle('New file'))
    const input = screen.getByPlaceholderText('filename.md')
    await user.type(input, 'new-note.md')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(window.api.writeMemoryFile).toHaveBeenCalledWith('new-note.md', '')
    })
  })

  it('create new file: auto-appends .md extension if omitted', async () => {
    vi.mocked(window.api.listMemoryFiles)
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { path: 'my-note.md', name: 'my-note.md', size: 0, modifiedAt: Date.now() }
      ])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('')

    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByTitle('New file')).toBeInTheDocument()
    })

    await user.click(screen.getByTitle('New file'))
    await user.type(screen.getByPlaceholderText('filename.md'), 'my-note')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(window.api.writeMemoryFile).toHaveBeenCalledWith('my-note.md', '')
    })
  })

  it('save edited file: select → edit → Save → writeMemoryFile called with path + new content', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() }
    ])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('Original content')

    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument()
    })
    await user.click(screen.getByText('notes.md'))

    await waitFor(() => {
      expect(document.querySelector('textarea')!).toBeInTheDocument()
    })

    const textarea = document.querySelector('textarea')! as HTMLTextAreaElement
    await user.clear(textarea)
    await user.type(textarea, 'Updated content')

    const saveButton = screen.getByRole('button', { name: 'Save' })
    await user.click(saveButton)

    await waitFor(() => {
      expect(window.api.writeMemoryFile).toHaveBeenCalledWith('notes.md', 'Updated content')
    })
  })

  it('discard changes reverts content to original', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() }
    ])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('Original content')

    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument()
    })
    await user.click(screen.getByText('notes.md'))

    await waitFor(() => {
      expect((document.querySelector('textarea')! as HTMLTextAreaElement).value).toBe(
        'Original content'
      )
    })

    const textarea = document.querySelector('textarea')! as HTMLTextAreaElement
    await user.clear(textarea)
    await user.type(textarea, 'Edited content')

    await waitFor(() => {
      expect((document.querySelector('textarea')! as HTMLTextAreaElement).value).toBe(
        'Edited content'
      )
    })

    const discardButton = screen.getByRole('button', { name: 'Discard' })
    await user.click(discardButton)

    await waitFor(() => {
      expect((document.querySelector('textarea')! as HTMLTextAreaElement).value).toBe(
        'Original content'
      )
    })
  })

  it('Cmd+S keyboard shortcut saves the file', async () => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'notes.md', name: 'notes.md', size: 100, modifiedAt: Date.now() }
    ])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('Initial')

    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument()
    })
    await user.click(screen.getByText('notes.md'))

    await waitFor(() => {
      expect(document.querySelector('textarea')!).toBeInTheDocument()
    })

    const textarea = document.querySelector('textarea')!
    await user.clear(textarea)
    await user.type(textarea, 'Saved via shortcut')

    // Trigger Cmd+S (metaKey + s)
    await user.keyboard('{Meta>}s{/Meta}')

    await waitFor(() => {
      expect(window.api.writeMemoryFile).toHaveBeenCalledWith('notes.md', 'Saved via shortcut')
    })
  })
})
