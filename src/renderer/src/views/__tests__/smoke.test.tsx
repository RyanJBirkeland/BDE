/**
 * Smoke tests for all views — verify they render without crashing.
 * Heavy child components are mocked to avoid pulling in xterm, websockets, etc.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// jsdom stubs
Element.prototype.scrollIntoView = vi.fn()

// ---------- Shared mocks ----------

vi.mock('../../stores/sessions', () => ({
  useSessionsStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        sessions: [],
        subAgents: [],
        subAgentsError: null,
        selectedSessionKey: null,
        loading: false,
        fetchError: null,
        selectSession: vi.fn(),
        fetchSessions: vi.fn().mockResolvedValue(undefined),
        killSession: vi.fn().mockResolvedValue(undefined),
        steerSubAgent: vi.fn().mockResolvedValue(undefined),
        runTask: vi.fn().mockResolvedValue(undefined),
      })
    ),
    { getState: () => ({ sessions: [], subAgents: [], fetchSessions: vi.fn().mockResolvedValue(undefined) }) }
  ),
}))

vi.mock('../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeView: 'sessions', setView: vi.fn() })
  ),
}))

vi.mock('../../stores/gateway', () => ({
  useGatewayStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ status: 'disconnected', client: null, connect: vi.fn(), reconnect: vi.fn() })
  ),
}))

vi.mock('../../stores/theme', () => ({
  useThemeStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ theme: 'dark', toggleTheme: vi.fn(), setTheme: vi.fn() })
  ),
}))

vi.mock('../../stores/terminal', () => {
  const tab = { id: 'tab-1', label: 'Terminal 1', ptyId: null }
  return {
    useTerminalStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        tabs: [tab],
        activeTabId: 'tab-1',
        showFind: false,
        selectedShell: '/bin/zsh',
        addTab: vi.fn(),
        closeTab: vi.fn(),
        setActiveTab: vi.fn(),
        setShowFind: vi.fn(),
        setSelectedShell: vi.fn(),
      }
      return selector ? selector(state) : state
    }),
  }
})

vi.mock('../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToastStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ toasts: [], removeToast: vi.fn() })
  ),
}))

vi.mock('../../stores/chat', () => ({
  useChatStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ lines: {}, addLine: vi.fn(), clearSession: vi.fn(), clearAll: vi.fn() })
  ),
}))

vi.mock('../../lib/rpc', () => ({
  invokeTool: vi.fn().mockResolvedValue({ sessions: [], count: 0 }),
}))

vi.mock('../../lib/github-api', () => ({
  listOpenPRs: vi.fn().mockResolvedValue([]),
  mergePR: vi.fn().mockResolvedValue(undefined),
}))

// Mock heavy child components
vi.mock('../../components/sessions/SessionList', () => ({
  SessionList: () => <div data-testid="session-list" />,
}))

vi.mock('../../components/sessions/ChatThread', () => ({
  ChatThread: () => <div data-testid="chat-thread" />,
}))

vi.mock('../../components/sessions/MessageInput', () => ({
  MessageInput: () => <div data-testid="message-input" />,
}))

vi.mock('../../components/sessions/SpawnModal', () => ({
  SpawnModal: () => null,
}))

vi.mock('../../components/sprint/SprintBoard', () => ({
  default: () => <div data-testid="sprint-board" />,
}))

vi.mock('../../components/sprint/PRList', () => ({
  default: () => <div data-testid="pr-list" />,
}))

vi.mock('../../components/diff/DiffViewer', () => ({
  default: () => <div data-testid="diff-viewer" />,
}))

vi.mock('../../components/terminal/TerminalPane', () => ({
  TerminalPane: () => <div data-testid="terminal-pane" />,
  clearTerminal: vi.fn(),
  getSearchAddon: vi.fn(),
}))

vi.mock('../../components/terminal/FindBar', () => ({
  FindBar: () => null,
}))

// Mock window.api for views that use it — assign directly to preserve window methods
Object.defineProperty(window, 'api', {
  value: {
    getGatewayConfig: vi.fn().mockResolvedValue({ url: 'http://localhost', token: 'tok' }),
    getRepoPaths: vi.fn().mockResolvedValue({ bde: '/path/to/BDE' }),
    gitStatus: vi.fn().mockResolvedValue({ files: [] }),
    gitBranches: vi.fn().mockResolvedValue({ branches: ['main'], current: 'main' }),
    gitDiff: vi.fn().mockResolvedValue(''),
    gitStage: vi.fn().mockResolvedValue(undefined),
    gitUnstage: vi.fn().mockResolvedValue(undefined),
    gitCommit: vi.fn().mockResolvedValue(undefined),
    gitPush: vi.fn().mockResolvedValue('ok'),
    gitCheckout: vi.fn().mockResolvedValue(undefined),
    listMemoryFiles: vi.fn().mockResolvedValue([]),
    readMemoryFile: vi.fn().mockResolvedValue(''),
    writeMemoryFile: vi.fn().mockResolvedValue(undefined),
    saveGatewayConfig: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn(),
    pollPrStatuses: vi.fn().mockResolvedValue([]),
    sprint: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      readLog: vi.fn().mockResolvedValue({ content: '', status: '' }),
      readSpecFile: vi.fn().mockResolvedValue(''),
    },
    onExternalSprintChange: vi.fn(),
    offExternalSprintChange: vi.fn(),
    onSprintSseEvent: vi.fn().mockReturnValue(() => {}),
  },
  writable: true,
  configurable: true,
})

// ---------- Imports ----------

import { SessionsView } from '../SessionsView'
import SprintView from '../SprintView'
import DiffView from '../DiffView'
import MemoryView from '../MemoryView'
import CostView from '../CostView'
import SettingsView from '../SettingsView'
import { TerminalView } from '../TerminalView'

// ---------- Tests ----------

describe('View smoke tests', () => {
  it('SessionsView renders without crashing', () => {
    const { container } = render(<SessionsView />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.innerHTML).not.toBe('')
  })

  it('SprintView renders without crashing', () => {
    const { container } = render(<SprintView />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.innerHTML).not.toBe('')
  })

  it('DiffView renders without crashing', () => {
    const { container } = render(<DiffView />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.innerHTML).not.toBe('')
  })

  it('MemoryView renders without crashing', () => {
    const { container } = render(<MemoryView />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.innerHTML).not.toBe('')
  })

  it('CostView renders without crashing', () => {
    const { container } = render(<CostView />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.innerHTML).not.toBe('')
  })

  it('SettingsView renders without crashing', () => {
    const { container } = render(<SettingsView />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.innerHTML).not.toBe('')
  })

  it('TerminalView renders mocked terminal pane', () => {
    render(<TerminalView />)
    expect(screen.getByTestId('terminal-pane')).toBeInTheDocument()
  })
})
