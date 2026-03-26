import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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
    questions: [
      { id: 'scope', label: 'Pick scope', type: 'choice', choices: ['All', 'Some'] },
    ],
    promptTemplate: 'Audit {{scope}}',
    order: 0,
    builtIn: true,
  },
]

vi.mock('../../../stores/localAgents', () => ({
  useLocalAgentsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      spawnAgent: mockSpawnAgent,
      fetchProcesses: mockFetchProcesses,
      isSpawning: false,
    }),
  ),
}))

vi.mock('../../../stores/promptTemplates', () => ({
  usePromptTemplatesStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      templates: mockTemplates,
      loading: false,
      loadTemplates: mockLoadTemplates,
    }),
  ),
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => [
    { label: 'BDE', owner: 'owner', color: '#fff' },
  ],
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
      delete: vi.fn(),
    },
  },
  writable: true,
  configurable: true,
})

import { AgentLaunchpad } from '../AgentLaunchpad'

describe('AgentLaunchpad', () => {
  const onAgentSpawned = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('renders the grid phase by default', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    expect(screen.getByTestId('launchpad-grid')).toBeInTheDocument()
  })

  it('transitions to configure phase when a tile is clicked', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    fireEvent.click(screen.getByText('Clean Code'))
    expect(screen.getByTestId('launchpad-configure')).toBeInTheDocument()
  })

  it('transitions to review phase when configure completes', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    // Click tile to enter configure
    fireEvent.click(screen.getByText('Clean Code'))
    // Answer the question
    fireEvent.click(screen.getByText('All'))
    // Should be on review now
    expect(screen.getByTestId('launchpad-review')).toBeInTheDocument()
  })

  it('spawns agent from review and calls onAgentSpawned', async () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)

    // Wait for repoPaths to load
    await waitFor(() => expect(mockGetRepoPaths).toHaveBeenCalled())

    fireEvent.click(screen.getByText('Clean Code'))
    fireEvent.click(screen.getByText('All'))

    // Now on review — click spawn
    fireEvent.click(screen.getByText(/Spawn/i))

    await waitFor(() => {
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({ task: expect.stringContaining('Audit All') }),
      )
    })
  })

  it('returns to grid when back is clicked from configure', () => {
    render(<AgentLaunchpad onAgentSpawned={onAgentSpawned} />)
    fireEvent.click(screen.getByText('Clean Code'))
    fireEvent.click(screen.getByTitle(/back/i))
    expect(screen.getByTestId('launchpad-grid')).toBeInTheDocument()
  })
})
