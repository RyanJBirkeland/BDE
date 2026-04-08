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
    observe(): void {
      /* noop */
    }
    unobserve(): void {
      /* noop */
    }
    disconnect(): void {
      /* noop */
    }
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
  getAgentProcesses: vi.fn().mockResolvedValue([]),
  spawnLocalAgent: vi
    .fn()
    .mockResolvedValue({ pid: 1234, logPath: '/tmp/log', id: 'agent-1', interactive: false }),
  steerAgent: vi.fn().mockResolvedValue({ ok: true }),
  tailAgentLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
  setTitle: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  openPlaygroundInBrowser: vi.fn().mockResolvedValue('/tmp/bde-playground-123.html'),
  getDiff: vi.fn().mockResolvedValue(''),
  getBranch: vi.fn().mockResolvedValue('main'),
  getLog: vi.fn().mockResolvedValue(''),
  readSprintMd: vi.fn().mockResolvedValue(''),
  listMemoryFiles: vi.fn().mockResolvedValue([]),
  readMemoryFile: vi.fn().mockResolvedValue(''),
  writeMemoryFile: vi.fn().mockResolvedValue(undefined),
  searchMemory: vi.fn().mockResolvedValue([]),
  getActiveMemoryFiles: vi.fn().mockResolvedValue({}),
  setMemoryFileActive: vi.fn().mockResolvedValue({}),
  onGitHubRateLimitWarning: vi.fn().mockReturnValue(() => {}),
  onGitHubTokenExpired: vi.fn().mockReturnValue(() => {}),
  openFileDialog: vi.fn().mockResolvedValue([]),
  readFileAsBase64: vi.fn().mockResolvedValue({ data: '', mimeType: 'image/png' }),
  readFileAsText: vi.fn().mockResolvedValue({ content: '' }),
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
    healthCheck: vi.fn().mockResolvedValue([]),
    unblockTask: vi.fn().mockResolvedValue({})
  },
  cost: {
    summary: vi.fn().mockResolvedValue({
      tasksToday: 0,
      tasksThisWeek: 0,
      tasksAllTime: 0,
      totalTokensThisWeek: 0,
      avgTokensPerTask: null,
      mostTokenIntensiveTask: null
    }),
    agentRuns: vi.fn().mockResolvedValue([]),
    getAgentHistory: vi.fn().mockResolvedValue([])
  },
  settings: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getJson: vi.fn().mockResolvedValue(null),
    setJson: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  github: {
    fetch: vi.fn().mockResolvedValue({ ok: true, status: 200, body: {}, linkNext: null }),
    isConfigured: vi.fn().mockResolvedValue(true)
  },
  openDirectoryDialog: vi.fn().mockResolvedValue(null),
  pollPrStatuses: vi.fn().mockResolvedValue([]),
  getPrList: vi.fn().mockResolvedValue({ prs: [], checks: {} }),
  killAgent: vi.fn().mockResolvedValue({ ok: true }),
  onExternalSprintChange: vi.fn().mockReturnValue(() => {}),
  agentManager: {
    status: vi.fn().mockResolvedValue({
      running: false,
      shuttingDown: false,
      concurrency: {
        maxSlots: 0,
        effectiveSlots: 0,
        activeCount: 0,
        recoveryDueAt: null,
        consecutiveRateLimits: 0,
        atFloor: false
      },
      activeAgents: []
    }),
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
    recentEvents: vi.fn().mockResolvedValue([]),
    dailySuccessRate: vi.fn().mockResolvedValue([])
  },
  system: {
    loadAverage: vi.fn().mockResolvedValue({ samples: [], cpuCount: 8 })
  },
  claudeConfig: {
    get: vi.fn().mockResolvedValue({}),
    setPermissions: vi.fn().mockResolvedValue(undefined)
  },
  review: {
    getDiff: vi.fn().mockResolvedValue({ files: [] }),
    getFileDiff: vi.fn().mockResolvedValue({ diff: '' }),
    getCommits: vi.fn().mockResolvedValue({ commits: [] }),
    mergeLocally: vi.fn().mockResolvedValue({ success: true }),
    createPr: vi.fn().mockResolvedValue({ prUrl: 'https://github.com/test/pr/1' }),
    requestRevision: vi.fn().mockResolvedValue(undefined),
    discard: vi.fn().mockResolvedValue(undefined),
    checkFreshness: vi.fn().mockResolvedValue({ status: 'fresh', commitsBehind: 0 }),
    shipIt: vi.fn().mockResolvedValue({ success: true, pushed: true }),
    rebase: vi.fn().mockResolvedValue({ success: true })
  },
  watchDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
  onDirChanged: vi.fn().mockReturnValue(() => {}),
  tearoff: {
    getWindowInfo: vi.fn().mockResolvedValue(null),
    notifyReady: vi.fn(),
    onTabDrop: vi.fn().mockReturnValue(() => {})
  },
  groups: {
    create: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    addTask: vi.fn().mockResolvedValue(true),
    removeTask: vi.fn().mockResolvedValue(true),
    getGroupTasks: vi.fn().mockResolvedValue([]),
    queueAll: vi.fn().mockResolvedValue(0)
  },
  webhooks: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: 'test-webhook',
      url: 'https://',
      events: [],
      enabled: true,
      secret: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    test: vi.fn().mockResolvedValue(undefined)
  }
})
