import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

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
    questions: [{ id: 'scope', label: 'Pick scope', type: 'choice', choices: ['All', 'Some'] }],
    promptTemplate: 'Audit {{scope}}',
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
    getRepoPaths: mockGetRepoPaths,
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

describe('AgentLaunchpad', () => {
  const onAgentSpawned = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders the launchpad grid', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    expect(screen.getByTestId('launchpad-grid')).toBeInTheDocument()
  })

  it('loads templates on mount', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    expect(mockLoadTemplates).toHaveBeenCalled()
  })

  it('loads repo paths on mount', async () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    await waitFor(() => expect(mockGetRepoPaths).toHaveBeenCalled())
  })

  it('renders template tiles', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    expect(screen.getByText('Clean Code')).toBeInTheDocument()
  })
})
