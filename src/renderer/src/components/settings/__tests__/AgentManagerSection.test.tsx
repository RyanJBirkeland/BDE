/**
 * AgentManagerSection — config fields and settings load tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

// AgentPermissionsSection adds its own Save button — stub it out so tests
// for AgentManagerSection can use unambiguous getByRole('button') queries.
vi.mock('../AgentPermissionsSection', () => ({
  AgentPermissionsSection: () => null
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(window.api.settings.get).mockResolvedValue(null)
  vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
  vi.mocked(window.api.settings.set).mockResolvedValue(undefined)
  vi.mocked(window.api.settings.setJson).mockResolvedValue(undefined)
})

import { AgentManagerSection } from '../AgentManagerSection'

describe('AgentManagerSection', () => {
  it('renders section heading', () => {
    render(<AgentManagerSection />)
    expect(screen.getByText('Pipeline Configuration')).toBeInTheDocument()
  })

  it('renders config field labels', () => {
    render(<AgentManagerSection />)
    expect(screen.getByText('Max concurrent agents')).toBeInTheDocument()
    expect(screen.getByText('Worktree base')).toBeInTheDocument()
    expect(screen.getByText('Max runtime (minutes)')).toBeInTheDocument()
    expect(screen.getByText('Auto-start')).toBeInTheDocument()
    // The "Default model" field was removed — model routing lives in Settings → Models.
    expect(screen.queryByText('Default model')).not.toBeInTheDocument()
  })

  it('renders hot-reload / restart hint', () => {
    render(<AgentManagerSection />)
    expect(
      screen.getByText(
        /Most fields hot-reload instantly\. Worktree base and Auto-start require a restart\./
      )
    ).toBeInTheDocument()
  })

  it('renders save button (initially disabled)', () => {
    render(<AgentManagerSection />)
    const saveBtn = screen.getByRole('button', { name: /save/i })
    expect(saveBtn).toBeInTheDocument()
    expect(saveBtn).toBeDisabled()
  })

  it('loads settings on mount', async () => {
    vi.mocked(window.api.settings.get).mockImplementation((key: string) => {
      if (key === 'agentManager.worktreeBase') return Promise.resolve('/tmp/worktrees/custom')
      return Promise.resolve(null)
    })
    vi.mocked(window.api.settings.getJson).mockImplementation((key: string) => {
      if (key === 'agentManager.maxConcurrent') return Promise.resolve(4)
      if (key === 'agentManager.maxRuntimeMs') return Promise.resolve(3600000)
      if (key === 'agentManager.autoStart') return Promise.resolve(false)
      return Promise.resolve(null)
    })
    render(<AgentManagerSection />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('/tmp/worktrees/custom')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('4')).toBeInTheDocument()
    expect(screen.getByDisplayValue('60')).toBeInTheDocument()
  })

  it('changing max concurrent enables Save button', async () => {
    const user = userEvent.setup()
    render(<AgentManagerSection />)

    const saveBtn = screen.getByRole('button', { name: /save/i })
    expect(saveBtn).toBeDisabled()

    const maxConcurrentInput = screen.getByDisplayValue('2') as HTMLInputElement
    await user.clear(maxConcurrentInput)
    await user.type(maxConcurrentInput, '4')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
    })
  })

  it('Save calls setJson with correct max concurrent value', async () => {
    const user = userEvent.setup()
    render(<AgentManagerSection />)

    const maxConcurrentInput = screen.getByDisplayValue('2') as HTMLInputElement
    await user.clear(maxConcurrentInput)
    await user.type(maxConcurrentInput, '6')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(window.api.settings.setJson).toHaveBeenCalledWith('agentManager.maxConcurrent', 6)
    })
  })

  it('Save stores max runtime in milliseconds (minutes * 60000)', async () => {
    const user = userEvent.setup()
    render(<AgentManagerSection />)

    // Default is 60 minutes; change to 90 minutes
    const runtimeInput = screen.getByDisplayValue('60') as HTMLInputElement
    await user.clear(runtimeInput)
    await user.type(runtimeInput, '90')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      // 90 minutes * 60_000 ms/minute = 5_400_000 ms
      expect(window.api.settings.setJson).toHaveBeenCalledWith(
        'agentManager.maxRuntimeMs',
        5_400_000
      )
    })
  })

  it('Save with loaded runtime value converts ms back to minutes for display and saves correctly', async () => {
    // 120 minutes = 7_200_000 ms stored in DB
    vi.mocked(window.api.settings.getJson).mockImplementation((key: string) => {
      if (key === 'agentManager.maxRuntimeMs') return Promise.resolve(7_200_000)
      return Promise.resolve(null)
    })

    const user = userEvent.setup()
    render(<AgentManagerSection />)

    // The display should show 120 (converted from 7_200_000 ms)
    await waitFor(() => {
      expect(screen.getByDisplayValue('120')).toBeInTheDocument()
    })

    // Mark dirty by changing worktree base so Save is enabled.
    const worktreeInput = screen.getByPlaceholderText('~/worktrees/bde') as HTMLInputElement
    await user.clear(worktreeInput)
    await user.type(worktreeInput, '/tmp/worktrees/custom')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      // 120 minutes * 60_000 = 7_200_000 ms — round-trip intact
      expect(window.api.settings.setJson).toHaveBeenCalledWith(
        'agentManager.maxRuntimeMs',
        7_200_000
      )
    })
  })
})
