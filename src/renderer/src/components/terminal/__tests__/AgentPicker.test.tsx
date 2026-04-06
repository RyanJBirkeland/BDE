import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AgentPicker } from '../AgentPicker'

describe('AgentPicker', () => {
  const defaultProps = {
    onSelect: vi.fn(),
    onClose: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially', () => {
    vi.mocked(window.api.agents.list).mockReturnValue(new Promise(() => {})) // never resolves
    render(<AgentPicker {...defaultProps} />)
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
  })

  it('shows empty state when no agents running', async () => {
    vi.mocked(window.api.agents.list).mockResolvedValue([])
    render(<AgentPicker {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('No running agents')).toBeInTheDocument()
    })
  })

  it('renders agent list', async () => {
    vi.mocked(window.api.agents.list).mockResolvedValue([
      {
        id: 'a1',
        pid: 123,
        bin: 'claude',
        model: 'sonnet',
        repo: 'BDE',
        repoPath: '/tmp',
        task: 'Fix bug',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        status: 'running' as const,
        logPath: '/tmp/log',
        source: 'bde' as const,
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      }
    ])
    render(<AgentPicker {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('BDE')).toBeInTheDocument()
      expect(screen.getByText('Fix bug')).toBeInTheDocument()
    })
  })

  it('calls onSelect when agent is clicked', async () => {
    vi.mocked(window.api.agents.list).mockResolvedValue([
      {
        id: 'a1',
        pid: 123,
        bin: 'claude',
        model: 'sonnet',
        repo: 'BDE',
        repoPath: '/tmp',
        task: 'Fix bug',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        status: 'running' as const,
        logPath: '/tmp/log',
        source: 'bde' as const,
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      }
    ])
    render(<AgentPicker {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('BDE')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('BDE').closest('button')!)
    expect(defaultProps.onSelect).toHaveBeenCalledWith('a1', expect.stringContaining('BDE'))
  })

  it('renders the header', () => {
    vi.mocked(window.api.agents.list).mockResolvedValue([])
    render(<AgentPicker {...defaultProps} />)
    expect(screen.getByText('Watch Agent Output')).toBeInTheDocument()
  })

  it('calls onClose on Escape', async () => {
    vi.mocked(window.api.agents.list).mockResolvedValue([])
    render(<AgentPicker {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalled()
  })
})
