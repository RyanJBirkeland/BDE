import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentDirector } from '../AgentDirector'
import type { AgentSession } from '../../../stores/sessions'

const mockRunTask = vi.fn().mockResolvedValue('new-key')
const mockKillSession = vi.fn().mockResolvedValue(undefined)
const mockInvokeTool = vi.fn().mockResolvedValue(undefined)

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    key: 'test-key',
    sessionId: 'sess-1',
    model: 'sonnet',
    displayName: 'Test Session',
    channel: 'cli',
    lastChannel: 'cli',
    updatedAt: Date.now(),
    totalTokens: 1000,
    contextTokens: 500,
    abortedLastRun: false,
    ...overrides,
  }
}

let mockSessionState = {
  selectedSessionKey: null as string | null,
  sessions: [] as AgentSession[],
  runTask: mockRunTask,
  killSession: mockKillSession,
}

vi.mock('../../../stores/sessions', () => ({
  useSessionsStore: vi.fn((selector: (s: typeof mockSessionState) => unknown) =>
    selector(mockSessionState)
  ),
}))

vi.mock('../../../lib/rpc', () => ({
  invokeTool: (...args: unknown[]) => mockInvokeTool(...args),
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe('AgentDirector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunTask.mockResolvedValue('new-key')
    mockInvokeTool.mockResolvedValue(undefined)
    mockSessionState = {
      selectedSessionKey: null,
      sessions: [],
      runTask: mockRunTask,
      killSession: mockKillSession,
    }
  })

  it('renders Agent Director header', () => {
    render(<AgentDirector />)
    expect(screen.getByText('Agent Director')).toBeInTheDocument()
  })

  it('renders Quick Task section label', () => {
    render(<AgentDirector />)
    expect(screen.getByText('Quick Task')).toBeInTheDocument()
  })

  it('renders task template buttons', () => {
    render(<AgentDirector />)
    expect(screen.getByText('Fix build errors')).toBeInTheDocument()
    expect(screen.getByText('Open PR')).toBeInTheDocument()
    expect(screen.getByText('Review code')).toBeInTheDocument()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
  })

  it('clicking a template button calls runTask', async () => {
    const user = userEvent.setup()
    render(<AgentDirector />)

    await user.click(screen.getByText('Fix build errors'))
    expect(mockRunTask).toHaveBeenCalled()
  })

  it('custom task input calls runTask on submit', async () => {
    const user = userEvent.setup()
    render(<AgentDirector />)

    const input = screen.getByPlaceholderText('Describe a task to run...')
    await user.type(input, 'Deploy app')

    const runBtn = screen.getByRole('button', { name: 'Run' })
    await user.click(runBtn)

    expect(mockRunTask).toHaveBeenCalledWith('Deploy app')
  })

  it('Run button disabled when task input is empty', () => {
    render(<AgentDirector />)
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })

  it('does not show Steer Session when no session selected', () => {
    render(<AgentDirector />)
    expect(screen.queryByText('Steer Session')).not.toBeInTheDocument()
  })

  it('shows Steer Session section when session is selected', () => {
    mockSessionState.selectedSessionKey = 'test-key'
    mockSessionState.sessions = [makeSession()]
    render(<AgentDirector />)
    expect(screen.getByText('Steer Session')).toBeInTheDocument()
  })

  it('renders steering chips when session selected', () => {
    mockSessionState.selectedSessionKey = 'test-key'
    mockSessionState.sessions = [makeSession()]
    render(<AgentDirector />)
    expect(screen.getByText('Stop & summarize')).toBeInTheDocument()
    expect(screen.getByText('Open a PR')).toBeInTheDocument()
    expect(screen.getByText('Keep going')).toBeInTheDocument()
    expect(screen.getByText('Explain last step')).toBeInTheDocument()
  })

  it('clicking a steering chip sends a message', async () => {
    const user = userEvent.setup()
    mockSessionState.selectedSessionKey = 'test-key'
    mockSessionState.sessions = [makeSession()]
    render(<AgentDirector />)

    await user.click(screen.getByText('Keep going'))
    expect(mockInvokeTool).toHaveBeenCalledWith('sessions_send', {
      sessionKey: 'test-key',
      message: 'Keep going',
    })
  })

  it('shows Stop button when session is running', () => {
    mockSessionState.selectedSessionKey = 'test-key'
    mockSessionState.sessions = [makeSession({ updatedAt: Date.now() })]
    render(<AgentDirector />)
    expect(screen.getByTitle('Stop this session')).toBeInTheDocument()
  })
})
