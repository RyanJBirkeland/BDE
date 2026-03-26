/**
 * Tests for the unsaved-changes guard in MemoryView.
 * Verifies that switching files when dirty shows a confirmation dialog.
 */
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

describe('MemoryView — unsaved changes guard', () => {
  beforeEach(() => {
    vi.mocked(window.api.listMemoryFiles).mockResolvedValue([
      { path: 'file-a.md', name: 'file-a.md', size: 100, modifiedAt: Date.now() },
      { path: 'file-b.md', name: 'file-b.md', size: 100, modifiedAt: Date.now() }
    ])
    vi.mocked(window.api.readMemoryFile).mockResolvedValue('Original content')
    vi.mocked(window.api.writeMemoryFile).mockResolvedValue(undefined)
  })

  it('switches files directly when content is clean (no confirm dialog)', async () => {
    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('file-a.md')).toBeInTheDocument()
    })

    // Select file-a (no dirty state)
    await user.click(screen.getByText('file-a.md'))
    await waitFor(() => {
      expect(window.api.readMemoryFile).toHaveBeenCalledWith('file-a.md')
    })

    // Now select file-b — content is clean, no confirm dialog
    await user.click(screen.getByText('file-b.md'))
    await waitFor(() => {
      expect(window.api.readMemoryFile).toHaveBeenCalledWith('file-b.md')
    })

    // No confirm dialog should appear
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows confirm dialog when switching files with dirty content', async () => {
    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('file-a.md')).toBeInTheDocument()
    })

    // Open file-a
    await user.click(screen.getByText('file-a.md'))
    await waitFor(() => {
      expect(document.querySelector('textarea')!).toBeInTheDocument()
    })

    // Edit the content to make it dirty
    const textarea = document.querySelector('textarea')!
    await user.clear(textarea)
    await user.type(textarea, 'Modified content')

    // Now try to switch to file-b
    await user.click(screen.getByText('file-b.md'))

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/unsaved changes/i)
  })

  it('cancels file switch when user clicks Cancel in confirm dialog', async () => {
    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('file-a.md')).toBeInTheDocument()
    })

    await user.click(screen.getByText('file-a.md'))
    await waitFor(() => {
      expect(document.querySelector('textarea')!).toBeInTheDocument()
    })

    const textarea = document.querySelector('textarea')!
    await user.clear(textarea)
    await user.type(textarea, 'Edited')

    const callCountBefore = vi.mocked(window.api.readMemoryFile).mock.calls.length

    await user.click(screen.getByText('file-b.md'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    // Click Cancel
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    // readMemoryFile should NOT have been called for file-b
    expect(vi.mocked(window.api.readMemoryFile).mock.calls.length).toBe(callCountBefore)
    // Dialog should be gone
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('proceeds with file switch when user confirms in dialog', async () => {
    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('file-a.md')).toBeInTheDocument()
    })

    await user.click(screen.getByText('file-a.md'))
    await waitFor(() => {
      expect(document.querySelector('textarea')!).toBeInTheDocument()
    })

    const textarea = document.querySelector('textarea')!
    await user.clear(textarea)
    await user.type(textarea, 'Edited')

    await user.click(screen.getByText('file-b.md'))
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    // Click confirm — use exact label from the modal
    await user.click(screen.getByRole('button', { name: 'Discard & switch' }))

    // file-b should now be loaded
    await waitFor(() => {
      expect(window.api.readMemoryFile).toHaveBeenCalledWith('file-b.md')
    })
  })

  it('registers beforeunload listener when content is dirty', async () => {
    const addEventSpy = vi.spyOn(window, 'addEventListener')
    const user = userEvent.setup()
    render(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('file-a.md')).toBeInTheDocument()
    })

    await user.click(screen.getByText('file-a.md'))
    await waitFor(() => {
      expect(document.querySelector('textarea')!).toBeInTheDocument()
    })

    const textarea = document.querySelector('textarea')!
    await user.clear(textarea)
    await user.type(textarea, 'Dirty')

    await waitFor(() => {
      const calls = addEventSpy.mock.calls.map((c) => c[0])
      expect(calls).toContain('beforeunload')
    })

    addEventSpy.mockRestore()
  })
})
