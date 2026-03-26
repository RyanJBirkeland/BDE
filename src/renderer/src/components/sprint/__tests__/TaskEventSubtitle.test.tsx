import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskEventSubtitle } from '../TaskEventSubtitle'
import type { TaskOutputEvent } from '../../../../../shared/queue-api-contract'

function makeEvent(overrides: Record<string, unknown>): TaskOutputEvent {
  return {
    taskId: 'task-1',
    timestamp: '2026-03-19T10:00:00Z',
    type: 'agent:started',
    ...overrides
  } as TaskOutputEvent
}

describe('TaskEventSubtitle', () => {
  it('renders nothing when event is null', () => {
    const { container } = render(<TaskEventSubtitle event={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders agent:started with model name', () => {
    const event = makeEvent({ type: 'agent:started', model: 'sonnet' })
    render(<TaskEventSubtitle event={event} />)
    expect(screen.getByText('Agent started (sonnet)')).toBeInTheDocument()
  })

  it('renders agent:tool_call with summary', () => {
    const event = makeEvent({
      type: 'agent:tool_call',
      tool: 'edit',
      summary: 'Editing src/main/db.ts'
    })
    render(<TaskEventSubtitle event={event} />)
    expect(screen.getByText('Editing src/main/db.ts')).toBeInTheDocument()
  })

  it('renders agent:tool_result with summary', () => {
    const event = makeEvent({
      type: 'agent:tool_result',
      tool: 'edit',
      success: true,
      summary: 'File written (42 lines)'
    })
    render(<TaskEventSubtitle event={event} />)
    expect(screen.getByText('File written (42 lines)')).toBeInTheDocument()
  })

  it('renders agent:thinking with token count', () => {
    const event = makeEvent({ type: 'agent:thinking', tokenCount: 1500 })
    render(<TaskEventSubtitle event={event} />)
    expect(screen.getByText('1500 tokens')).toBeInTheDocument()
  })

  it('renders agent:rate_limited', () => {
    const event = makeEvent({ type: 'agent:rate_limited', retryDelayMs: 5000, attempt: 2 })
    render(<TaskEventSubtitle event={event} />)
    expect(screen.getByText('Rate limited, retrying...')).toBeInTheDocument()
  })

  it('renders agent:error with message', () => {
    const event = makeEvent({ type: 'agent:error', message: 'Something broke' })
    render(<TaskEventSubtitle event={event} />)
    expect(screen.getByText('Something broke')).toBeInTheDocument()
  })

  it('renders agent:completed with exit code', () => {
    const event = makeEvent({
      type: 'agent:completed',
      exitCode: 0,
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      durationMs: 5000
    })
    render(<TaskEventSubtitle event={event} />)
    expect(screen.getByText('Completed (exit 0)')).toBeInTheDocument()
  })

  it('renders unknown event type as text', () => {
    const event = makeEvent({ type: 'agent:future_type' })
    render(<TaskEventSubtitle event={event} />)
    expect(screen.getByText('agent:future_type')).toBeInTheDocument()
  })
})
