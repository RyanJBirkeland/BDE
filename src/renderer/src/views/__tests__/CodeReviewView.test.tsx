import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tasks: [], loading: false, loadData: vi.fn() })
  )
}))

vi.mock('../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: null,
    activeTab: 'changes',
    diffFiles: [],
    commits: [],
    loading: {},
    error: null,
    selectTask: vi.fn(),
    setActiveTab: vi.fn(),
    setDiffFiles: vi.fn(),
    setCommits: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    reset: vi.fn()
  }))
  return { useCodeReviewStore: store }
})

vi.mock('../../lib/render-agent-markdown', () => ({
  renderAgentMarkdown: (text: string) => <span>{text}</span>
}))

import CodeReviewView from '../CodeReviewView'

describe('CodeReviewView', () => {
  it('renders the view shell with queue and detail areas', () => {
    render(<CodeReviewView />)
    expect(screen.getByText('Review Queue')).toBeInTheDocument()
    // Detail shows empty state when no task selected
    expect(screen.getByText('No task selected')).toBeInTheDocument()
  })

  it('renders the actions hint when no task selected', () => {
    render(<CodeReviewView />)
    expect(screen.getByText('Select a task in review to see actions')).toBeInTheDocument()
  })
})
