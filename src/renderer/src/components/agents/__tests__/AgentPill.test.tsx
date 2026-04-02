import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentPill } from '../AgentPill'
import type { AgentMeta } from '../../../../../shared/types'

const baseAgent: AgentMeta = {
  id: 'agent-1',
  pid: null,
  bin: 'claude',
  model: 'sonnet',
  task: 'Fix bug in parser',
  status: 'running',
  repo: 'BDE',
  repoPath: '/repo/bde',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  exitCode: null,
  logPath: '/tmp/log',
  source: 'bde',
  costUsd: null,
  tokensIn: null,
  tokensOut: null,
  sprintTaskId: null
}

const defaultProps = {
  agent: baseAgent,
  currentAction: '',
  accent: 'cyan' as const,
  onClick: vi.fn()
}

describe('AgentPill', () => {
  it('renders agent task name', () => {
    render(<AgentPill {...defaultProps} />)
    expect(screen.getByText('Fix bug in parser')).toBeInTheDocument()
  })

  it('applies running class when agent is running', () => {
    const { container } = render(<AgentPill {...defaultProps} />)
    expect(container.querySelector('.agent-pill--running')).toBeInTheDocument()
  })

  it('does not apply running class when agent is not running', () => {
    const { container } = render(
      <AgentPill {...defaultProps} agent={{ ...baseAgent, status: 'done' }} />
    )
    expect(container.querySelector('.agent-pill--running')).not.toBeInTheDocument()
  })

  it('shows current action when provided', () => {
    render(<AgentPill {...defaultProps} currentAction="Reading file.ts" />)
    expect(screen.getByText('Reading file.ts')).toBeInTheDocument()
    expect(screen.getByText('·')).toBeInTheDocument()
  })

  it('does not show action separator when no current action', () => {
    render(<AgentPill {...defaultProps} currentAction="" />)
    expect(screen.queryByText('·')).not.toBeInTheDocument()
  })

  it('truncates long task names', () => {
    const longTask = 'A'.repeat(25)
    render(
      <AgentPill {...defaultProps} agent={{ ...baseAgent, task: longTask }} />
    )
    expect(screen.getByText('A'.repeat(20) + '…')).toBeInTheDocument()
  })

  it('truncates long action text', () => {
    const longAction = 'B'.repeat(35)
    render(<AgentPill {...defaultProps} currentAction={longAction} />)
    expect(screen.getByText('B'.repeat(30) + '…')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<AgentPill {...defaultProps} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalled()
  })

  it('calls onClick on Enter keydown', () => {
    const onClick = vi.fn()
    render(<AgentPill {...defaultProps} onClick={onClick} />)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalled()
  })

  it('calls onClick on Space keydown', () => {
    const onClick = vi.fn()
    render(<AgentPill {...defaultProps} onClick={onClick} />)
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })
    expect(onClick).toHaveBeenCalled()
  })

  it('does not call onClick on other keydown', () => {
    const onClick = vi.fn()
    render(<AgentPill {...defaultProps} onClick={onClick} />)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'a' })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('sets full label as title with action', () => {
    render(<AgentPill {...defaultProps} currentAction="Writing tests" />)
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Fix bug in parser — Writing tests')
  })

  it('sets task name as title without action', () => {
    render(<AgentPill {...defaultProps} currentAction="" />)
    expect(screen.getByRole('button')).toHaveAttribute('title', 'Fix bug in parser')
  })
})
