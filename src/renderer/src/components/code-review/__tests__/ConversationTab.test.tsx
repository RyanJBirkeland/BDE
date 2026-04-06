import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { sprintState } = vi.hoisted(() => ({
  sprintState: {
    tasks: [] as Array<Record<string, unknown>>,
    loading: false,
    loadData: vi.fn()
  }
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(sprintState))
}))

const { agentEventsState } = vi.hoisted(() => ({
  agentEventsState: {
    events: {} as Record<string, Array<Record<string, unknown>>>,
    loadHistory: vi.fn()
  }
}))

vi.mock('../../../stores/agentEvents', () => ({
  useAgentEventsStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel(agentEventsState)
  )
}))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: null as string | null
  }))
  return { useCodeReviewStore: store }
})

import { ConversationTab } from '../ConversationTab'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('ConversationTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sprintState.tasks = []
    agentEventsState.events = {}
    agentEventsState.loadHistory.mockClear()
    useCodeReviewStore.setState({ selectedTaskId: null })
  })

  it('shows placeholder when no task selected', () => {
    useCodeReviewStore.setState({ selectedTaskId: null })
    render(<ConversationTab />)
    expect(screen.getByText('No task selected')).toBeInTheDocument()
  })

  it('shows fallback spec/notes when task has no agent_run_id', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: '## Spec Content', notes: 'Some notes', agent_run_id: null }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText('Task Spec')).toBeInTheDocument()
    expect(screen.getByText('Agent Notes')).toBeInTheDocument()
  })

  it('calls loadHistory when task has agent_run_id', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-123' }
    ]
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(agentEventsState.loadHistory).toHaveBeenCalledWith('run-123')
  })

  it('renders agent text events', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {
      'run-1': [{ type: 'agent:text', text: 'I will fix the bug now.', timestamp: 1000 }]
    }
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText('I will fix the bug now.')).toBeInTheDocument()
  })

  it('renders tool call events with tool name and summary', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {
      'run-1': [
        { type: 'agent:tool_call', tool: 'Edit', summary: 'Edited src/main.ts', timestamp: 2000 }
      ]
    }
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Edited src/main.ts')).toBeInTheDocument()
  })

  it('renders error events', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {
      'run-1': [{ type: 'agent:error', message: 'Build failed with exit code 1', timestamp: 3000 }]
    }
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText('Build failed with exit code 1')).toBeInTheDocument()
  })

  it('renders completion event with cost', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {
      'run-1': [
        {
          type: 'agent:completed',
          exitCode: 0,
          costUsd: 0.42,
          tokensIn: 1000,
          tokensOut: 500,
          durationMs: 60000,
          timestamp: 4000
        }
      ]
    }
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ConversationTab />)
    expect(screen.getByText(/\$0\.42/)).toBeInTheDocument()
  })

  it('shows loading state when events are not yet loaded', () => {
    sprintState.tasks = [
      { id: 't1', title: 'Task', spec: null, notes: null, agent_run_id: 'run-1' }
    ]
    agentEventsState.events = {} // no events loaded yet
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    const { container } = render(<ConversationTab />)
    expect(container.querySelectorAll('.bde-skeleton').length).toBeGreaterThan(0)
  })
})
