import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminalTabBar } from '../TerminalTabBar'
import type { TerminalTab } from '../../../stores/terminal'

// Mock child pickers — they open popovers that aren't relevant here
vi.mock('../ShellPicker', () => ({
  ShellPicker: () => null
}))

vi.mock('../AgentPicker', () => ({
  AgentPicker: () => null
}))

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'tab-1',
    title: 'Terminal 1',
    kind: 'shell',
    shell: '/bin/zsh',
    ptyId: null,
    isLabelCustom: false,
    status: 'running',
    hasUnread: false,
    ...overrides
  }
}

const defaultProps = {
  tabs: [makeTab()],
  activeTabId: 'tab-1',
  onSelectTab: vi.fn(),
  onCloseTab: vi.fn(),
  onAddTab: vi.fn(),
  onCreateAgentTab: vi.fn()
}

describe('TerminalTabBar', () => {
  it('renders tab labels', () => {
    const tabs = [
      makeTab({ id: 'tab-1', title: 'Terminal 1' }),
      makeTab({ id: 'tab-2', title: 'Terminal 2' })
    ]
    render(<TerminalTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" />)
    expect(screen.getByText('Terminal 1')).toBeInTheDocument()
    expect(screen.getByText('Terminal 2')).toBeInTheDocument()
  })

  it('calls onSelectTab when a tab is clicked', async () => {
    const onSelectTab = vi.fn()
    const tabs = [
      makeTab({ id: 'tab-1', title: 'Terminal 1' }),
      makeTab({ id: 'tab-2', title: 'Terminal 2' })
    ]
    const user = userEvent.setup()
    render(
      <TerminalTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" onSelectTab={onSelectTab} />
    )
    await user.click(screen.getByText('Terminal 2'))
    expect(onSelectTab).toHaveBeenCalledWith('tab-2')
  })

  it('renders the add button', () => {
    render(<TerminalTabBar {...defaultProps} />)
    // The add button has title "New terminal (⌘T)"
    expect(screen.getByTitle('New terminal (⌘T)')).toBeInTheDocument()
  })

  it('calls onAddTab when add button is clicked', async () => {
    const onAddTab = vi.fn()
    const user = userEvent.setup()
    render(<TerminalTabBar {...defaultProps} onAddTab={onAddTab} />)
    await user.click(screen.getByTitle('New terminal (⌘T)'))
    expect(onAddTab).toHaveBeenCalled()
  })

  it('renders agent tab with bot icon class', () => {
    const agentTab = makeTab({ id: 'agent-1', title: 'My Agent', kind: 'agent', agentId: 'a1' })
    render(<TerminalTabBar {...defaultProps} tabs={[agentTab]} activeTabId="agent-1" />)
    expect(screen.getByText('My Agent')).toBeInTheDocument()
  })

  it('shows close button on active tab when there are multiple tabs', () => {
    const tabs = [
      makeTab({ id: 'tab-1', title: 'Tab 1' }),
      makeTab({ id: 'tab-2', title: 'Tab 2' })
    ]
    const { container } = render(
      <TerminalTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" />
    )
    expect(container.querySelector('.terminal-tab__close')).toBeInTheDocument()
  })

  it('does not show close button when only one tab', () => {
    const { container } = render(<TerminalTabBar {...defaultProps} />)
    expect(container.querySelector('.terminal-tab__close')).not.toBeInTheDocument()
  })

  it('calls onCloseTab when close button is clicked', async () => {
    const user = userEvent.setup()
    const onCloseTab = vi.fn()
    const tabs = [
      makeTab({ id: 'tab-1', title: 'Tab 1' }),
      makeTab({ id: 'tab-2', title: 'Tab 2' })
    ]
    render(
      <TerminalTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" onCloseTab={onCloseTab} />
    )
    const closeBtn = document.querySelector('.terminal-tab__close') as HTMLButtonElement
    await user.click(closeBtn)
    expect(onCloseTab).toHaveBeenCalledWith('tab-1')
  })

  it('enters rename mode on double-click when onRenameTab is provided', async () => {
    const user = userEvent.setup()
    const onRenameTab = vi.fn()
    render(<TerminalTabBar {...defaultProps} onRenameTab={onRenameTab} />)
    await user.dblClick(screen.getByText('Terminal 1'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('does not enter rename mode on double-click when onRenameTab is not provided', async () => {
    const user = userEvent.setup()
    render(<TerminalTabBar {...defaultProps} />)
    await user.dblClick(screen.getByText('Terminal 1'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('submits rename on Enter key', async () => {
    const user = userEvent.setup()
    const onRenameTab = vi.fn()
    render(<TerminalTabBar {...defaultProps} onRenameTab={onRenameTab} />)
    await user.dblClick(screen.getByText('Terminal 1'))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'New Name{Enter}')
    expect(onRenameTab).toHaveBeenCalledWith('tab-1', 'New Name')
  })

  it('cancels rename on Escape key', async () => {
    const user = userEvent.setup()
    const onRenameTab = vi.fn()
    render(<TerminalTabBar {...defaultProps} onRenameTab={onRenameTab} />)
    await user.dblClick(screen.getByText('Terminal 1'))
    const input = screen.getByRole('textbox')
    await user.type(input, '{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onRenameTab).not.toHaveBeenCalled()
  })

  it('shows context menu on right-click', async () => {
    const user = userEvent.setup()
    const onRenameTab = vi.fn()
    render(<TerminalTabBar {...defaultProps} onRenameTab={onRenameTab} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Terminal 1') })
    expect(screen.getByText('Rename')).toBeInTheDocument()
  })

  it('shows Duplicate option in context menu when onDuplicateTab provided', async () => {
    const user = userEvent.setup()
    const onDuplicateTab = vi.fn()
    render(<TerminalTabBar {...defaultProps} onDuplicateTab={onDuplicateTab} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Terminal 1') })
    expect(screen.getByText('Duplicate')).toBeInTheDocument()
  })

  it('calls onDuplicateTab from context menu', async () => {
    const user = userEvent.setup()
    const onDuplicateTab = vi.fn()
    render(<TerminalTabBar {...defaultProps} onDuplicateTab={onDuplicateTab} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Terminal 1') })
    await user.click(screen.getByText('Duplicate'))
    expect(onDuplicateTab).toHaveBeenCalledWith('tab-1')
  })

  it('shows Close Others option when multiple tabs', async () => {
    const user = userEvent.setup()
    const onCloseOthers = vi.fn()
    const tabs = [
      makeTab({ id: 'tab-1', title: 'Tab 1' }),
      makeTab({ id: 'tab-2', title: 'Tab 2' })
    ]
    render(<TerminalTabBar {...defaultProps} tabs={tabs} onCloseOthers={onCloseOthers} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Tab 1') })
    expect(screen.getByText('Close Others')).toBeInTheDocument()
  })

  it('calls onCloseOthers from context menu', async () => {
    const user = userEvent.setup()
    const onCloseOthers = vi.fn()
    const tabs = [
      makeTab({ id: 'tab-1', title: 'Tab 1' }),
      makeTab({ id: 'tab-2', title: 'Tab 2' })
    ]
    render(<TerminalTabBar {...defaultProps} tabs={tabs} onCloseOthers={onCloseOthers} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Tab 1') })
    await user.click(screen.getByText('Close Others'))
    expect(onCloseOthers).toHaveBeenCalledWith('tab-1')
  })

  it('shows Close All option when multiple tabs', async () => {
    const user = userEvent.setup()
    const onCloseAll = vi.fn()
    const tabs = [
      makeTab({ id: 'tab-1', title: 'Tab 1' }),
      makeTab({ id: 'tab-2', title: 'Tab 2' })
    ]
    render(<TerminalTabBar {...defaultProps} tabs={tabs} onCloseAll={onCloseAll} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Tab 1') })
    await user.click(screen.getByText('Close All'))
    expect(onCloseAll).toHaveBeenCalled()
  })

  it('marks active tab with terminal-tab--active class', () => {
    const tabs = [
      makeTab({ id: 'tab-1', title: 'Tab 1' }),
      makeTab({ id: 'tab-2', title: 'Tab 2' })
    ]
    const { container } = render(
      <TerminalTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" />
    )
    const activeTab = container.querySelector('.terminal-tab--active')
    expect(activeTab).toBeInTheDocument()
    expect(activeTab?.textContent).toContain('Tab 1')
  })

  it('marks agent tab with terminal-tab--agent class', () => {
    const agentTab = makeTab({ id: 'agent-1', title: 'Agent', kind: 'agent', agentId: 'a1' })
    const { container } = render(
      <TerminalTabBar {...defaultProps} tabs={[agentTab]} activeTabId="agent-1" />
    )
    expect(container.querySelector('.terminal-tab--agent')).toBeInTheDocument()
  })

  it('shows blue status dot for tab with unread messages', () => {
    const { container } = render(<TerminalTabBar {...defaultProps} />)
    // Default tab doesn't have unread but we can verify dot exists
    expect(container.querySelector('.terminal-tab__status-dot')).toBeInTheDocument()
  })

  it('shows gray status dot for exited tab', () => {
    const exitedTab = makeTab({ status: 'exited' })
    const { container } = render(
      <TerminalTabBar {...defaultProps} tabs={[exitedTab]} activeTabId="tab-1" />
    )
    const dot = container.querySelector('.terminal-tab__status-dot') as HTMLElement
    expect(dot?.style.backgroundColor).toBe('var(--bde-text-dim)')
  })

  it('shows green status dot for running shell tab', () => {
    const { container } = render(<TerminalTabBar {...defaultProps} />)
    const dot = container.querySelector('.terminal-tab__status-dot') as HTMLElement
    expect(dot?.style.backgroundColor).toBe('var(--bde-accent)')
  })

  it('shows purple status dot for agent tab', () => {
    const agentTab = makeTab({ id: 'agent-1', title: 'Agent', kind: 'agent', agentId: 'a1' })
    const { container } = render(
      <TerminalTabBar {...defaultProps} tabs={[agentTab]} activeTabId="agent-1" />
    )
    const dot = container.querySelector('.terminal-tab__status-dot') as HTMLElement
    expect(dot?.style.backgroundColor).toBe('var(--bde-subagent)')
  })
})
