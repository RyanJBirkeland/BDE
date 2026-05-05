import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Hoisted state containers so each test can mutate them before rendering.
const { sprintState, reviewState, agentState } = vi.hoisted(() => ({
  sprintState: {
    tasks: [] as Array<Record<string, unknown>>
  },
  reviewState: {
    selectedTaskId: 'task-1' as string | null
  },
  agentState: {
    events: {} as Record<string, unknown[]>,
    loadHistory: vi.fn()
  }
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: typeof sprintState) => unknown) => sel(sprintState))
}))

vi.mock('../../../stores/codeReview', () => ({
  useCodeReviewStore: vi.fn((sel: (s: typeof reviewState) => unknown) => sel(reviewState))
}))

vi.mock('../../../stores/agentEvents', () => ({
  useAgentEventsStore: vi.fn((sel: (s: typeof agentState) => unknown) => sel(agentState))
}))

import { VerificationTab } from '../VerificationTab'

function setup(taskOverrides: Record<string, unknown> = {}): void {
  reviewState.selectedTaskId = 'task-1'
  sprintState.tasks = [{ id: 'task-1', agent_run_id: 'run-1', ...taskOverrides }]
  agentState.events = {}
  agentState.loadHistory = vi.fn()
}

describe('VerificationTab — FLEET Verified section', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows empty state when verification_results is null', () => {
    setup({ verification_results: null })
    render(<VerificationTab />)
    expect(screen.getByText(/no fleet verification record/i)).toBeInTheDocument()
  })

  it('renders typecheck passed row', () => {
    setup({
      verification_results: {
        typecheck: {
          exitCode: 0,
          stdout: 'tsc ok',
          stderr: '',
          truncated: false,
          durationMs: 4200,
          timestamp: '2026-05-04T00:00:00Z'
        },
        tests: null
      }
    })
    render(<VerificationTab />)
    expect(screen.getByText('Type check')).toBeInTheDocument()
    expect(screen.getByText(/passed/i)).toBeInTheDocument()
  })

  it('renders tests failed row with stderr output', () => {
    setup({
      verification_results: {
        typecheck: {
          exitCode: 0,
          stdout: '',
          stderr: '',
          truncated: false,
          durationMs: 1000,
          timestamp: '2026-05-04T00:00:00Z'
        },
        tests: {
          exitCode: 1,
          stdout: '',
          stderr: '3 tests failed',
          truncated: false,
          durationMs: 18000,
          timestamp: '2026-05-04T00:00:01Z'
        }
      }
    })
    render(<VerificationTab />)
    expect(screen.getByText('Tests')).toBeInTheDocument()
    expect(screen.getByText(/failed/i)).toBeInTheDocument()
    expect(screen.getByText('3 tests failed')).toBeInTheDocument()
  })

  it('shows truncation notice when truncated is true', () => {
    setup({
      verification_results: {
        typecheck: {
          exitCode: 0,
          stdout: 'x'.repeat(100),
          stderr: '',
          truncated: true,
          durationMs: 100,
          timestamp: '2026-05-04T00:00:00Z'
        },
        tests: null
      }
    })
    render(<VerificationTab />)
    expect(screen.getByText(/output truncated/i)).toBeInTheDocument()
  })
})

describe('VerificationTab — Agent Test Runs section', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders section heading', () => {
    setup({ verification_results: null })
    render(<VerificationTab />)
    expect(screen.getByText('Agent Test Runs')).toBeInTheDocument()
  })

  it('shows empty state when no test commands found', () => {
    setup({ verification_results: null })
    render(<VerificationTab />)
    expect(screen.getByText(/no test commands detected/i)).toBeInTheDocument()
  })
})
