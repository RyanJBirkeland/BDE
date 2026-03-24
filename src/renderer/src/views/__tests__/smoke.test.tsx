/**
 * Smoke tests for all views — verify they render without crashing.
 * Heavy child components are mocked to avoid pulling in xterm, websockets, etc.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// jsdom stubs
Element.prototype.scrollIntoView = vi.fn()

// ---------- Shared mocks ----------

vi.mock('../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeView: 'agents', setView: vi.fn() })
  ),
}))

vi.mock('../../stores/unifiedAgents', () => ({
  useUnifiedAgentsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      agents: [],
      selectedId: null,
      loading: false,
      fetchAll: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(),
      spawn: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
    })
  ),
}))

vi.mock('../../stores/agentHistory', () => ({
  useAgentHistoryStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ agents: [], selectedId: null, fetchAgents: vi.fn().mockResolvedValue(undefined), selectAgent: vi.fn() })
  ),
}))

vi.mock('../../stores/agentEvents', () => ({
  useAgentEventsStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ events: {}, init: vi.fn().mockReturnValue(() => {}), loadHistory: vi.fn().mockResolvedValue(undefined), clear: vi.fn() })
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

vi.mock('../../lib/github-api', () => ({
  listOpenPRs: vi.fn().mockResolvedValue([]),
  mergePR: vi.fn().mockResolvedValue(undefined),
  getPrMergeability: vi.fn().mockResolvedValue(null),
}))

// Mock heavy child components
vi.mock('../../components/sessions/SessionList', () => ({
  SessionList: () => <div data-testid="session-list" />,
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
  PRList: () => <div data-testid="pr-list" />,
}))

vi.mock('../../components/diff/DiffViewer', () => ({
  default: () => <div data-testid="diff-viewer" />,
  DiffViewer: () => <div data-testid="diff-viewer" />,
}))

vi.mock('../../components/terminal/TerminalPane', () => ({
  TerminalPane: () => <div data-testid="terminal-pane" />,
  clearTerminal: vi.fn(),
  getSearchAddon: vi.fn(),
}))

vi.mock('../../components/terminal/FindBar', () => ({
  FindBar: () => null,
}))

vi.mock('../../components/pr-station/PRStationList', () => ({
  PRStationList: () => <div data-testid="pr-station-list" />,
}))

vi.mock('../../components/pr-station/PRStationDetail', () => ({
  PRStationDetail: () => <div data-testid="pr-station-detail" />,
}))

vi.mock('../../components/pr-station/PRStationActions', () => ({
  PRStationActions: () => <div data-testid="pr-station-actions" />,
}))

vi.mock('../../components/pr-station/PRStationDiff', () => ({
  PRStationDiff: () => <div data-testid="pr-station-diff" />,
}))

vi.mock('../../components/pr-station/ReviewSubmitDialog', () => ({
  ReviewSubmitDialog: () => null,
}))

vi.mock('../../stores/pendingReview', () => ({
  usePendingReviewStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ pendingComments: new Map() })
  ),
}))

// Mock window.api for views that use it — assign directly to preserve window methods
Object.defineProperty(window, 'api', {
  value: {
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
    getAgentConfig: vi.fn().mockResolvedValue({ binary: 'claude', permissionMode: 'bypassPermissions' }),
    saveAgentConfig: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn(),
    pollPrStatuses: vi.fn().mockResolvedValue([]),
    getPrList: vi.fn().mockResolvedValue({ prs: [], checks: {} }),
    refreshPrList: vi.fn().mockResolvedValue({ prs: [], checks: {} }),
    onPrListUpdated: vi.fn().mockReturnValue(() => {}),
    sprint: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      readLog: vi.fn().mockResolvedValue({ content: '', status: '' }),
      readSpecFile: vi.fn().mockResolvedValue(''),
      healthCheck: vi.fn().mockResolvedValue([]),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getJson: vi.fn().mockResolvedValue(null),
      setJson: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    github: {
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200, body: {}, linkNext: null }),
    },
    openDirectoryDialog: vi.fn().mockResolvedValue(null),
    onExternalSprintChange: vi.fn().mockReturnValue(() => {}),
    templates: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    },
    agentManager: {
      status: vi.fn().mockResolvedValue({ running: false, concurrency: null, activeAgents: [] }),
      kill: vi.fn().mockResolvedValue({ ok: true }),
    },
  },
  writable: true,
  configurable: true,
})

// ---------- Imports ----------

import { AgentsView } from '../AgentsView'
import SprintView from '../SprintView'
import MemoryView from '../MemoryView'
import CostView from '../CostView'
import SettingsView from '../SettingsView'
import { TerminalView } from '../TerminalView'
import PRStationView from '../PRStationView'

// ---------- Tests ----------

describe('View smoke tests', () => {
  it('AgentsView renders without crashing', () => {
    const { container } = render(<AgentsView />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.innerHTML).not.toBe('')
  })

  it('SprintView renders without crashing', () => {
    const { container } = render(<SprintView />)
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

  it('PRStationView renders without crashing', () => {
    const { container } = render(<PRStationView />)
    expect(container.firstChild).toBeInTheDocument()
    expect(container.innerHTML).not.toBe('')
  })
})
