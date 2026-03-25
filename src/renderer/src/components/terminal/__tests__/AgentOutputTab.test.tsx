import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock the agent events store
const mockEvents: Record<string, unknown[]> = {}
const mockLoadHistory = vi.fn()

vi.mock('../../../stores/agentEvents', () => ({
  useAgentEventsStore: (selector: (s: unknown) => unknown) =>
    selector({
      events: mockEvents,
      loadHistory: mockLoadHistory,
    }),
}))

// Mock ChatRenderer
vi.mock('../../agents/ChatRenderer', () => ({
  ChatRenderer: ({ events }: { events: unknown[] }) => (
    <div data-testid="chat-renderer">Events: {events.length}</div>
  ),
}))

// Mock design-system tokens
vi.mock('../../../design-system/tokens', () => ({
  tokens: {
    space: { 2: '0.5rem', 3: '0.75rem', 4: '1rem', 8: '2rem' },
    color: { text: '#fff', textDim: '#888', border: '#333' },
    font: { ui: 'sans-serif', code: 'monospace' },
    size: { md: '14px' },
  },
}))

import { AgentOutputTab } from '../AgentOutputTab'

describe('AgentOutputTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset events
    Object.keys(mockEvents).forEach((key) => delete mockEvents[key])
  })

  it('calls loadHistory on mount with agentId', () => {
    render(<AgentOutputTab agentId="agent-1" />)
    expect(mockLoadHistory).toHaveBeenCalledWith('agent-1')
  })

  it('does not call loadHistory when agentId is empty', () => {
    render(<AgentOutputTab agentId="" />)
    expect(mockLoadHistory).not.toHaveBeenCalled()
  })

  it('renders ChatRenderer when events are available', () => {
    mockEvents['agent-1'] = [{ type: 'message', text: 'hello' }]
    render(<AgentOutputTab agentId="agent-1" />)
    expect(screen.getByTestId('chat-renderer')).toBeInTheDocument()
    expect(screen.getByText('Events: 1')).toBeInTheDocument()
  })

  it('renders waiting message when sessionKey is provided but no events', () => {
    render(<AgentOutputTab agentId="agent-1" sessionKey="sess-123" />)
    expect(screen.getByText(/Waiting for agent output/)).toBeInTheDocument()
  })

  it('renders legacy plaintext output when agentOutput is provided', () => {
    render(
      <AgentOutputTab agentId="agent-1" agentOutput={['chunk 1', 'chunk 2']} />
    )
    expect(screen.getByText('chunk 1')).toBeInTheDocument()
    expect(screen.getByText('chunk 2')).toBeInTheDocument()
  })

  it('renders empty state when no events, no sessionKey, and no agentOutput', () => {
    render(<AgentOutputTab agentId="agent-1" />)
    expect(screen.getByText(/Waiting for agent output/)).toBeInTheDocument()
  })

  it('does not render legacy output when agentOutput is empty array', () => {
    render(<AgentOutputTab agentId="agent-1" agentOutput={[]} />)
    // Should fall through to empty state
    expect(screen.getByText(/Waiting for agent output/)).toBeInTheDocument()
  })

  it('prefers events over sessionKey and agentOutput', () => {
    mockEvents['agent-1'] = [{ type: 'message' }]
    render(
      <AgentOutputTab
        agentId="agent-1"
        sessionKey="sess-123"
        agentOutput={['text']}
      />
    )
    expect(screen.getByTestId('chat-renderer')).toBeInTheDocument()
    expect(screen.queryByText('text')).not.toBeInTheDocument()
  })

  it('prefers sessionKey over agentOutput when no events', () => {
    render(
      <AgentOutputTab
        agentId="agent-1"
        sessionKey="sess-123"
        agentOutput={['legacy text']}
      />
    )
    // sessionKey path shows waiting message, not legacy output
    expect(screen.getByText(/Waiting for agent output/)).toBeInTheDocument()
    expect(screen.queryByText('legacy text')).not.toBeInTheDocument()
  })

  it('renders with terminal-agent-tab class wrapper', () => {
    const { container } = render(<AgentOutputTab agentId="agent-1" />)
    expect(container.querySelector('.terminal-agent-tab')).toBeInTheDocument()
  })
})
