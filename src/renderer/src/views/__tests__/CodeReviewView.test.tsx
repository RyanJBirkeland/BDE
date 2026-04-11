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
    diffMode: 'diff',
    diffFiles: [],
    commits: [],
    loading: {},
    error: null,
    selectedBatchIds: new Set(),
    reviewSummary: null,
    summaryLoading: false,
    selectedDiffFile: null,
    selectTask: vi.fn(),
    setActiveTab: vi.fn(),
    setDiffMode: vi.fn(),
    setDiffFiles: vi.fn(),
    setCommits: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    toggleBatchId: vi.fn(),
    selectAllBatch: vi.fn(),
    clearBatch: vi.fn(),
    setReviewSummary: vi.fn(),
    setSummaryLoading: vi.fn(),
    setSelectedDiffFile: vi.fn(),
    reset: vi.fn()
  }))
  return { useCodeReviewStore: store }
})

vi.mock('../../stores/reviewPartner', () => ({
  useReviewPartnerStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      panelOpen: false,
      reviewByTask: {},
      messagesByTask: {},
      activeStreamByTask: {},
      togglePanel: vi.fn(),
      sendMessage: vi.fn(),
      abortStream: vi.fn(),
      clearMessages: vi.fn(),
      autoReview: vi.fn()
    })
  )
}))

vi.mock('../../lib/render-agent-markdown', () => ({
  renderAgentMarkdown: (text: string) => <span>{text}</span>
}))

import CodeReviewView from '../CodeReviewView'

describe('CodeReviewView', () => {
  it('renders the three-column shell with TopBar', () => {
    render(<CodeReviewView />)
    // TopBar should be present
    expect(screen.getByText('No tasks in review')).toBeInTheDocument()
    // AI Review Partner panel should be present (updated title from Phase G1)
    expect(screen.getByText('AI Review Partner')).toBeInTheDocument()
  })

  it('renders the actions hint when no task selected', () => {
    render(<CodeReviewView />)
    expect(screen.getByText('No tasks in review')).toBeInTheDocument()
  })
})
