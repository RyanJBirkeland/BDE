import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MorningBriefing } from '../MorningBriefing'
import type { SprintTask, AgentCostRecord } from '../../../../../shared/types'

const makeTask = (id: string, overrides: Partial<SprintTask> = {}): SprintTask => ({
  id,
  title: `Task ${id}`,
  repo: 'bde',
  prompt: null,
  priority: 1,
  status: 'done',
  notes: null,
  spec: null,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_mergeable_state: null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  ...overrides
})

describe('MorningBriefing', () => {
  const defaultProps = {
    tasks: [makeTask('t1'), makeTask('t2')],
    localAgents: [] as AgentCostRecord[],
    onReviewAll: vi.fn(),
    onDismiss: vi.fn()
  }

  it('renders completed task count', () => {
    render(<MorningBriefing {...defaultProps} />)
    expect(screen.getByText('2 tasks completed since last session')).toBeInTheDocument()
  })

  it('uses singular for 1 task', () => {
    render(<MorningBriefing {...defaultProps} tasks={[makeTask('t1')]} />)
    expect(screen.getByText('1 task completed since last session')).toBeInTheDocument()
  })

  it('renders Review All button', () => {
    render(<MorningBriefing {...defaultProps} />)
    fireEvent.click(screen.getByText('Review All'))
    expect(defaultProps.onReviewAll).toHaveBeenCalled()
  })

  it('renders Dismiss button', () => {
    render(<MorningBriefing {...defaultProps} />)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(defaultProps.onDismiss).toHaveBeenCalled()
  })

  it('shows task titles', () => {
    render(<MorningBriefing {...defaultProps} />)
    expect(screen.getByText('Task t1')).toBeInTheDocument()
    expect(screen.getByText('Task t2')).toBeInTheDocument()
  })

  it('shows cost when agent data is available', () => {
    const agents = [
      { id: 'a1', sprintTaskId: 't1', costUsd: 0.5 } as AgentCostRecord
    ]
    render(<MorningBriefing {...defaultProps} localAgents={agents} />)
    expect(screen.getAllByText('$0.500').length).toBeGreaterThan(0)
  })
})
