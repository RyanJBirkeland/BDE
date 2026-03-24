/**
 * AgentManagerSection — config fields and settings load tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(window.api.settings.get).mockResolvedValue(null)
  vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
})

import { AgentManagerSection } from '../AgentManagerSection'

describe('AgentManagerSection', () => {
  it('renders section heading', () => {
    render(<AgentManagerSection />)
    expect(screen.getByText('Agent Manager')).toBeInTheDocument()
  })

  it('renders config field labels', () => {
    render(<AgentManagerSection />)
    expect(screen.getByText('Max concurrent agents')).toBeInTheDocument()
    expect(screen.getByText('Default model')).toBeInTheDocument()
    expect(screen.getByText('Worktree base')).toBeInTheDocument()
    expect(screen.getByText('Max runtime (minutes)')).toBeInTheDocument()
    expect(screen.getByText('Auto-start')).toBeInTheDocument()
  })

  it('renders restart hint', () => {
    render(<AgentManagerSection />)
    expect(screen.getByText(/Changes require app restart/)).toBeInTheDocument()
  })

  it('renders save button (initially disabled)', () => {
    render(<AgentManagerSection />)
    const saveBtn = screen.getByRole('button', { name: /save/i })
    expect(saveBtn).toBeInTheDocument()
    expect(saveBtn).toBeDisabled()
  })

  it('loads settings on mount', async () => {
    vi.mocked(window.api.settings.get).mockImplementation((key: string) => {
      if (key === 'agentManager.defaultModel') return Promise.resolve('claude-opus-4')
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
      const inputs = screen.getAllByDisplayValue('claude-opus-4') as HTMLInputElement[]
      expect(inputs.length).toBeGreaterThanOrEqual(1)
      expect(inputs[0].placeholder).toBe('claude-sonnet-4-5')
    })
  })
})
