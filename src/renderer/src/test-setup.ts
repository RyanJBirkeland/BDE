import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { nowIso } from '../../shared/time'

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
  // Git client
  git: {
    getRepoPaths: vi.fn().mockResolvedValue({
      bde: '/Users/test/Documents/Repositories/BDE',
      'life-os': '/Users/test/Documents/Repositories/life-os',
      feast: '/Users/test/Documents/Repositories/feast'
    }),
    status: vi.fn().mockResolvedValue({ files: [] }),
    diff: vi.fn().mockResolvedValue(''),
    stage: vi.fn().mockResolvedValue(undefined),
    unstage: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(''),
    branches: vi.fn().mockResolvedValue({ current: 'main', branches: ['main'] }),
    checkout: vi.fn().mockResolvedValue(undefined),
    detectRemote: vi.fn().mockResolvedValue(null),
    fetch: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined)
  },

  // Memory
  memory: {
    listFiles: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue({ results: [], timedOut: false }),
    getActiveFiles: vi.fn().mockResolvedValue({}),
    setFileActive: vi.fn().mockResolvedValue({})
  },

  // File system
  fs: {
    openFileDialog: vi.fn().mockResolvedValue([]),
    readAsBase64: vi.fn().mockResolvedValue({ data: '', mimeType: 'image/png' }),
    readAsText: vi.fn().mockResolvedValue({ content: '' }),
    openDirDialog: vi.fn().mockResolvedValue(null),
    readDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    watchDir: vi.fn().mockResolvedValue(undefined),
    unwatchDir: vi.fn().mockResolvedValue(undefined),
    createFile: vi.fn().mockResolvedValue(undefined),
    createDir: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    deletePath: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue(null),
    listFiles: vi.fn().mockResolvedValue([]),
    onDirChanged: vi.fn().mockReturnValue(() => {})
  },

  // PR lifecycle
  pr: {
    pollStatuses: vi.fn().mockResolvedValue([]),
    checkConflictFiles: vi.fn().mockResolvedValue([]),
    onListUpdated: vi.fn().mockReturnValue(() => {}),
    getList: vi.fn().mockResolvedValue({ prs: [], checks: {} }),
    refreshList: vi.fn().mockResolvedValue(undefined),
    onGitHubError: vi.fn().mockReturnValue(() => {})
  },

  // Window utilities
  window: {
    readClipboardImage: vi.fn().mockResolvedValue(null),
    openExternal: vi.fn().mockResolvedValue(undefined),
    openPlaygroundInBrowser: vi.fn().mockResolvedValue('/tmp/bde-playground-123.html'),
    setTitle: vi.fn()
  },

  // Auth
  auth: {
    status: vi.fn().mockResolvedValue({ authenticated: false })
  },

  // Spec Synthesizer
  synthesizer: {
    generate: vi.fn().mockResolvedValue({}),
    revise: vi.fn().mockResolvedValue({}),
    cancel: vi.fn().mockResolvedValue(undefined),
    onChunk: vi.fn().mockReturnValue(() => {})
  },

  // Sprint tasks
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
    unblockTask: vi.fn().mockResolvedValue({}),
    onExternalChange: vi.fn().mockReturnValue(() => {})
  },

  // Task groups
  groups: {
    create: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
    addTask: vi.fn().mockResolvedValue(true),
    removeTask: vi.fn().mockResolvedValue(true),
    getGroupTasks: vi.fn().mockResolvedValue([]),
    queueAll: vi.fn().mockResolvedValue(0),
    addDependency: vi.fn().mockResolvedValue({}),
    removeDependency: vi.fn().mockResolvedValue({}),
    updateDependencyCondition: vi.fn().mockResolvedValue({})
  },

  // Agent history + process management
  agents: {
    list: vi.fn().mockResolvedValue([]),
    getMeta: vi.fn().mockResolvedValue(null),
    readLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
    import: vi.fn().mockResolvedValue({}),
    markDone: vi.fn().mockResolvedValue(undefined),
    getProcesses: vi.fn().mockResolvedValue([]),
    spawnLocal: vi
      .fn()
      .mockResolvedValue({ pid: 1234, logPath: '/tmp/log', id: 'agent-1', interactive: false }),
    steer: vi.fn().mockResolvedValue({ ok: true }),
    kill: vi.fn().mockResolvedValue({ ok: true }),
    getLatestCacheTokens: vi.fn().mockResolvedValue(null),
    tailLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
    events: {
      onEvent: vi.fn().mockReturnValue(() => {}),
      getHistory: vi.fn().mockResolvedValue([])
    }
  },

  // Agent Manager
  agentManager: {
    status: vi.fn().mockResolvedValue({
      running: false,
      shuttingDown: false,
      concurrency: {
        maxSlots: 0,
        capacityAfterBackpressure: 0,
        activeCount: 0,
        recoveryScheduledAt: null,
        consecutiveRateLimits: 0,
        atMinimumCapacity: false
      }
    }),
    kill: vi.fn().mockResolvedValue({ ok: true })
  },

  // Cost analytics
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

  // Templates
  templates: {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined)
  },

  // Dashboard analytics
  dashboard: {
    completionsPerHour: vi.fn().mockResolvedValue([]),
    recentEvents: vi.fn().mockResolvedValue([]),
    dailySuccessRate: vi.fn().mockResolvedValue([])
  },

  // System metrics
  system: {
    loadAverage: vi.fn().mockResolvedValue({ samples: [], cpuCount: 8 })
  },

  // Settings
  settings: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getJson: vi.fn().mockResolvedValue(null),
    setJson: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  },

  // Claude CLI config
  claudeConfig: {
    get: vi.fn().mockResolvedValue({}),
    setPermissions: vi.fn().mockResolvedValue(undefined)
  },

  // GitHub API proxy
  github: {
    fetch: vi.fn().mockResolvedValue({ ok: true, status: 200, body: {}, linkNext: null }),
    isConfigured: vi.fn().mockResolvedValue(true)
  },

  // Code Review
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

  // Terminal PTY
  terminal: {
    create: vi.fn().mockResolvedValue(1),
    write: vi.fn(),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn().mockReturnValue(() => {}),
    onExit: vi.fn()
  },

  // Tear-off
  tearoff: {
    getWindowInfo: vi.fn().mockResolvedValue(null),
    notifyReady: vi.fn(),
    onTabDrop: vi.fn().mockReturnValue(() => {})
  },

  // Webhooks
  webhooks: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: 'test-webhook',
      url: 'https://',
      events: [],
      enabled: true,
      secret: null,
      created_at: nowIso(),
      updated_at: nowIso()
    }),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    test: vi.fn().mockResolvedValue(undefined)
  },

  // Repository discovery
  repoDiscovery: {
    scanLocal: vi.fn().mockResolvedValue([]),
    listGithub: vi.fn().mockResolvedValue([]),
    clone: vi.fn().mockResolvedValue(undefined),
    onCloneProgress: vi.fn().mockReturnValue(() => {})
  }
})
