import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

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
    on: vi.fn((channel: string, handler: Function) => onListeners.set(channel, handler)),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: { send: mockSend } }]),
    getFocusedWindow: vi.fn(() => ({ setTitle: mockSetTitle })),
  },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
  dialog: { showErrorBox: vi.fn() },
  app: { quit: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Mock underlying modules — we're testing wiring, not business logic
// ---------------------------------------------------------------------------

vi.mock('../local-agents', () => ({
  getAgentProcesses: vi.fn().mockResolvedValue([]),
  spawnClaudeAgent: vi.fn().mockResolvedValue({ pid: 123, logPath: '/tmp/log', id: 'abc' }),
  tailAgentLog: vi.fn().mockResolvedValue({ content: 'log data', nextByte: 42 }),
  sendToAgent: vi.fn().mockReturnValue({ ok: true }),
  isAgentInteractive: vi.fn().mockReturnValue(true),
  cleanupOldLogs: vi.fn(),
}))

vi.mock('../agent-history', () => ({
  listAgents: vi.fn().mockResolvedValue([]),
  getAgentMeta: vi.fn().mockResolvedValue(null),
  readLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
  importAgent: vi.fn().mockResolvedValue({ id: 'imported-1' }),
  updateAgentMeta: vi.fn(),
  pruneOldAgents: vi.fn(),
}))

vi.mock('../git', () => ({
  getRepoPaths: vi.fn().mockReturnValue({ bde: '/tmp/bde' }),
  gitStatus: vi.fn().mockReturnValue({ files: [] }),
  gitDiffFile: vi.fn().mockReturnValue('diff content'),
  gitStage: vi.fn(),
  gitUnstage: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn().mockReturnValue('push output'),
  gitBranches: vi.fn().mockReturnValue({ current: 'main', branches: ['main'] }),
  gitCheckout: vi.fn(),
  pollPrStatuses: vi.fn().mockResolvedValue([]),
}))

vi.mock('../config', () => ({
  getGatewayConfig: vi.fn().mockReturnValue({ url: 'ws://localhost:18789', token: 'test-token' }),
  getGitHubToken: vi.fn().mockReturnValue('gh-token'),
  saveGatewayConfig: vi.fn(),
  getSupabaseConfig: vi.fn().mockReturnValue(null),
}))

vi.mock('../db', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({ id: '1', title: 'task' }),
      run: vi.fn().mockReturnValue({ changes: 1 }),
    }),
  }),
}))

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('log content'),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 100, mtimeMs: Date.now() }),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(''),
}))

// node-pty mock for terminal handlers — use top-level refs so
// require('node-pty') in terminal-handlers.ts gets the SAME fn instances
const mockPtyProcess = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
}
const mockPtySpawn = vi.fn().mockReturnValue(mockPtyProcess)

vi.mock('node-pty', () => ({ spawn: mockPtySpawn }))

// ---------------------------------------------------------------------------
// Import the registration functions AFTER mocks are set up
// ---------------------------------------------------------------------------
import { shell } from 'electron'
import * as localAgents from '../local-agents'
import * as agentHistory from '../agent-history'
import * as git from '../git'
import * as config from '../config'
import { registerAgentHandlers } from '../handlers/agent-handlers'
import { registerGitHandlers } from '../handlers/git-handlers'
import { registerConfigHandlers } from '../handlers/config-handlers'
import { registerGatewayHandlers } from '../handlers/gateway-handlers'
import { registerWindowHandlers } from '../handlers/window-handlers'
import { registerTerminalHandlers } from '../handlers/terminal-handlers'
import { registerFsHandlers } from '../fs'

// Fake IPC event object
const fakeEvent = {} as Electron.IpcMainInvokeEvent

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

    registerAgentHandlers()
    registerGitHandlers()
    registerConfigHandlers()
    registerGatewayHandlers()
    registerWindowHandlers()
    registerTerminalHandlers()
    registerFsHandlers()

    // Capture startup side-effect state before beforeEach clears mocks
    startupCleanupCalled = vi.mocked(localAgents.cleanupOldLogs).mock.calls.length > 0
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
      vi.mocked(localAgents.getAgentProcesses).mockRejectedValueOnce(
        new Error('boom')
      )
      await expect(invoke('local:getAgentProcesses')).rejects.toThrow('boom')
    })

    it('logs errors to console on handler throw', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(localAgents.getAgentProcesses).mockRejectedValueOnce(
        new Error('logged error')
      )
      await expect(invoke('local:getAgentProcesses')).rejects.toThrow()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[IPC:local:getAgentProcesses]'),
        expect.any(Error)
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
        'local:sendToAgent',
        'local:isInteractive',
        'agents:list',
        'agents:readLog',
        'agents:import',
      ]
      for (const ch of expected) {
        expect(handlers.has(ch), `missing channel: ${ch}`).toBe(true)
      }
    })

    it('"agents:list" calls listAgents with (limit, status)', async () => {
      await invoke('agents:list', { limit: 10, status: 'running' })
      expect(agentHistory.listAgents).toHaveBeenCalledWith(10, 'running')
    })

    it('"local:spawnClaudeAgent" calls spawnClaudeAgent with args', async () => {
      const args = { repoPath: '/tmp', task: 'fix bug', model: 'sonnet' }
      await invoke('local:spawnClaudeAgent', args)
      expect(localAgents.spawnClaudeAgent).toHaveBeenCalledWith(args)
    })

    it('"local:tailAgentLog" calls tailAgentLog with args', async () => {
      const args = { logPath: '/tmp/log.txt', fromByte: 0 }
      const result = await invoke('local:tailAgentLog', args)
      expect(localAgents.tailAgentLog).toHaveBeenCalledWith(args)
      expect(result).toEqual({ content: 'log data', nextByte: 42 })
    })

    it('"local:sendToAgent" calls sendToAgent with (pid, message)', async () => {
      await invoke('local:sendToAgent', { pid: 123, message: 'hello' })
      expect(localAgents.sendToAgent).toHaveBeenCalledWith(123, 'hello')
    })

    it('"local:isInteractive" calls isAgentInteractive with pid', async () => {
      const result = await invoke('local:isInteractive', 999)
      expect(localAgents.isAgentInteractive).toHaveBeenCalledWith(999)
      expect(result).toBe(true)
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
        'get-repo-paths',
        'git:status',
        'git:diff',
        'git:stage',
        'git:unstage',
        'git:commit',
        'git:push',
        'git:branches',
        'git:checkout',
        'poll-pr-statuses',
      ]
      for (const ch of expected) {
        expect(handlers.has(ch), `missing channel: ${ch}`).toBe(true)
      }
    })

    it('"get-repo-paths" calls getRepoPaths', async () => {
      const result = await invoke('get-repo-paths')
      expect(git.getRepoPaths).toHaveBeenCalled()
      expect(result).toEqual({ bde: '/tmp/bde' })
    })

    it('"git:status" passes cwd to gitStatus', async () => {
      await invoke('git:status', '/home/dev/repo')
      expect(git.gitStatus).toHaveBeenCalledWith('/home/dev/repo')
    })

    it('"git:diff" passes (cwd, file) to gitDiffFile', async () => {
      await invoke('git:diff', '/repo', 'src/app.ts')
      expect(git.gitDiffFile).toHaveBeenCalledWith('/repo', 'src/app.ts')
    })

    it('"git:stage" passes (cwd, files) to gitStage', async () => {
      await invoke('git:stage', '/repo', ['file1.ts', 'file2.ts'])
      expect(git.gitStage).toHaveBeenCalledWith('/repo', ['file1.ts', 'file2.ts'])
    })

    it('"git:unstage" passes (cwd, files) to gitUnstage', async () => {
      await invoke('git:unstage', '/repo', ['file1.ts'])
      expect(git.gitUnstage).toHaveBeenCalledWith('/repo', ['file1.ts'])
    })

    it('"git:commit" passes (cwd, message) to gitCommit', async () => {
      await invoke('git:commit', '/repo', 'fix: bug')
      expect(git.gitCommit).toHaveBeenCalledWith('/repo', 'fix: bug')
    })

    it('"git:push" passes cwd to gitPush', async () => {
      const result = await invoke('git:push', '/repo')
      expect(git.gitPush).toHaveBeenCalledWith('/repo')
      expect(result).toBe('push output')
    })

    it('"git:branches" passes cwd to gitBranches', async () => {
      const result = await invoke('git:branches', '/repo')
      expect(git.gitBranches).toHaveBeenCalledWith('/repo')
      expect(result).toEqual({ current: 'main', branches: ['main'] })
    })

    it('"git:checkout" passes (cwd, branch) to gitCheckout', async () => {
      await invoke('git:checkout', '/repo', 'feat/new')
      expect(git.gitCheckout).toHaveBeenCalledWith('/repo', 'feat/new')
    })

    it('"poll-pr-statuses" passes prs to pollPrStatuses', async () => {
      const prs = [{ owner: 'o', repo: 'r', prNumber: 1 }]
      await invoke('poll-pr-statuses', prs)
      expect(git.pollPrStatuses).toHaveBeenCalledWith(prs)
    })

    it('error in gitStatus propagates via safeHandle', async () => {
      vi.mocked(git.gitStatus).mockImplementationOnce(() => {
        throw new Error('not a git repo')
      })
      await expect(invoke('git:status', '/bad')).rejects.toThrow('not a git repo')
    })
  })

  // -------------------------------------------------------------------------
  // config-handlers.ts
  // -------------------------------------------------------------------------
  describe('config-handlers', () => {
    it('registers all expected channel names', () => {
      const expected = [
        'get-gateway-config',
        'get-github-token',
        'save-gateway-config',
        'get-supabase-config',
      ]
      for (const ch of expected) {
        expect(handlers.has(ch), `missing channel: ${ch}`).toBe(true)
      }
    })

    it('"get-gateway-config" returns cached gateway config', async () => {
      const result = await invoke('get-gateway-config')
      expect(result).toEqual({ url: 'ws://localhost:18789', token: 'test-token' })
    })

    it('"get-github-token" calls getGitHubToken', async () => {
      const result = await invoke('get-github-token')
      expect(config.getGitHubToken).toHaveBeenCalled()
      expect(result).toBe('gh-token')
    })

    it('"save-gateway-config" calls saveGatewayConfig and refreshes cache', async () => {
      await invoke('save-gateway-config', 'ws://new', 'new-token')
      expect(config.saveGatewayConfig).toHaveBeenCalledWith('ws://new', 'new-token')

      const cached = await invoke('get-gateway-config')
      expect(cached).toEqual({ url: 'ws://new', token: 'new-token' })
    })

    it('"get-supabase-config" calls getSupabaseConfig', async () => {
      const result = await invoke('get-supabase-config')
      expect(config.getSupabaseConfig).toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('handles getGatewayConfig() throw gracefully during registration', () => {
      // Save all handlers so we can restore after this test
      const savedHandlers = new Map(handlers)
      const savedListeners = new Map(onListeners)
      handlers.clear()
      onListeners.clear()

      vi.mocked(config.getGatewayConfig).mockImplementationOnce(() => {
        throw new Error('no config')
      })

      expect(() => registerConfigHandlers()).not.toThrow()
      expect(handlers.has('get-gateway-config')).toBe(false)

      // Restore all handlers for subsequent tests
      for (const [k, v] of savedHandlers) handlers.set(k, v)
      for (const [k, v] of savedListeners) onListeners.set(k, v)
    })
  })

  // -------------------------------------------------------------------------
  // gateway-handlers.ts
  // -------------------------------------------------------------------------
  describe('gateway-handlers', () => {
    it('registers expected channel names', () => {
      expect(handlers.has('gateway:invoke')).toBe(true)
      expect(handlers.has('gateway:getSessionHistory')).toBe(true)
    })

    it('"gateway:invoke" proxies HTTP POST with Bearer token', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ result: 'ok' }), text: vi.fn() }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

      const result = await invoke('gateway:invoke', 'myTool', { key: 'value' })

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:18789/tools/invoke',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          },
          body: JSON.stringify({ tool: 'myTool', args: { key: 'value' } }),
        })
      )
      expect(result).toEqual({ result: 'ok' })
    })

    it('converts ws:// to http:// in gateway URL', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}), text: vi.fn() }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

      await invoke('gateway:invoke', 'tool', {})

      const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string
      expect(calledUrl).toMatch(/^http:\/\//)
      expect(calledUrl).not.toMatch(/^ws:\/\//)
    })

    it('throws on non-ok response (e.g. 401)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: vi.fn().mockResolvedValue('Unauthorized'),
        })
      )

      await expect(invoke('gateway:invoke', 'tool', {})).rejects.toThrow(
        'Gateway error 401: Unauthorized'
      )
    })

    it('throws on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))

      await expect(invoke('gateway:invoke', 'tool', {})).rejects.toThrow('fetch failed')
    })

    it('"gateway:getSessionHistory" sends correct request', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ history: [] }), text: vi.fn() }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

      const result = await invoke('gateway:getSessionHistory', 'session-key-1')

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:18789/tools/invoke',
        expect.objectContaining({
          body: JSON.stringify({
            tool: 'sessions_get_history',
            args: { sessionKey: 'session-key-1' },
          }),
        })
      )
      expect(result).toEqual({ history: [] })
    })
  })

  // -------------------------------------------------------------------------
  // window-handlers.ts
  // -------------------------------------------------------------------------
  describe('window-handlers', () => {
    it('registers expected channel names', () => {
      expect(handlers.has('open-external')).toBe(true)
      expect(handlers.has('kill-local-agent')).toBe(true)
      expect(onListeners.has('set-title')).toBe(true)
    })

    it('"open-external" calls shell.openExternal with URL', async () => {
      await invoke('open-external', 'https://example.com')
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
    })

    it('"kill-local-agent" calls process.kill with PID and SIGTERM', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
      const result = await invoke('kill-local-agent', 12345)
      expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM')
      expect(result).toEqual({ ok: true })
      killSpy.mockRestore()
    })

    it('"kill-local-agent" returns error for invalid PID', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH')
      })
      const result = await invoke('kill-local-agent', 99999)
      expect(result).toEqual({ ok: false, error: expect.stringContaining('ESRCH') })
      killSpy.mockRestore()
    })

    it('"set-title" sets window title via ipcMain.on listener', () => {
      emit('set-title', 'New Title')
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

    it('"terminal:kill" does not throw', async () => {
      const id = await invoke('terminal:create', { cols: 80, rows: 24 })
      await expect(invoke('terminal:kill', id)).resolves.not.toThrow()
    })

    it('"terminal:resize" does not throw', async () => {
      const id = await invoke('terminal:create', { cols: 80, rows: 24 })
      await expect(
        invoke('terminal:resize', { id, cols: 200, rows: 50 })
      ).resolves.not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // fs handlers (fs.ts)
  // -------------------------------------------------------------------------
  describe('fs-handlers', () => {
    it('registers all expected channel names', () => {
      const expected = ['list-memory-files', 'read-memory-file', 'write-memory-file']
      for (const ch of expected) {
        expect(handlers.has(ch), `missing channel: ${ch}`).toBe(true)
      }
    })

    it('"list-memory-files" handler is registered and callable', async () => {
      const result = await invoke('list-memory-files')
      expect(Array.isArray(result)).toBe(true)
    })

    it('"read-memory-file" rejects path traversal', async () => {
      await expect(invoke('read-memory-file', '../../etc/passwd')).rejects.toThrow(
        'Path traversal blocked'
      )
    })

    it('"write-memory-file" rejects path traversal', async () => {
      await expect(
        invoke('write-memory-file', '../../../etc/evil', 'bad')
      ).rejects.toThrow('Path traversal blocked')
    })
  })
})
