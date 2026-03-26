import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EventCard } from '../EventCard'
import type {
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentCompletedEvent,
  AgentStartedEvent,
  AgentErrorEvent
} from '../../../../../shared/queue-api-contract'

describe('EventCard', () => {
  it('renders a tool_call card with tool badge and summary', () => {
    const event: AgentToolCallEvent = {
      taskId: 'task-1',
      timestamp: '2026-03-19T10:00:00Z',
      type: 'agent:tool_call',
      tool: 'bash',
      summary: 'Running npm test'
    }
    render(<EventCard event={event} />)
    expect(screen.getByText('bash')).toBeInTheDocument()
    expect(screen.getByText('Running npm test')).toBeInTheDocument()
    expect(screen.getByTestId('event-card-tool_call')).toBeInTheDocument()
  })

  it('renders a successful tool_result card with success badge', () => {
    const event: AgentToolResultEvent = {
      taskId: 'task-1',
      timestamp: '2026-03-19T10:00:01Z',
      type: 'agent:tool_result',
      tool: 'edit',
      success: true,
      summary: 'File written (42 lines)'
    }
    render(<EventCard event={event} />)
    expect(screen.getByText('success')).toBeInTheDocument()
    expect(screen.getByText('File written (42 lines)')).toBeInTheDocument()
    expect(screen.getByTestId('event-card-tool_result')).toBeInTheDocument()
  })

  it('renders a failed tool_result card with failed badge', () => {
    const event: AgentToolResultEvent = {
      taskId: 'task-1',
      timestamp: '2026-03-19T10:00:01Z',
      type: 'agent:tool_result',
      tool: 'bash',
      success: false,
      summary: 'Command failed (exit 1)'
    }
    render(<EventCard event={event} />)
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('Command failed (exit 1)')).toBeInTheDocument()
  })

  it('renders a completed card with exit code and stats', () => {
    const event: AgentCompletedEvent = {
      taskId: 'task-1',
      timestamp: '2026-03-19T10:05:00Z',
      type: 'agent:completed',
      exitCode: 0,
      costUsd: 0.0342,
      tokensIn: 15000,
      tokensOut: 3200,
      durationMs: 120000
    }
    render(<EventCard event={event} />)
    expect(screen.getByText('Completed (exit 0)')).toBeInTheDocument()
    expect(screen.getByText('Duration: 2m 0s')).toBeInTheDocument()
    expect(screen.getByText('Cost: $0.0342')).toBeInTheDocument()
    expect(screen.getByText('In: 15,000')).toBeInTheDocument()
    expect(screen.getByText('Out: 3,200')).toBeInTheDocument()
    expect(screen.getByTestId('event-card-completed')).toBeInTheDocument()
  })

  it('renders a started card with model name', () => {
    const event: AgentStartedEvent = {
      taskId: 'task-1',
      timestamp: '2026-03-19T10:00:00Z',
      type: 'agent:started',
      model: 'opus'
    }
    render(<EventCard event={event} />)
    expect(screen.getByText('Agent started')).toBeInTheDocument()
    expect(screen.getByText('opus')).toBeInTheDocument()
    expect(screen.getByTestId('event-card-started')).toBeInTheDocument()
  })

  it('renders an error card with message', () => {
    const event: AgentErrorEvent = {
      taskId: 'task-1',
      timestamp: '2026-03-19T10:00:00Z',
      type: 'agent:error',
      message: 'API key expired'
    }
    render(<EventCard event={event} />)
    expect(screen.getByText('API key expired')).toBeInTheDocument()
    expect(screen.getByTestId('event-card-error')).toBeInTheDocument()
  })

  it('renders unknown event types gracefully', () => {
    const event = {
      taskId: 'task-1',
      timestamp: '2026-03-19T10:00:00Z',
      type: 'agent:custom_future_type'
    }
    render(<EventCard event={event} />)
    expect(screen.getByText('agent:custom_future_type')).toBeInTheDocument()
    expect(screen.getByTestId('event-card-unknown')).toBeInTheDocument()
  })
})
