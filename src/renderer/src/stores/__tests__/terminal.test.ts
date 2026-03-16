import { describe, it, expect, beforeEach } from 'vitest'
import { useTerminalStore } from '../terminal'

describe('terminal store', () => {
  beforeEach(() => {
    // Reset to a single tab state
    const tab = { id: 'tab-1', title: 'Terminal 1', kind: 'shell' as const, shell: '/bin/zsh', ptyId: null, isAgentTab: false }
    useTerminalStore.setState({ tabs: [tab], activeTabId: 'tab-1' })
  })

  it('starts with one tab', () => {
    expect(useTerminalStore.getState().tabs).toHaveLength(1)
  })

  it('addTab creates a new tab and sets it active', () => {
    useTerminalStore.getState().addTab()
    const state = useTerminalStore.getState()
    expect(state.tabs).toHaveLength(2)
    expect(state.activeTabId).toBe(state.tabs[1].id)
  })

  it('addTab creates tab with title containing Terminal', () => {
    useTerminalStore.getState().addTab()
    const newTab = useTerminalStore.getState().tabs[1]
    expect(newTab.title).toMatch(/^Terminal \d+$/)
  })

  it('closeTab removes a tab and switches active to adjacent', () => {
    useTerminalStore.getState().addTab()
    const state = useTerminalStore.getState()
    const firstId = state.tabs[0].id
    const secondId = state.tabs[1].id

    // Close the active tab (second one)
    useTerminalStore.getState().closeTab(secondId)
    const after = useTerminalStore.getState()
    expect(after.tabs).toHaveLength(1)
    expect(after.activeTabId).toBe(firstId)
  })

  it('closeTab with only 1 tab is a no-op', () => {
    const before = useTerminalStore.getState()
    useTerminalStore.getState().closeTab(before.tabs[0].id)
    const after = useTerminalStore.getState()
    expect(after.tabs).toHaveLength(1)
    expect(after.tabs[0].id).toBe(before.tabs[0].id)
  })

  it('setActiveTab updates activeTabId', () => {
    useTerminalStore.getState().addTab()
    const firstId = useTerminalStore.getState().tabs[0].id
    useTerminalStore.getState().setActiveTab(firstId)
    expect(useTerminalStore.getState().activeTabId).toBe(firstId)
  })

  it('setPtyId updates the correct tab', () => {
    const tabId = useTerminalStore.getState().tabs[0].id
    useTerminalStore.getState().setPtyId(tabId, 42)
    expect(useTerminalStore.getState().tabs[0].ptyId).toBe(42)
  })

  it('renameTab updates the title of the correct tab', () => {
    useTerminalStore.getState().renameTab('tab-1', 'my-server')
    expect(useTerminalStore.getState().tabs[0].title).toBe('my-server')
  })

  it('renameTab does not affect other tabs', () => {
    useTerminalStore.getState().addTab()
    const tabs = useTerminalStore.getState().tabs
    useTerminalStore.getState().renameTab(tabs[1].id, 'renamed')
    expect(useTerminalStore.getState().tabs[0].title).toBe('Terminal 1')
    expect(useTerminalStore.getState().tabs[1].title).toBe('renamed')
  })

  it('openAgentTab creates an agent tab', () => {
    useTerminalStore.getState().openAgentTab('local:1234', 'Test Agent')
    const state = useTerminalStore.getState()
    expect(state.tabs).toHaveLength(2)
    const agentTab = state.tabs[1]
    expect(agentTab.kind).toBe('agent')
    expect(agentTab.agentId).toBe('local:1234')
    expect(agentTab.title).toBe('Test Agent')
    expect(state.activeTabId).toBe(agentTab.id)
  })

  it('createAgentTab creates an agent tab with session key', () => {
    useTerminalStore.getState().createAgentTab('agent-123', 'My Agent', 'session-key-abc')
    const state = useTerminalStore.getState()
    expect(state.tabs).toHaveLength(2)
    const agentTab = state.tabs[1]
    expect(agentTab.kind).toBe('agent')
    expect(agentTab.isAgentTab).toBe(true)
    expect(agentTab.agentId).toBe('agent-123')
    expect(agentTab.agentSessionKey).toBe('session-key-abc')
    expect(agentTab.title).toBe('My Agent')
    expect(state.activeTabId).toBe(agentTab.id)
  })

  it('setPtyId does not affect other tabs', () => {
    useTerminalStore.getState().addTab()
    const tabs = useTerminalStore.getState().tabs
    useTerminalStore.getState().setPtyId(tabs[1].id, 99)
    expect(useTerminalStore.getState().tabs[0].ptyId).toBeNull()
    expect(useTerminalStore.getState().tabs[1].ptyId).toBe(99)
  })
})
