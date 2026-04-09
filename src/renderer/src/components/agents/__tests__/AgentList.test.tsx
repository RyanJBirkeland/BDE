import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { groupAgents, AgentList } from '../AgentList'
import type { AgentMeta } from '../../../../../shared/types'

const base: Omit<AgentMeta, 'id' | 'status' | 'startedAt' | 'finishedAt'> = {
  pid: null,
  bin: 'claude',
  model: 'sonnet',
  repo: 'test',
  repoPath: '/tmp/test',
  task: 'do stuff',
  exitCode: null,
  logPath: '/tmp/log',
  source: 'bde',
  costUsd: null,
  tokensIn: null,
  tokensOut: null,
  sprintTaskId: null
}

describe('groupAgents', () => {
  it('groups agents into running, recent, and history', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'running',
        startedAt: new Date(now).toISOString(),
        finishedAt: null
      },
      {
        ...base,
        id: '2',
        status: 'done',
        startedAt: new Date(now - 7200_000).toISOString(),
        finishedAt: new Date(now - 3600_000).toISOString()
      },
      {
        ...base,
        id: '3',
        status: 'done',
        startedAt: new Date(now - 96 * 3600_000).toISOString(),
        finishedAt: new Date(now - 48 * 3600_000).toISOString()
      }
    ]
    const groups = groupAgents(agents)
    expect(groups.running).toHaveLength(1)
    expect(groups.recent).toHaveLength(1)
    expect(groups.history).toHaveLength(1)
  })

  it('returns empty groups for empty input', () => {
    const groups = groupAgents([])
    expect(groups.running).toHaveLength(0)
    expect(groups.recent).toHaveLength(0)
    expect(groups.history).toHaveLength(0)
  })

  it('classifies failed agents as recent or history based on finishedAt', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'failed',
        startedAt: new Date(now - 1000).toISOString(),
        finishedAt: new Date(now - 500).toISOString()
      }
    ]
    const groups = groupAgents(agents)
    expect(groups.running).toHaveLength(0)
    expect(groups.recent).toHaveLength(1)
  })

  it('puts agents without finishedAt in history bucket', () => {
    const agents: AgentMeta[] = [
      { ...base, id: '1', status: 'done', startedAt: new Date(0).toISOString(), finishedAt: null }
    ]
    const groups = groupAgents(agents)
    expect(groups.history).toHaveLength(1)
  })
})

// AgentList renders and interaction tests

function makeAgent(overrides: Partial<AgentMeta> = {}): AgentMeta {
  return {
    ...base,
    id: crypto.randomUUID(),
    status: 'done',
    startedAt: new Date(Date.now() - 3600_000).toISOString(),
    finishedAt: new Date(Date.now() - 1800_000).toISOString(),
    ...overrides
  }
}

// Mock AgentCard to keep tests simple
vi.mock('../AgentCard', () => ({
  AgentCard: ({
    agent,
    selected,
    onClick
  }: {
    agent: AgentMeta
    selected: boolean
    onClick: () => void
  }) => (
    <button data-testid={`agent-card-${agent.id}`} data-selected={selected} onClick={onClick}>
      {agent.task}
    </button>
  )
}))

describe('AgentList', () => {
  const defaultProps = {
    agents: [],
    selectedId: null,
    onSelect: vi.fn()
  }

  it('renders filter input', () => {
    render(<AgentList {...defaultProps} />)
    expect(screen.getByPlaceholderText('Filter agents...')).toBeInTheDocument()
  })

  it('shows no agents message when list is empty', () => {
    render(<AgentList {...defaultProps} />)
    expect(screen.getByText('No agents yet')).toBeInTheDocument()
  })

  it('renders running group header when running agents exist', () => {
    const agents = [makeAgent({ status: 'running', finishedAt: null })]
    render(<AgentList {...defaultProps} agents={agents} />)
    expect(screen.getByText(/Running/)).toBeInTheDocument()
  })

  it('renders recent group header when recent agents exist', () => {
    const agents = [
      makeAgent({ status: 'done', finishedAt: new Date(Date.now() - 3600_000).toISOString() })
    ]
    render(<AgentList {...defaultProps} agents={agents} />)
    expect(screen.getByText(/Recent/)).toBeInTheDocument()
  })

  it('renders history group header when old agents exist', () => {
    const agents = [
      makeAgent({ status: 'done', finishedAt: new Date(Date.now() - 48 * 3600_000).toISOString() })
    ]
    render(<AgentList {...defaultProps} agents={agents} />)
    expect(screen.getByText(/History/)).toBeInTheDocument()
  })

  it('filters agents by task text', async () => {
    const user = userEvent.setup()
    const agents = [
      makeAgent({
        task: 'Fix login bug',
        status: 'done',
        finishedAt: new Date(Date.now() - 3600_000).toISOString()
      }),
      makeAgent({
        task: 'Add dark mode',
        status: 'done',
        finishedAt: new Date(Date.now() - 3600_000).toISOString()
      })
    ]
    render(<AgentList {...defaultProps} agents={agents} />)
    await user.type(screen.getByPlaceholderText('Filter agents...'), 'login')
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
    expect(screen.queryByText('Add dark mode')).not.toBeInTheDocument()
  })

  it('filters agents by repo name', async () => {
    const user = userEvent.setup()
    const agents = [
      makeAgent({
        task: 'Task A',
        repo: 'BDE',
        status: 'done',
        finishedAt: new Date(Date.now() - 3600_000).toISOString()
      }),
      makeAgent({
        task: 'Task B',
        repo: 'feast',
        status: 'done',
        finishedAt: new Date(Date.now() - 3600_000).toISOString()
      })
    ]
    render(<AgentList {...defaultProps} agents={agents} />)
    await user.type(screen.getByPlaceholderText('Filter agents...'), 'feast')
    expect(screen.getByText('Task B')).toBeInTheDocument()
    expect(screen.queryByText('Task A')).not.toBeInTheDocument()
  })

  it('shows no agents found when filter matches nothing', async () => {
    const user = userEvent.setup()
    const agents = [
      makeAgent({
        task: 'Fix bug',
        status: 'done',
        finishedAt: new Date(Date.now() - 3600_000).toISOString()
      })
    ]
    render(<AgentList {...defaultProps} agents={agents} />)
    await user.type(screen.getByPlaceholderText('Filter agents...'), 'xyzzy')
    expect(
      screen.getByText('No agents match your filter. Try adjusting the search or clearing filters.')
    ).toBeInTheDocument()
  })

  it('calls onSelect when an agent card is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const agent = makeAgent({
      id: 'my-agent',
      task: 'Some task',
      status: 'done',
      finishedAt: new Date(Date.now() - 3600_000).toISOString()
    })
    render(<AgentList {...defaultProps} agents={[agent]} onSelect={onSelect} />)
    await user.click(screen.getByText('Some task'))
    expect(onSelect).toHaveBeenCalledWith('my-agent')
  })

  it('history group agents are hidden when collapsed', () => {
    const agent = makeAgent({
      id: 'old-agent',
      task: 'Old task',
      status: 'done',
      finishedAt: new Date(Date.now() - 48 * 3600_000).toISOString()
    })
    render(<AgentList {...defaultProps} agents={[agent]} />)
    // History is collapsed by default
    expect(screen.queryByText('Old task')).not.toBeInTheDocument()
  })

  it('history group expands when header is clicked', async () => {
    const user = userEvent.setup()
    const agent = makeAgent({
      id: 'old-agent',
      task: 'Old task',
      status: 'done',
      finishedAt: new Date(Date.now() - 48 * 3600_000).toISOString()
    })
    render(<AgentList {...defaultProps} agents={[agent]} />)
    // Click the history header to expand
    await user.click(screen.getByText(/History/))
    expect(screen.getByText('Old task')).toBeInTheDocument()
  })

  it('uses initial filter prop to pre-populate search', () => {
    const agents = [
      makeAgent({
        task: 'Fix login',
        status: 'done',
        finishedAt: new Date(Date.now() - 3600_000).toISOString()
      }),
      makeAgent({
        task: 'Add feature',
        status: 'done',
        finishedAt: new Date(Date.now() - 3600_000).toISOString()
      })
    ]
    render(<AgentList {...defaultProps} agents={agents} filter="Fix" />)
    expect(screen.getByDisplayValue('Fix')).toBeInTheDocument()
    expect(screen.getByText('Fix login')).toBeInTheDocument()
    expect(screen.queryByText('Add feature')).not.toBeInTheDocument()
  })

  it('shows count in group headers', () => {
    const agents = [
      makeAgent({ status: 'running', finishedAt: null }),
      makeAgent({ status: 'running', finishedAt: null })
    ]
    render(<AgentList {...defaultProps} agents={agents} />)
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  it('renders 4 skeleton divs when loading and agents is empty', () => {
    const { container } = render(<AgentList {...defaultProps} loading={true} agents={[]} />)
    const skeletons = container.querySelectorAll('.bde-skeleton')
    expect(skeletons).toHaveLength(4)
  })

  it('does not render skeletons when loading is false', () => {
    const { container } = render(<AgentList {...defaultProps} loading={false} agents={[]} />)
    const skeletons = container.querySelectorAll('.bde-skeleton')
    expect(skeletons).toHaveLength(0)
  })

  it('does not render skeletons when loading but agents already exist', () => {
    const agents = [
      makeAgent({ status: 'done', finishedAt: new Date(Date.now() - 3600_000).toISOString() })
    ]
    const { container } = render(<AgentList {...defaultProps} loading={true} agents={agents} />)
    const skeletons = container.querySelectorAll('.bde-skeleton')
    expect(skeletons).toHaveLength(0)
  })
})
