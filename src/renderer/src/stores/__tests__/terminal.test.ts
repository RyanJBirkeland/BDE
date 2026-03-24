import { describe, it, expect, beforeEach } from 'vitest'
import { useTerminalStore } from '../terminal'

describe('terminal store', () => {
  beforeEach(() => {
    // Reset to a single tab state
    const tab = {
      id: 'tab-1',
      title: 'Terminal 1',
      kind: 'shell' as const,
      shell: '/bin/zsh',
      ptyId: null,
      isLabelCustom: false,
      status: 'running' as const,
      hasUnread: false
    }
    useTerminalStore.setState({
      tabs: [tab],
      activeTabId: 'tab-1',
      splitEnabled: false,
      splitTabId: null,
      fontSize: 13,
      showFind: false
    })
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
    expect(agentTab.kind).toBe('agent')
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

  it('renameTab sets isLabelCustom to true', () => {
    useTerminalStore.getState().renameTab('tab-1', 'custom name')
    const tab = useTerminalStore.getState().tabs[0]
    expect(tab.title).toBe('custom name')
    expect(tab.isLabelCustom).toBe(true)
  })

  it('reorderTab moves a tab from one index to another', () => {
    useTerminalStore.getState().addTab()
    useTerminalStore.getState().addTab()
    const before = useTerminalStore.getState().tabs.map((t) => t.id)
    // Move first tab to last position
    useTerminalStore.getState().reorderTab(0, 2)
    const after = useTerminalStore.getState().tabs.map((t) => t.id)
    expect(after[2]).toBe(before[0])
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[2])
  })

  it('reorderTab moves a tab forward (right)', () => {
    useTerminalStore.getState().addTab()
    const before = useTerminalStore.getState().tabs.map((t) => t.id)
    useTerminalStore.getState().reorderTab(0, 1)
    const after = useTerminalStore.getState().tabs.map((t) => t.id)
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[0])
  })

  it('toggleSplit enables split with the active tab as splitTabId', () => {
    const activeId = useTerminalStore.getState().activeTabId
    useTerminalStore.getState().toggleSplit()
    const state = useTerminalStore.getState()
    expect(state.splitEnabled).toBe(true)
    expect(state.splitTabId).toBe(activeId)
  })

  it('toggleSplit disables split and clears splitTabId', () => {
    useTerminalStore.getState().toggleSplit()
    useTerminalStore.getState().toggleSplit()
    const state = useTerminalStore.getState()
    expect(state.splitEnabled).toBe(false)
    expect(state.splitTabId).toBeNull()
  })

  it('closeTab closing the splitTabId disables split', () => {
    // Add a second tab so we can close one
    useTerminalStore.getState().addTab()
    const tabs = useTerminalStore.getState().tabs
    const firstId = tabs[0].id
    // Set first tab active and enable split
    useTerminalStore.getState().setActiveTab(firstId)
    useTerminalStore.getState().toggleSplit()
    expect(useTerminalStore.getState().splitEnabled).toBe(true)
    expect(useTerminalStore.getState().splitTabId).toBe(firstId)
    // Close the split tab
    useTerminalStore.getState().closeTab(firstId)
    const after = useTerminalStore.getState()
    expect(after.splitEnabled).toBe(false)
    expect(after.splitTabId).toBeNull()
  })

  it('closeTab of non-split tab does not affect split state', () => {
    useTerminalStore.getState().addTab()
    const tabs = useTerminalStore.getState().tabs
    const firstId = tabs[0].id
    const secondId = tabs[1].id
    // Enable split on first tab, then close the second
    useTerminalStore.getState().setActiveTab(firstId)
    useTerminalStore.getState().toggleSplit()
    useTerminalStore.getState().closeTab(secondId)
    const after = useTerminalStore.getState()
    expect(after.splitEnabled).toBe(true)
    expect(after.splitTabId).toBe(firstId)
  })

  it('setTabStatus updates a tab status', () => {
    useTerminalStore.getState().setTabStatus('tab-1', 'exited')
    expect(useTerminalStore.getState().tabs[0].status).toBe('exited')
  })

  it('setTabStatus does not affect other tabs', () => {
    useTerminalStore.getState().addTab()
    const tabs = useTerminalStore.getState().tabs
    useTerminalStore.getState().setTabStatus(tabs[1].id, 'exited')
    expect(useTerminalStore.getState().tabs[0].status).toBe('running')
    expect(useTerminalStore.getState().tabs[1].status).toBe('exited')
  })

  it('setUnread marks a tab as having unread output', () => {
    useTerminalStore.getState().setUnread('tab-1', true)
    expect(useTerminalStore.getState().tabs[0].hasUnread).toBe(true)
  })

  it('setUnread clears unread flag', () => {
    useTerminalStore.getState().setUnread('tab-1', true)
    useTerminalStore.getState().setUnread('tab-1', false)
    expect(useTerminalStore.getState().tabs[0].hasUnread).toBe(false)
  })

  it('zoomIn increases fontSize by 1', () => {
    const before = useTerminalStore.getState().fontSize
    useTerminalStore.getState().zoomIn()
    expect(useTerminalStore.getState().fontSize).toBe(before + 1)
  })

  it('zoomIn does not exceed max fontSize of 20', () => {
    useTerminalStore.setState({ fontSize: 20 })
    useTerminalStore.getState().zoomIn()
    expect(useTerminalStore.getState().fontSize).toBe(20)
  })

  it('zoomOut decreases fontSize by 1', () => {
    const before = useTerminalStore.getState().fontSize
    useTerminalStore.getState().zoomOut()
    expect(useTerminalStore.getState().fontSize).toBe(before - 1)
  })

  it('zoomOut does not go below min fontSize of 10', () => {
    useTerminalStore.setState({ fontSize: 10 })
    useTerminalStore.getState().zoomOut()
    expect(useTerminalStore.getState().fontSize).toBe(10)
  })

  it('resetZoom restores fontSize to 13', () => {
    useTerminalStore.setState({ fontSize: 18 })
    useTerminalStore.getState().resetZoom()
    expect(useTerminalStore.getState().fontSize).toBe(13)
  })

  it('setShowFind toggles the find panel', () => {
    useTerminalStore.getState().setShowFind(true)
    expect(useTerminalStore.getState().showFind).toBe(true)
    useTerminalStore.getState().setShowFind(false)
    expect(useTerminalStore.getState().showFind).toBe(false)
  })

  it('closeTab non-active tab keeps activeTabId unchanged', () => {
    useTerminalStore.getState().addTab()
    const tabs = useTerminalStore.getState().tabs
    const firstId = tabs[0].id
    const secondId = tabs[1].id
    useTerminalStore.getState().setActiveTab(secondId)
    useTerminalStore.getState().closeTab(firstId)
    expect(useTerminalStore.getState().activeTabId).toBe(secondId)
  })

  it('addTab accepts cwd parameter', () => {
    useTerminalStore.getState().addTab(undefined, '/path/to/project')
    const newTab = useTerminalStore.getState().tabs[1]
    expect(newTab.cwd).toBe('/path/to/project')
  })

  it('addTab without cwd parameter leaves cwd undefined', () => {
    useTerminalStore.getState().addTab()
    const newTab = useTerminalStore.getState().tabs[1]
    expect(newTab.cwd).toBeUndefined()
  })

  it('addTab accepts both shell and cwd parameters', () => {
    useTerminalStore.getState().addTab('/bin/bash', '/home/user/project')
    const newTab = useTerminalStore.getState().tabs[1]
    expect(newTab.shell).toBe('/bin/bash')
    expect(newTab.cwd).toBe('/home/user/project')
  })
})
