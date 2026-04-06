import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { mockSetActiveTab } = vi.hoisted(() => ({
  mockSetActiveTab: vi.fn()
}))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: null as string | null,
    activeTab: 'changes' as 'changes' | 'commits' | 'conversation',
    setActiveTab: mockSetActiveTab
  }))
  return { useCodeReviewStore: store }
})

vi.mock('../ChangesTab', () => ({
  ChangesTab: () => <div data-testid="changes-tab">Changes Tab</div>
}))

vi.mock('../CommitsTab', () => ({
  CommitsTab: () => <div data-testid="commits-tab">Commits Tab</div>
}))

vi.mock('../ConversationTab', () => ({
  ConversationTab: () => <div data-testid="conversation-tab">Conversation Tab</div>
}))

import { ReviewDetail } from '../ReviewDetail'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('ReviewDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCodeReviewStore.setState({
      selectedTaskId: null,
      activeTab: 'changes',
      setActiveTab: mockSetActiveTab
    })
  })

  it('shows empty state when no task selected', () => {
    useCodeReviewStore.setState({ selectedTaskId: null })
    render(<ReviewDetail />)
    expect(screen.getByText('No task selected')).toBeInTheDocument()
  })

  it('renders 3 tabs', () => {
    useCodeReviewStore.setState({ selectedTaskId: 't1' })
    render(<ReviewDetail />)

    expect(screen.getByRole('tab', { name: 'Changes' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Commits' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Conversation' })).toBeInTheDocument()
  })

  it('tab switching works', () => {
    useCodeReviewStore.setState({ selectedTaskId: 't1', activeTab: 'changes' })
    render(<ReviewDetail />)

    const commitsTab = screen.getByRole('tab', { name: 'Commits' })
    fireEvent.click(commitsTab)
    expect(mockSetActiveTab).toHaveBeenCalledWith('commits')
  })

  it('renders changes tab when activeTab is changes', () => {
    useCodeReviewStore.setState({ selectedTaskId: 't1', activeTab: 'changes' })
    render(<ReviewDetail />)
    expect(screen.getByTestId('changes-tab')).toBeInTheDocument()
  })

  it('renders commits tab when activeTab is commits', () => {
    useCodeReviewStore.setState({ selectedTaskId: 't1', activeTab: 'commits' })
    render(<ReviewDetail />)
    expect(screen.getByTestId('commits-tab')).toBeInTheDocument()
  })

  it('renders conversation tab when activeTab is conversation', () => {
    useCodeReviewStore.setState({ selectedTaskId: 't1', activeTab: 'conversation' })
    render(<ReviewDetail />)
    expect(screen.getByTestId('conversation-tab')).toBeInTheDocument()
  })

  it('marks active tab with aria-selected', () => {
    useCodeReviewStore.setState({ selectedTaskId: 't1', activeTab: 'commits' })
    render(<ReviewDetail />)

    const changesTab = screen.getByRole('tab', { name: 'Changes' })
    const commitsTab = screen.getByRole('tab', { name: 'Commits' })
    const conversationTab = screen.getByRole('tab', { name: 'Conversation' })

    expect(changesTab.getAttribute('aria-selected')).toBe('false')
    expect(commitsTab.getAttribute('aria-selected')).toBe('true')
    expect(conversationTab.getAttribute('aria-selected')).toBe('false')
  })
})
