import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => cleanup())

// Global window.api mock (centralized — no more per-file duplication)
vi.stubGlobal('api', {
  getGatewayConfig: vi.fn().mockResolvedValue({ url: 'ws://localhost:18789', token: 'test' }),
  getRepoPaths: vi.fn().mockResolvedValue({
    bde: '/Users/test/Documents/Repositories/BDE',
    'life-os': '/Users/test/Documents/Repositories/life-os',
    feast: '/Users/test/Documents/Repositories/feast',
  }),
  agents: {
    list: vi.fn().mockResolvedValue([]),
    getMeta: vi.fn().mockResolvedValue(null),
    readLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
    import: vi.fn().mockResolvedValue({}),
    markDone: vi.fn().mockResolvedValue(undefined),
  },
  getAgentProcesses: vi.fn().mockResolvedValue([]),
  spawnLocalAgent: vi.fn().mockResolvedValue({ pid: 1234, logPath: '/tmp/log', id: 'agent-1', interactive: false }),
  sendToAgent: vi.fn().mockResolvedValue({ ok: true }),
  steerAgent: vi.fn().mockResolvedValue({ ok: true }),
  isAgentInteractive: vi.fn().mockResolvedValue(false),
  killLocalAgent: vi.fn().mockResolvedValue({ ok: true }),
  tailAgentLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
  invokeTool: vi.fn().mockResolvedValue({}),
  setTitle: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  getDiff: vi.fn().mockResolvedValue(''),
  getBranch: vi.fn().mockResolvedValue('main'),
  getLog: vi.fn().mockResolvedValue(''),
  readSprintMd: vi.fn().mockResolvedValue(''),
  getGitHubToken: vi.fn().mockResolvedValue(null),
  saveGatewayConfig: vi.fn().mockResolvedValue(undefined),
  listMemoryFiles: vi.fn().mockResolvedValue([]),
  readMemoryFile: vi.fn().mockResolvedValue(''),
  writeMemoryFile: vi.fn().mockResolvedValue(undefined),
  getSessionHistory: vi.fn().mockResolvedValue([]),
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
    readLog: vi.fn().mockResolvedValue({ content: '', status: 'unknown', nextByte: 0 }),
    readSpecFile: vi.fn().mockResolvedValue(''),
    generatePrompt: vi.fn().mockResolvedValue({ taskId: '', spec: '', prompt: '' }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  },
  cost: {
    summary: vi.fn().mockResolvedValue({
      tasksToday: 0, tasksThisWeek: 0, tasksAllTime: 0,
      totalTokensThisWeek: 0, avgCostPerTask: null, mostExpensiveTask: null,
    }),
    agentRuns: vi.fn().mockResolvedValue([]),
  },
  onSprintSseEvent: vi.fn(),
  offSprintSseEvent: vi.fn(),
  terminal: {
    create: vi.fn().mockResolvedValue(1),
    write: vi.fn(),
    resize: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    onData: vi.fn().mockReturnValue(() => {}),
    onExit: vi.fn(),
  },
})
