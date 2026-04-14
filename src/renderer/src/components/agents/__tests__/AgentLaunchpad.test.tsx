import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSpawnAgent = vi.fn().mockResolvedValue({ pid: 1, logPath: '/tmp/log', id: 'agent-1' })
const mockFetchProcesses = vi.fn()
const mockGetRepoPaths = vi.fn().mockResolvedValue({ bde: '/Users/test/projects/BDE' })
const mockLoadTemplates = vi.fn()
const mockTemplates = [
  {
    id: 'builtin-clean-code',
    name: 'Clean Code',
    icon: '🧹',
    accent: 'cyan',
    description: 'Audit',
    questions: [],
    promptTemplate: 'Audit the codebase for clean code issues.',
    order: 0,
    builtIn: true
  }
]

vi.mock('../../../stores/localAgents', () => ({
  useLocalAgentsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      spawnAgent: mockSpawnAgent,
      fetchProcesses: mockFetchProcesses,
      isSpawning: false
    })
  )
}))

vi.mock('../../../stores/promptTemplates', () => ({
  usePromptTemplatesStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      templates: mockTemplates,
      loading: false,
      loadTemplates: mockLoadTemplates
    })
  )
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => [{ label: 'BDE', owner: 'owner', color: '#fff' }]
}))

Object.defineProperty(window, 'api', {
  value: {
    ...(window as unknown as { api: Record<string, unknown> }).api,
    git: {
      ...((window as unknown as { api: { git: Record<string, unknown> } }).api?.git ?? {}),
      getRepoPaths: mockGetRepoPaths
    },
    settings: {
      get: vi.fn(),
      set: vi.fn(),
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn(),
      delete: vi.fn()
    }
  },
  writable: true,
  configurable: true
})

import { AgentLaunchpad } from '../AgentLaunchpad'
import { toast } from '../../../stores/toasts'

describe('AgentLaunchpad', () => {
  const onAgentSpawned = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRepoPaths.mockResolvedValue({ bde: '/Users/test/projects/BDE' })
  })

  it('renders LaunchpadGrid with templates', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    expect(screen.getByTestId('launchpad-grid')).toBeInTheDocument()
    expect(screen.getByText('Clean Code')).toBeInTheDocument()
  })

  it('spawns agent with assistant:true on custom prompt via Enter', async () => {
    const user = userEvent.setup()
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)

    await waitFor(() => expect(mockGetRepoPaths).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('What would you like to work on?')
    await user.type(input, 'Fix the bug{Enter}')

    await waitFor(() => {
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          task: 'Fix the bug',
          assistant: true
        })
      )
    })
    expect(onAgentSpawned).toHaveBeenCalled()
  })

  it('spawns agent with template prompt on tile click (variables stripped via assemblePrompt)', async () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)

    await waitFor(() => expect(mockGetRepoPaths).toHaveBeenCalled())

    await userEvent.click(screen.getByText('Clean Code'))

    await waitFor(() => {
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          task: 'Audit the codebase for clean code issues.',
          assistant: true
        })
      )
    })
  })

  it('shows error toast when repo path not found', async () => {
    mockGetRepoPaths.mockResolvedValue({})
    const user = userEvent.setup()
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)

    await waitFor(() => expect(mockGetRepoPaths).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('What would you like to work on?')
    await user.type(input, 'Do something{Enter}')

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Repo path not found'))
    })
    expect(mockSpawnAgent).not.toHaveBeenCalled()
  })
})
