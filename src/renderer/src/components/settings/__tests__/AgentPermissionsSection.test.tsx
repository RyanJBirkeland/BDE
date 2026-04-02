/**
 * AgentPermissionsSection — consent banner, presets, tool toggles, deny rules, and save tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(window.api.claudeConfig.get).mockResolvedValue({})
  vi.mocked(window.api.claudeConfig.setPermissions).mockResolvedValue(undefined)
})

import { AgentPermissionsSection } from '../AgentPermissionsSection'

describe('AgentPermissionsSection', () => {
  it('shows consent banner when localStorage has no consent', () => {
    render(<AgentPermissionsSection />)
    expect(screen.getByText(/BDE agents need permission/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Accept Recommended/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /I'll Configure Manually/i })
    ).toBeInTheDocument()
  })

  it('hides consent banner after accepting defaults', async () => {
    const user = userEvent.setup()
    render(<AgentPermissionsSection />)

    await user.click(screen.getByRole('button', { name: /Accept Recommended/i }))

    await waitFor(() => {
      expect(screen.queryByText(/BDE agents need permission/)).not.toBeInTheDocument()
    })
    expect(localStorage.getItem('bde-permissions-consent')).toBe('true')
  })

  it('Accept Recommended sets correct allow/deny', async () => {
    const user = userEvent.setup()
    render(<AgentPermissionsSection />)

    await user.click(screen.getByRole('button', { name: /Accept Recommended/i }))

    // Wait for checkboxes to update
    await waitFor(() => {
      const bashCheckbox = screen.getByRole('checkbox', { name: 'Bash' })
      expect(bashCheckbox).toBeChecked()
    })

    const readCheckbox = screen.getByRole('checkbox', { name: 'Read' })
    expect(readCheckbox).toBeChecked()

    // Should show deny rules
    await waitFor(() => {
      expect(screen.getByText('Bash(rm -rf /*)')).toBeInTheDocument()
    })
  })

  it('renders all tool checkboxes', async () => {
    render(<AgentPermissionsSection />)

    const expectedTools = [
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Bash',
      'Agent',
      'WebFetch',
      'WebSearch',
      'NotebookEdit'
    ]

    await waitFor(() => {
      for (const tool of expectedTools) {
        expect(screen.getByRole('checkbox', { name: tool })).toBeInTheDocument()
      }
    })
  })

  it('toggle checkbox updates allow list', async () => {
    vi.mocked(window.api.claudeConfig.get).mockResolvedValue({
      permissions: {
        allow: ['Read', 'Write'],
        deny: []
      }
    })

    const user = userEvent.setup()
    render(<AgentPermissionsSection />)

    // Wait for data to load
    await waitFor(() => {
      const readCheckbox = screen.getByRole('checkbox', { name: 'Read' }) as HTMLInputElement
      expect(readCheckbox.checked).toBe(true)
    })

    // Uncheck Read
    const readCheckbox = screen.getByRole('checkbox', { name: 'Read' })
    await user.click(readCheckbox)

    await waitFor(() => {
      const updated = screen.getByRole('checkbox', { name: 'Read' }) as HTMLInputElement
      expect(updated.checked).toBe(false)
    })

    // Check Bash (was unchecked)
    const bashCheckbox = screen.getByRole('checkbox', { name: 'Bash' })
    await user.click(bashCheckbox)

    await waitFor(() => {
      const updated = screen.getByRole('checkbox', { name: 'Bash' }) as HTMLInputElement
      expect(updated.checked).toBe(true)
    })
  })

  it('apply preset changes allow/deny', async () => {
    const user = userEvent.setup()
    localStorage.setItem('bde-permissions-consent', 'true')
    render(<AgentPermissionsSection />)

    // Apply restrictive preset — only Read, Glob, Grep
    const presetButtons = screen.getAllByRole('button', { name: /Restrictive/i })
    await user.click(presetButtons[0])

    await waitFor(() => {
      const readCheckbox = screen.getByRole('checkbox', { name: 'Read' }) as HTMLInputElement
      expect(readCheckbox.checked).toBe(true)
    })

    const bashCheckbox = screen.getByRole('checkbox', { name: 'Bash' }) as HTMLInputElement
    expect(bashCheckbox.checked).toBe(false)
    const writeCheckbox = screen.getByRole('checkbox', { name: 'Write' }) as HTMLInputElement
    expect(writeCheckbox.checked).toBe(false)
  })

  it('Save button calls setPermissions IPC', async () => {
    vi.mocked(window.api.claudeConfig.get).mockResolvedValue({
      permissions: { allow: ['Read'], deny: [] }
    })

    const user = userEvent.setup()
    localStorage.setItem('bde-permissions-consent', 'true')
    render(<AgentPermissionsSection />)

    // Make dirty by toggling a checkbox
    await waitFor(() => {
      const readCheckbox = screen.getByRole('checkbox', { name: 'Read' }) as HTMLInputElement
      expect(readCheckbox.checked).toBe(true)
    })

    const writeCheckbox = screen.getByRole('checkbox', { name: 'Write' })
    await user.click(writeCheckbox)

    const saveBtn = screen.getByRole('button', { name: /save/i })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(window.api.claudeConfig.setPermissions).toHaveBeenCalledWith(
        expect.objectContaining({
          allow: expect.arrayContaining(['Read', 'Write'])
        })
      )
    })
  })

  it('Save button disabled when not dirty', async () => {
    localStorage.setItem('bde-permissions-consent', 'true')
    render(<AgentPermissionsSection />)

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    })

    const saveBtn = screen.getByRole('button', { name: /save/i })
    expect(saveBtn).toBeDisabled()
  })

  it('Add deny rule via Enter key', async () => {
    const user = userEvent.setup()
    localStorage.setItem('bde-permissions-consent', 'true')
    render(<AgentPermissionsSection />)

    const denyInput = screen.getByRole('textbox', { name: /Add blocked command/i })
    await user.click(denyInput)
    await user.type(denyInput, 'Bash(curl *)')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Bash(curl *)')).toBeInTheDocument()
    })

    // Input should be cleared after adding
    expect(denyInput).toHaveValue('')
  })

  it('Remove deny rule via × button', async () => {
    vi.mocked(window.api.claudeConfig.get).mockResolvedValue({
      permissions: {
        allow: [],
        deny: ['Bash(rm -rf /*)']
      }
    })

    const user = userEvent.setup()
    localStorage.setItem('bde-permissions-consent', 'true')
    render(<AgentPermissionsSection />)

    await waitFor(() => {
      expect(screen.getByText('Bash(rm -rf /*)')).toBeInTheDocument()
    })

    const removeBtn = screen.getByRole('button', { name: /Remove Bash\(rm -rf \/\*\)/i })
    await user.click(removeBtn)

    await waitFor(() => {
      expect(screen.queryByText('Bash(rm -rf /*)')).not.toBeInTheDocument()
    })
  })
})
