import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Electron mock — capture every ipcMain.handle / ipcMain.on registration
// ---------------------------------------------------------------------------
const handlers = new Map<string, Function>()
const onListeners = new Map<string, Function>()

const mockSend = vi.fn()
const mockSetTitle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: Function) => onListeners.set(channel, handler))
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ id: 1, webContents: { send: mockSend } }]),
    getFocusedWindow: vi.fn(() => ({ setTitle: mockSetTitle })),
    fromWebContents: vi.fn(() => ({ id: 1 }))
  },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  dialog: { showErrorBox: vi.fn() },
  app: { quit: vi.fn() }
}))

// ---------------------------------------------------------------------------
// Mock underlying modules — we're testing wiring, not business logic
// ---------------------------------------------------------------------------

vi.mock('../runner-client', () => ({
  listAgents: vi.fn().mockResolvedValue([]),
  steerAgent: vi.fn().mockResolvedValue({ ok: true }),
  killAgent: vi.fn().mockResolvedValue({ ok: true })
}))

vi.mock('../agent-log-manager', () => ({
  tailAgentLog: vi.fn().mockResolvedValue({ content: 'log data', nextByte: 42 }),
  cleanupOldLogs: vi.fn()
}))

vi.mock('../agent-history', () => ({
  listAgents: vi.fn().mockResolvedValue([]),
  getAgentMeta: vi.fn().mockResolvedValue(null),
  readLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
  importAgent: vi.fn().mockResolvedValue({ id: 'imported-1' }),
  updateAgentMeta: vi.fn(),
  pruneOldAgents: vi.fn()
}))

vi.mock('../adhoc-agent', () => ({
  spawnAdhocAgent: vi
    .fn()
    .mockResolvedValue({ id: 'test-id', pid: 0, logPath: '/tmp/log', interactive: true }),
  getAdhocHandle: vi.fn()
}))

vi.mock('../data/event-queries', () => ({
  getEventHistory: vi.fn().mockReturnValue([])
}))

vi.mock('../git', () => ({
  getRepoPaths: vi.fn().mockReturnValue({ bde: '/tmp/bde' }),
  gitStatus: vi.fn().mockResolvedValue({ files: [] }),
  gitDiffFile: vi.fn().mockResolvedValue('diff content'),
  gitStage: vi.fn().mockResolvedValue(undefined),
  gitUnstage: vi.fn().mockResolvedValue(undefined),
  gitCommit: vi.fn().mockResolvedValue(undefined),
  gitPush: vi.fn().mockResolvedValue('push output'),
  gitBranches: vi.fn().mockResolvedValue({ current: 'main', branches: ['main'] }),
  gitCheckout: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../github-pr-status', () => ({
  pollPrStatuses: vi.fn().mockResolvedValue([])
}))

vi.mock('../github-conflict-check', () => ({
  checkConflictFiles: vi
    .fn()
    .mockResolvedValue({ prNumber: 0, files: [], baseBranch: '', headBranch: '' })
}))

vi.mock('../config', () => ({
  getGitHubToken: vi.fn().mockReturnValue('gh-token')
}))

vi.mock('../db', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({ id: '1', title: 'task' }),
      run: vi.fn().mockReturnValue({ changes: 1 })
    })
  })
}))

const { mockGetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn().mockReturnValue(null)
}))
vi.mock('../settings', () => ({
  getSetting: mockGetSetting,
  setSetting: vi.fn(),
  getSettingJson: vi.fn().mockReturnValue(null),
  setSettingJson: vi.fn(),
  deleteSetting: vi.fn(),
  SETTING_RUNNERS: 'runners',
  SETTING_SUPABASE_URL: 'supabase.url',
  SETTING_SUPABASE_KEY: 'supabase.serviceKey'
}))

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('log content'),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 100, mtimeMs: Date.now() }),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('')
  }
})

// node-pty mock for terminal handlers — vi.mock cannot intercept CJS require(),
// so we inject the mock via _setPty after import
const mockPtyProcess = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn()
}
const mockPtySpawn = vi.fn().mockReturnValue(mockPtyProcess)

// ---------------------------------------------------------------------------
// Import the registration functions AFTER mocks are set up
// ---------------------------------------------------------------------------
import { shell } from 'electron'
import * as agentLogManager from '../agent-log-manager'
import * as agentHistory from '../agent-history'
import * as git from '../git'
import * as githubPrStatus from '../github-pr-status'
import { registerAgentHandlers } from '../handlers/agent-handlers'
import { registerGitHandlers } from '../handlers/git-handlers'
import { registerConfigHandlers } from '../handlers/config-handlers'
import { registerWindowHandlers } from '../handlers/window-handlers'
import { registerTerminalHandlers, _setPty } from '../handlers/terminal-handlers'
import { registerFsHandlers } from '../fs'

// Fake IPC event object (sender needed by terminal-handlers for BrowserWindow.fromWebContents)
const fakeEvent = { sender: {} } as Electron.IpcMainInvokeEvent

// Track startup side-effects (captured before beforeEach clears mocks)
let startupCleanupCalled = false
let startupPruneCalled = false

// ---------------------------------------------------------------------------
// Helper: invoke a captured handler
// ---------------------------------------------------------------------------
function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for "${channel}"`)
  return handler(fakeEvent, ...args)
}

function emit(channel: string, ...args: unknown[]): void {
  const listener = onListeners.get(channel)
  if (!listener) throw new Error(`No listener registered for "${channel}"`)
  listener(fakeEvent, ...args)
}

// ===========================================================================
// Tests
// ===========================================================================

describe('IPC handler registration', () => {
  beforeAll(() => {
    handlers.clear()
    onListeners.clear()

    // Inject mock pty before registering terminal handlers (vi.mock can't intercept CJS require)
    _setPty({ spawn: mockPtySpawn } as never)

    registerAgentHandlers()
    registerGitHandlers()
    registerConfigHandlers()
    registerWindowHandlers()
    registerTerminalHandlers()
    registerFsHandlers()

    // Capture startup side-effect state before beforeEach clears mocks
    startupCleanupCalled = vi.mocked(agentLogManager.cleanupOldLogs).mock.calls.length > 0
    startupPruneCalled = vi.mocked(agentHistory.pruneOldAgents).mock.calls.length > 0
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // safeHandle wrapper
  // -------------------------------------------------------------------------
  describe('safeHandle wrapper', () => {
    it('registers handlers on ipcMain.handle', () => {
      expect(handlers.size).toBeGreaterThan(0)
    })

    it('returns handler result on success', async () => {
      const result = await invoke('local:getAgentProcesses')
      expect(result).toEqual([])
    })

    it('re-throws errors to the renderer (does not swallow)', async () => {
      vi.mocked(agentHistory.readLog).mockRejectedValueOnce(new Error('not found'))
      await expect(invoke('agents:readLog', { id: 'nonexistent' })).rejects.toThrow('not found')
    })

    it('logs errors to console on handler throw', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(agentHistory.readLog).mockRejectedValueOnce(new Error('test error'))
      await expect(invoke('agents:readLog', { id: 'bad' })).rejects.toThrow()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ipc]'),
        expect.stringContaining('[agents:readLog] unhandled error')
      )
      consoleSpy.mockRestore()
    })
  })

  // -------------------------------------------------------------------------
  // agent-handlers.ts
  // -------------------------------------------------------------------------
  describe('agent-handlers', () => {
    it('registers all expected channel names', () => {
      const expected = [
        'local:getAgentProcesses',
        'local:spawnClaudeAgent',
        'local:tailAgentLog',
        'agent:steer',
        'agent:kill',
        'agent:history',
        'agents:list',
        'agents:readLog',
        'agents:import'
      ]
      for (const ch of expected) {
        expect(handlers.has(ch), `missing channel: ${ch}`).toBe(true)
      }
    })

    it('"agents:list" calls listAgents with (limit, status)', async () => {
      await invoke('agents:list', { limit: 10, status: 'running' })
      expect(agentHistory.listAgents).toHaveBeenCalledWith(10, 'running')
    })

    it('"local:spawnClaudeAgent" calls spawnAdhocAgent and returns result', async () => {
      const result = await invoke('local:spawnClaudeAgent', {
        repoPath: '/tmp/bde',
        task: 'fix bug'
      })
      expect(result).toEqual({ id: 'test-id', pid: 0, logPath: '/tmp/log', interactive: true })
    })

    it('"local:tailAgentLog" calls tailAgentLog with args', async () => {
      const args = { logPath: '/tmp/log.txt', fromByte: 0 }
      const result = await invoke('local:tailAgentLog', args)
      expect(agentLogManager.tailAgentLog).toHaveBeenCalledWith(args)
      expect(result).toEqual({ content: 'log data', nextByte: 42 })
    })

    it('"agents:readLog" calls readLog with (id, fromByte)', async () => {
      await invoke('agents:readLog', { id: 'abc', fromByte: 100 })
      expect(agentHistory.readLog).toHaveBeenCalledWith('abc', 100)
    })

    it('"agents:import" calls importAgent with (meta, content)', async () => {
      const meta = { bin: 'claude', task: 'test' }
      const content = 'log content'
      const result = await invoke('agents:import', { meta, content })
      expect(agentHistory.importAgent).toHaveBeenCalledWith(meta, content)
      expect(result).toEqual({ id: 'imported-1' })
    })

    it('calls cleanupOldLogs() during registration (startup)', () => {
      expect(startupCleanupCalled).toBe(true)
    })

    it('calls pruneOldAgents() during registration (startup)', () => {
      expect(startupPruneCalled).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // git-handlers.ts
  // -------------------------------------------------------------------------
  describe('git-handlers', () => {
    it('registers all expected channel names', () => {
      const expected = [
        'git:getRepoPaths',
        'git:status',
        'git:diff',
        'git:stage',
        'git:unstage',
        'git:commit',
        'git:push',
        'git:branches',
        'git:checkout',
        'pr:pollStatuses'
      ]
      for (const ch of expected) {
        expect(handlers.has(ch), `missing channel: ${ch}`).toBe(true)
      }
    })

    it('"git:getRepoPaths" calls getRepoPaths', async () => {
      const result = await invoke('git:getRepoPaths')
      expect(git.getRepoPaths).toHaveBeenCalled()
      expect(result).toEqual({ bde: '/tmp/bde' })
    })

    it('"git:status" passes validated cwd to gitStatus', async () => {
      await invoke('git:status', '/tmp/bde')
      expect(git.gitStatus).toHaveBeenCalledWith(resolve('/tmp/bde'))
    })

    it('"git:diff" passes (validated cwd, file) to gitDiffFile', async () => {
      await invoke('git:diff', '/tmp/bde', 'src/app.ts')
      expect(git.gitDiffFile).toHaveBeenCalledWith(resolve('/tmp/bde'), 'src/app.ts')
    })

    it('"git:stage" passes (validated cwd, files) to gitStage', async () => {
      await invoke('git:stage', '/tmp/bde', ['file1.ts', 'file2.ts'])
      expect(git.gitStage).toHaveBeenCalledWith(resolve('/tmp/bde'), ['file1.ts', 'file2.ts'])
    })

    it('"git:unstage" passes (validated cwd, files) to gitUnstage', async () => {
      await invoke('git:unstage', '/tmp/bde', ['file1.ts'])
      expect(git.gitUnstage).toHaveBeenCalledWith(resolve('/tmp/bde'), ['file1.ts'])
    })

    it('"git:commit" passes (validated cwd, message) to gitCommit', async () => {
      await invoke('git:commit', '/tmp/bde', 'fix: bug')
      expect(git.gitCommit).toHaveBeenCalledWith(resolve('/tmp/bde'), 'fix: bug')
    })

    it('"git:push" passes validated cwd to gitPush', async () => {
      const result = await invoke('git:push', '/tmp/bde')
      expect(git.gitPush).toHaveBeenCalledWith(resolve('/tmp/bde'))
      expect(result).toBe('push output')
    })

    it('"git:branches" passes validated cwd to gitBranches', async () => {
      const result = await invoke('git:branches', '/tmp/bde')
      expect(git.gitBranches).toHaveBeenCalledWith(resolve('/tmp/bde'))
      expect(result).toEqual({ current: 'main', branches: ['main'] })
    })

    it('"git:checkout" passes (validated cwd, branch) to gitCheckout', async () => {
      await invoke('git:checkout', '/tmp/bde', 'feat/new')
      expect(git.gitCheckout).toHaveBeenCalledWith(resolve('/tmp/bde'), 'feat/new')
    })

    it('"pr:pollStatuses" passes prs to pollPrStatuses', async () => {
      const prs = [{ owner: 'o', repo: 'r', prNumber: 1 }]
      await invoke('pr:pollStatuses', prs)
      expect(githubPrStatus.pollPrStatuses).toHaveBeenCalledWith(prs)
    })

    it('rejects cwd outside known repository paths', async () => {
      await expect(invoke('git:status', '/etc/evil')).rejects.toThrow('Path rejected')
    })

    it('error in gitStatus propagates via safeHandle', async () => {
      vi.mocked(git.gitStatus).mockRejectedValueOnce(new Error('not a git repo'))
      await expect(invoke('git:status', '/tmp/bde')).rejects.toThrow('not a git repo')
    })
  })

  // -------------------------------------------------------------------------
  // config-handlers.ts
  // -------------------------------------------------------------------------
  describe('config-handlers', () => {
    it('does not register removed gateway channels', () => {
      expect(handlers.has('config:getGatewayUrl')).toBe(false)
      expect(handlers.has('config:saveGateway')).toBe(false)
      expect(handlers.has('config:getGateway')).toBe(false)
      expect(handlers.has('config:getGithubToken')).toBe(false)
      expect(handlers.has('config:getSupabase')).toBe(false)
    })

    it('registers settings CRUD channels', () => {
      expect(handlers.has('settings:get')).toBe(true)
      expect(handlers.has('settings:set')).toBe(true)
      expect(handlers.has('settings:getJson')).toBe(true)
      expect(handlers.has('settings:setJson')).toBe(true)
      expect(handlers.has('settings:delete')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // window-handlers.ts
  // -------------------------------------------------------------------------
  describe('window-handlers', () => {
    it('registers expected channel names', () => {
      expect(handlers.has('window:openExternal')).toBe(true)
      expect(onListeners.has('window:setTitle')).toBe(true)
    })

    it('"window:openExternal" calls shell.openExternal with https URL', async () => {
      await invoke('window:openExternal', 'https://example.com')
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
    })

    it('"window:openExternal" rejects disallowed URL schemes', async () => {
      await expect(invoke('window:openExternal', 'file:///etc/passwd')).rejects.toThrow(
        'Blocked URL scheme'
      )
      await expect(invoke('window:openExternal', 'javascript:alert(1)')).rejects.toThrow(
        'Blocked URL scheme'
      )
    })

    it('"window:setTitle" sets window title via ipcMain.on listener', () => {
      emit('window:setTitle', 'New Title')
      expect(mockSetTitle).toHaveBeenCalledWith('New Title')
    })
  })

  // -------------------------------------------------------------------------
  // terminal-handlers.ts
  // NOTE: PTY lifecycle is covered by TQ-S5. Here we test wiring only.
  // -------------------------------------------------------------------------
  describe('terminal-handlers', () => {
    it('registers all expected channel names', () => {
      expect(handlers.has('terminal:create')).toBe(true)
      expect(handlers.has('terminal:resize')).toBe(true)
      expect(handlers.has('terminal:kill')).toBe(true)
      expect(onListeners.has('terminal:write')).toBe(true)
    })

    it('"terminal:create" returns a numeric id', async () => {
      const id = await invoke('terminal:create', { cols: 80, rows: 24 })
      expect(typeof id).toBe('number')
      expect(id).toBeGreaterThan(0)
    })

    it('"terminal:create" increments ids across calls', async () => {
      const id1 = await invoke('terminal:create', { cols: 80, rows: 24 })
      const id2 = await invoke('terminal:create', { cols: 80, rows: 24 })
      expect(id2).toBeGreaterThan(id1 as number)
    })

    it('"terminal:write" does not throw for valid terminal', async () => {
      const id = await invoke('terminal:create', { cols: 80, rows: 24 })
      // terminal:write uses ipcMain.on — it should not throw
      expect(() => emit('terminal:write', { id, data: 'ls\n' })).not.toThrow()
    })

    it('"terminal:create" rejects disallowed shell binary', async () => {
      await expect(
        invoke('terminal:create', { cols: 80, rows: 24, shell: '/tmp/evil-shell' })
      ).rejects.toThrow('Shell not allowed')
    })

    it('"terminal:kill" does not throw', async () => {
      const id = await invoke('terminal:create', { cols: 80, rows: 24 })
      await expect(invoke('terminal:kill', id)).resolves.not.toThrow()
    })

    it('"terminal:resize" does not throw', async () => {
      const id = await invoke('terminal:create', { cols: 80, rows: 24 })
      await expect(invoke('terminal:resize', { id, cols: 200, rows: 50 })).resolves.not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // fs handlers (fs.ts)
  // -------------------------------------------------------------------------
  describe('fs-handlers', () => {
    it('registers all expected channel names', () => {
      const expected = ['memory:listFiles', 'memory:readFile', 'memory:writeFile']
      for (const ch of expected) {
        expect(handlers.has(ch), `missing channel: ${ch}`).toBe(true)
      }
    })

    it('"memory:listFiles" handler is registered and callable', async () => {
      const result = await invoke('memory:listFiles')
      expect(Array.isArray(result)).toBe(true)
    })

    it('"memory:readFile" rejects path traversal', async () => {
      await expect(invoke('memory:readFile', '../../etc/passwd')).rejects.toThrow(
        'Path traversal blocked'
      )
    })

    it('"memory:writeFile" rejects path traversal', async () => {
      await expect(invoke('memory:writeFile', '../../../etc/evil', 'bad')).rejects.toThrow(
        'Path traversal blocked'
      )
    })
  })
})
