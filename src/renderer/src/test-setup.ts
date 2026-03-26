import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Ensure localStorage is available before any store modules load.
// jsdom provides localStorage but it may not be fully functional when the
// --localstorage-file flag is used without a valid path.
if (
  typeof globalThis.localStorage === 'undefined' ||
  typeof globalThis.localStorage.getItem !== 'function'
) {
  const store: Record<string, string> = {}
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k])
    },
    get length() {
      return Object.keys(store).length
    },
    key: (i: number) => Object.keys(store)[i] ?? null
  } as Storage
}

afterEach(() => cleanup())

// ResizeObserver is not available in jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// scrollIntoView is not available in jsdom
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

// Global window.api mock (centralized — no more per-file duplication)
vi.stubGlobal('api', {
  getRepoPaths: vi.fn().mockResolvedValue({
    bde: '/Users/test/Documents/Repositories/BDE',
    'life-os': '/Users/test/Documents/Repositories/life-os',
    feast: '/Users/test/Documents/Repositories/feast'
  }),
  agents: {
    list: vi.fn().mockResolvedValue([]),
    getMeta: vi.fn().mockResolvedValue(null),
    readLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
    import: vi.fn().mockResolvedValue({}),
    markDone: vi.fn().mockResolvedValue(undefined)
  },
  agentEvents: {
    onEvent: vi.fn().mockReturnValue(() => {}),
    getHistory: vi.fn().mockResolvedValue([])
  },
  templates: {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined)
  },
  getAgentConfig: vi
    .fn()
    .mockResolvedValue({ binary: 'claude', permissionMode: 'bypassPermissions' }),
  saveAgentConfig: vi.fn().mockResolvedValue(undefined),
  getAgentProcesses: vi.fn().mockResolvedValue([]),
  spawnLocalAgent: vi
    .fn()
    .mockResolvedValue({ pid: 1234, logPath: '/tmp/log', id: 'agent-1', interactive: false }),
  sendToAgent: vi.fn().mockResolvedValue({ ok: true }),
  steerAgent: vi.fn().mockResolvedValue({ ok: true }),
  isAgentInteractive: vi.fn().mockResolvedValue(false),
  killLocalAgent: vi.fn().mockResolvedValue({ ok: true }),
  tailAgentLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
  setTitle: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  getDiff: vi.fn().mockResolvedValue(''),
  getBranch: vi.fn().mockResolvedValue('main'),
  getLog: vi.fn().mockResolvedValue(''),
  readSprintMd: vi.fn().mockResolvedValue(''),
  listMemoryFiles: vi.fn().mockResolvedValue([]),
  readMemoryFile: vi.fn().mockResolvedValue(''),
  writeMemoryFile: vi.fn().mockResolvedValue(undefined),
  gitStatus: vi.fn().mockResolvedValue({ files: [] }),
  gitDiff: vi.fn().mockResolvedValue(''),
  gitStage: vi.fn().mockResolvedValue(undefined),
  gitUnstage: vi.fn().mockResolvedValue(undefined),
  gitCommit: vi.fn().mockResolvedValue(undefined),
  gitPush: vi.fn().mockResolvedValue(''),
  gitBranches: vi.fn().mockResolvedValue({ current: 'main', branches: ['main'] }),
  gitCheckout: vi.fn().mockResolvedValue(undefined),
  sprint: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    claimTask: vi.fn().mockResolvedValue(null),
    readLog: vi.fn().mockResolvedValue({ content: '', status: 'unknown', nextByte: 0 }),
    readSpecFile: vi.fn().mockResolvedValue(''),
    generatePrompt: vi.fn().mockResolvedValue({ taskId: '', spec: '', prompt: '' }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
    healthCheck: vi.fn().mockResolvedValue([])
  },
  cost: {
    summary: vi.fn().mockResolvedValue({
      tasksToday: 0,
      tasksThisWeek: 0,
      tasksAllTime: 0,
      totalTokensThisWeek: 0,
      avgCostPerTask: null,
      mostExpensiveTask: null
    }),
    agentRuns: vi.fn().mockResolvedValue([])
  },
  settings: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getJson: vi.fn().mockResolvedValue(null),
    setJson: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  github: {
    fetch: vi.fn().mockResolvedValue({ ok: true, status: 200, body: {}, linkNext: null })
  },
  openDirectoryDialog: vi.fn().mockResolvedValue(null),
  pollPrStatuses: vi.fn().mockResolvedValue([]),
  getPrList: vi.fn().mockResolvedValue({ prs: [], checks: {} }),
  killAgent: vi.fn().mockResolvedValue({ ok: true }),
  onExternalSprintChange: vi.fn().mockReturnValue(() => {}),
  agentManager: {
    status: vi.fn().mockResolvedValue({ running: false, concurrency: null, activeAgents: [] }),
    kill: vi.fn().mockResolvedValue({ ok: true })
  },
  terminal: {
    create: vi.fn().mockResolvedValue(1),
    write: vi.fn(),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn().mockReturnValue(() => {}),
    onExit: vi.fn()
  },
  dashboard: {
    completionsPerHour: vi.fn().mockResolvedValue([]),
    recentEvents: vi.fn().mockResolvedValue([])
  }
})
