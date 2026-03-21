import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFile } from 'child_process'
import { readdir, stat, unlink, appendFile, open } from 'fs/promises'
import type { AgentHandle, AgentEvent } from '../agents/types'

// --- Module mocks ---

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}))

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  readFile: vi.fn(),
  appendFile: vi.fn().mockResolvedValue(undefined),
  open: vi.fn(),
}))

vi.mock('../agent-history', () => ({
  createAgentRecord: vi.fn().mockResolvedValue({ logPath: '/tmp/bde-agents/test/output.log' }),
  updateAgentMeta: vi.fn().mockResolvedValue(undefined),
  appendLog: vi.fn().mockResolvedValue(undefined),
  listAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../fs', () => ({
  validateLogPath: vi.fn((p: string) => p),
}))

vi.mock('../agents', () => {
  const MockSdkProvider = vi.fn()
  return { SdkProvider: MockSdkProvider }
})

import {
  getAgentProcesses,
  spawnClaudeAgent,
  sendToAgent,
  tailAgentLog,
  cleanupOldLogs,
  isAgentInteractive,
  scanAgentProcesses,
  resolveProcessDetails,
  evictStaleCwdCache,
  reconcileStaleAgents,
  _resetReconcileThrottle,
  _resetProcessCache,
} from '../local-agents'
import type { PsCandidate } from '../local-agents'
import {
  createAgentRecord,
  updateAgentMeta,
  listAgents,
} from '../agent-history'
import { SdkProvider } from '../agents'

// --- Helpers ---

const PS_HEADER = '  PID  %CPU   RSS     ELAPSED COMMAND'

/** Mock sequential execFile calls. Supports Error objects for failure cases. */
function mockExecFileSequence(results: Array<{ stdout: string; stderr?: string } | Error>) {
  let callIndex = 0
  vi.mocked(execFile).mockImplementation((...rawArgs: unknown[]) => {
    const cb = rawArgs[rawArgs.length - 1] as (
      err: Error | null,
      result?: { stdout: string; stderr: string },
    ) => void
    const result = results[callIndex] ?? { stdout: '', stderr: '' }
    callIndex++
    if (result instanceof Error) {
      cb(result)
    } else {
      cb(null, { stdout: result.stdout, stderr: result.stderr ?? '' })
    }
    return {} as ReturnType<typeof execFile>
  })
}

/** Convenience wrapper: mock a single execFile result. */
function mockExecFileResult(stdout: string) {
  mockExecFileSequence([{ stdout }])
}

/** Convenience wrapper: mock a single execFile failure. */
function mockExecFileFailure(err: Error) {
  mockExecFileSequence([err])
}

/** Create a mock AgentHandle with controllable event stream. */
function createMockHandle(pid?: number): AgentHandle & {
  _pushEvent: (event: AgentEvent) => void
  _complete: () => void
} {
  const queue: AgentEvent[] = []
  let resolve: (() => void) | null = null
  let done = false

  async function* eventGenerator() {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!
      } else if (done) {
        return
      } else {
        await new Promise<void>((r) => { resolve = r })
      }
    }
  }

  return {
    id: 'mock-handle-id',
    pid,
    events: eventGenerator(),
    steer: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    _pushEvent: (event: AgentEvent) => {
      queue.push(event)
      resolve?.()
      resolve = null
    },
    _complete: () => {
      done = true
      resolve?.()
      resolve = null
    },
  }
}

/** Set up SdkProvider mock to return a provider with the given handle. */
function mockProvider(handle: AgentHandle) {
  vi.mocked(SdkProvider).mockImplementation(function (this: Record<string, unknown>) {
    this.spawn = vi.fn().mockResolvedValue(handle)
    return this
  } as never)
}

describe('local-agents.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetReconcileThrottle()
    _resetProcessCache()
  })

  // ── scanAgentProcesses ─────────────────────────────────────────────

  describe('scanAgentProcesses', () => {
    it('parses ps output and returns candidates for known agent binaries', async () => {
      mockExecFileResult(
        [
          PS_HEADER,
          ' 1234  2.5  51200       05:30 /usr/local/bin/claude --model sonnet',
          ' 5678  0.1  10240       01:00 /opt/homebrew/bin/aider --watch',
          ' 9999  1.0  20480       00:30 /usr/bin/node server.js',
        ].join('\n')
      )

      const candidates = await scanAgentProcesses()

      expect(candidates).toHaveLength(2)
      expect(candidates[0]).toEqual({
        pid: 1234,
        cpuPct: 2.5,
        rss: 51200,
        elapsed: '05:30',
        command: '/usr/local/bin/claude --model sonnet',
        bin: 'claude',
      })
      expect(candidates[1]!.bin).toBe('aider')
      expect(candidates[1]!.pid).toBe(5678)
    })

    it('excludes macOS .app bundles', async () => {
      mockExecFileResult(
        [
          PS_HEADER,
          ' 1234  2.5  51200       05:30 /Applications/Cursor.app/Contents/MacOS/cursor helper',
        ].join('\n')
      )

      const candidates = await scanAgentProcesses()
      expect(candidates).toHaveLength(0)
    })

    it('returns empty array for empty ps output', async () => {
      mockExecFileResult(PS_HEADER + '\n')
      expect(await scanAgentProcesses()).toHaveLength(0)
    })
  })

  // ── resolveProcessDetails ──────────────────────────────────────────

  describe('resolveProcessDetails', () => {
    it('resolves CWD and builds LocalAgentProcess objects', async () => {
      mockExecFileResult('p1234\nn/Users/dev/project\n')

      const candidates: PsCandidate[] = [
        {
          pid: 1234,
          cpuPct: 2.5,
          rss: 51200,
          elapsed: '05:30',
          command: '/usr/local/bin/claude --model sonnet',
          bin: 'claude',
        },
      ]

      const results = await resolveProcessDetails(candidates)

      expect(results).toHaveLength(1)
      expect(results[0]!.pid).toBe(1234)
      expect(results[0]!.bin).toBe('claude')
      expect(results[0]!.args).toBe('--model sonnet')
      expect(results[0]!.cwd).toBe('/Users/dev/project')
      expect(results[0]!.memMb).toBe(50) // 51200 / 1024 rounded
    })

    it('returns empty array for empty candidates', async () => {
      expect(await resolveProcessDetails([])).toHaveLength(0)
    })
  })

  // ── evictStaleCwdCache ─────────────────────────────────────────────

  describe('evictStaleCwdCache', () => {
    it('is callable without throwing (cache is module-private)', () => {
      expect(() => evictStaleCwdCache(new Set())).not.toThrow()
    })

    it('does not throw with a populated live pids set', () => {
      expect(() => evictStaleCwdCache(new Set([1234, 5678]))).not.toThrow()
    })
  })

  // ── reconcileStaleAgents ───────────────────────────────────────────

  describe('reconcileStaleAgents', () => {
    it('marks running agents as unknown when their PID is gone', async () => {
      vi.mocked(listAgents).mockResolvedValue([
        {
          id: 'agent-1',
          pid: 4444,
          bin: 'claude',
          model: 'sonnet',
          repo: 'test',
          repoPath: '/tmp/test',
          task: 'do stuff',
          startedAt: new Date().toISOString(),
          finishedAt: null,
          exitCode: null,
          status: 'running',
          logPath: '/tmp/bde-agents/agent-1/log.txt',
          source: 'bde',
        },
      ])

      await reconcileStaleAgents(new Set([9999])) // PID 4444 not in set

      expect(updateAgentMeta).toHaveBeenCalledWith('agent-1', {
        finishedAt: expect.any(String),
        status: 'unknown',
        exitCode: null,
      })
    })

    it('does not update agents whose PID is still alive', async () => {
      vi.mocked(listAgents).mockResolvedValue([
        {
          id: 'agent-2',
          pid: 1234,
          bin: 'claude',
          model: 'sonnet',
          repo: 'test',
          repoPath: '/tmp/test',
          task: 'task',
          startedAt: new Date().toISOString(),
          finishedAt: null,
          exitCode: null,
          status: 'running',
          logPath: '/tmp/bde-agents/agent-2/log.txt',
          source: 'bde',
        },
      ])

      await reconcileStaleAgents(new Set([1234])) // PID 1234 IS in set
      expect(updateAgentMeta).not.toHaveBeenCalled()
    })

    it('skips agents with null pid', async () => {
      vi.mocked(listAgents).mockResolvedValue([
        {
          id: 'agent-3',
          pid: null,
          bin: 'claude',
          model: 'sonnet',
          repo: 'test',
          repoPath: '/tmp/test',
          task: 'task',
          startedAt: new Date().toISOString(),
          finishedAt: null,
          exitCode: null,
          status: 'running',
          logPath: '/tmp/bde-agents/agent-3/log.txt',
          source: 'bde',
        },
      ])

      await reconcileStaleAgents(new Set())
      expect(updateAgentMeta).not.toHaveBeenCalled()
    })
  })

  // ── getAgentProcesses ──────────────────────────────────────────────

  describe('getAgentProcesses', () => {
    it('returns empty array when ps output has only the header', async () => {
      mockExecFileSequence([{ stdout: PS_HEADER + '\n' }])
      expect(await getAgentProcesses()).toEqual([])
    })

    it('parses single claude process correctly (pid, bin, args, cwd, mem)', async () => {
      mockExecFileSequence([
        {
          stdout: [
            PS_HEADER,
            ' 1234  2.5  51200       05:30 /usr/local/bin/claude --model sonnet',
          ].join('\n'),
        },
        { stdout: 'p1234\nn/Users/dev/project\n' },
      ])

      const result = await getAgentProcesses()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        pid: 1234,
        bin: 'claude',
        args: '--model sonnet',
        cwd: '/Users/dev/project',
        memMb: 50,
      })
    })

    it('filters out non-agent processes (node, python, etc.)', async () => {
      mockExecFileSequence([
        {
          stdout: [
            PS_HEADER,
            ' 1000  1.0  1024       00:10 /usr/bin/node server.js',
            ' 2000  0.5  2048       01:00 /usr/local/bin/claude --verbose',
            ' 3000  0.3  512        00:05 python3 train.py',
          ].join('\n'),
        },
        { stdout: 'p2000\nn/home/user/repo\n' },
      ])

      const result = await getAgentProcesses()

      expect(result).toHaveLength(1)
      expect(result[0].bin).toBe('claude')
    })

    it('handles malformed ps output lines gracefully', async () => {
      mockExecFileSequence([
        {
          stdout: [
            PS_HEADER,
            '',
            'this is garbage',
            '   not enough columns',
            ' 1234  2.5  51200       05:30 /usr/local/bin/claude --help',
          ].join('\n'),
        },
        { stdout: 'p1234\nn/tmp\n' },
      ])

      const result = await getAgentProcesses()

      expect(result).toHaveLength(1)
      expect(result[0].pid).toBe(1234)
    })

    it('excludes macOS .app bundle paths', async () => {
      mockExecFileSequence([
        {
          stdout: [
            PS_HEADER,
            ' 1234  2.5  51200       05:30 /Applications/Claude.app/Contents/MacOS/Claude helper',
            ' 5678  1.0  10240       01:00 /Applications/Cursor.app/Contents/MacOS/cursor',
          ].join('\n'),
        },
      ])

      expect(await getAgentProcesses()).toHaveLength(0)
    })

    it('returns empty array when ps command fails', async () => {
      mockExecFileFailure(new Error('command not found'))
      expect(await getAgentProcesses()).toEqual([])
    })

    it('resolves CWD as null when lsof fails', async () => {
      mockExecFileSequence([
        {
          stdout: [PS_HEADER, ' 1234  2.5  51200       05:30 claude --help'].join('\n'),
        },
        new Error('lsof: no file use located'),
      ])

      const result = await getAgentProcesses()

      expect(result).toHaveLength(1)
      expect(result[0].cwd).toBeNull()
    })

    it('recognises all supported agent binaries (claude, codex, aider, etc.)', async () => {
      mockExecFileSequence([
        {
          stdout: [
            PS_HEADER,
            ' 1001  1.0  1024  00:10 /usr/local/bin/claude --verbose',
            ' 1002  1.0  1024  00:10 /usr/local/bin/codex --watch',
            ' 1003  1.0  1024  00:10 /usr/bin/aider --auto',
          ].join('\n'),
        },
        { stdout: 'p1001\nn/tmp/a\n' },
        { stdout: 'p1002\nn/tmp/b\n' },
        { stdout: 'p1003\nn/tmp/c\n' },
      ])

      const result = await getAgentProcesses()

      expect(result).toHaveLength(3)
      expect(result.map((r) => r.bin)).toEqual(['claude', 'codex', 'aider'])
    })

    it('reconciles agent history — marks dead PIDs as unknown', async () => {
      mockExecFileSequence([{ stdout: PS_HEADER + '\n' }])
      vi.mocked(listAgents).mockResolvedValueOnce([
        {
          id: 'agent-dead',
          pid: 4444,
          bin: 'claude',
          model: 'sonnet',
          repo: 'test',
          repoPath: '/tmp/test',
          task: 'do stuff',
          startedAt: new Date().toISOString(),
          finishedAt: null,
          exitCode: null,
          status: 'running',
          logPath: '/tmp/bde-agents/agent-dead/output.log',
          source: 'bde',
        },
      ] as never)

      await getAgentProcesses()

      expect(updateAgentMeta).toHaveBeenCalledWith('agent-dead', {
        finishedAt: expect.any(String),
        status: 'unknown',
        exitCode: null,
      })
    })

    it('does not throw if agent history reconciliation fails', async () => {
      mockExecFileSequence([{ stdout: PS_HEADER + '\n' }])
      vi.mocked(listAgents).mockRejectedValueOnce(new Error('DB locked'))

      await expect(getAgentProcesses()).resolves.toEqual([])
    })
  })

  // ── spawnClaudeAgent ───────────────────────────────────────────────

  describe('spawnClaudeAgent', () => {
    it('creates agent record and spawns via provider factory', async () => {
      const handle = createMockHandle(5001)
      mockProvider(handle)

      await spawnClaudeAgent({ task: 'fix bug', repoPath: '/tmp/repo' })

      expect(createAgentRecord).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'fix bug', repoPath: '/tmp/repo', pid: null }),
      )
      expect(SdkProvider).toHaveBeenCalled()
    })

    it('updates record with PID from handle', async () => {
      const handle = createMockHandle(5002)
      mockProvider(handle)

      await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })

      expect(updateAgentMeta).toHaveBeenCalledWith(expect.any(String), { pid: 5002 })
    })

    it('returns pid, logPath, id, and interactive from spawn result', async () => {
      const handle = createMockHandle(5003)
      mockProvider(handle)

      const result = await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })

      expect(result.pid).toBe(5003)
      expect(result.logPath).toBe('/tmp/bde-agents/test/output.log')
      expect(result.id).toBeDefined()
      expect(result.interactive).toBe(true)
    })

    it('returns pid: 0 when handle has no pid (SDK provider)', async () => {
      const handle = createMockHandle() // no pid
      mockProvider(handle)

      const result = await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })

      expect(result.pid).toBe(0)
      expect(result.interactive).toBe(true)
    })

    it('tracks handle by PID for interactive messaging', async () => {
      const handle = createMockHandle(5005)
      mockProvider(handle)

      await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })

      expect(isAgentInteractive(5005)).toBe(true)
    })

    it('marks agent as failed when provider.spawn() throws', async () => {
      vi.mocked(SdkProvider).mockImplementation(function (this: Record<string, unknown>) {
        this.spawn = vi.fn().mockRejectedValue(new Error('Binary not found'))
        return this
      } as never)

      const result = await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })

      expect(result.pid).toBe(0)
      expect(result.interactive).toBe(false)
      expect(updateAgentMeta).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'failed' }),
      )
    })

    it('writes events to log file during background consumption', async () => {
      const handle = createMockHandle(5006)
      mockProvider(handle)

      await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })

      // Push an event through the stream
      handle._pushEvent({ type: 'agent:text', text: 'hello', timestamp: 1 })
      handle._pushEvent({
        type: 'agent:completed', exitCode: 0, costUsd: 0,
        tokensIn: 0, tokensOut: 0, durationMs: 0, timestamp: 2,
      })

      // Wait for background consumption
      await vi.waitFor(() =>
        expect(appendFile).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining('agent:text'),
          'utf-8',
        ),
      )
    })

    it('updates DB with done status on agent:completed with exitCode 0', async () => {
      const handle = createMockHandle(5007)
      mockProvider(handle)

      await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })

      handle._pushEvent({
        type: 'agent:completed', exitCode: 0, costUsd: 0.05,
        tokensIn: 1000, tokensOut: 500, durationMs: 10000, timestamp: 1,
      })

      await vi.waitFor(() =>
        expect(updateAgentMeta).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ status: 'done', exitCode: 0 }),
        ),
      )
    })

    it('updates DB with failed status on non-zero exit code', async () => {
      const handle = createMockHandle(5008)
      mockProvider(handle)

      await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })

      handle._pushEvent({
        type: 'agent:completed', exitCode: 1, costUsd: 0,
        tokensIn: 0, tokensOut: 0, durationMs: 0, timestamp: 1,
      })

      await vi.waitFor(() =>
        expect(updateAgentMeta).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ status: 'failed', exitCode: 1 }),
        ),
      )
    })

    it('removes handle from tracking on completion', async () => {
      const handle = createMockHandle(5009)
      mockProvider(handle)

      await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })
      expect(isAgentInteractive(5009)).toBe(true)

      handle._pushEvent({
        type: 'agent:completed', exitCode: 0, costUsd: 0,
        tokensIn: 0, tokensOut: 0, durationMs: 0, timestamp: 1,
      })

      await vi.waitFor(() => expect(isAgentInteractive(5009)).toBe(false))
    })
  })

  // ── sendToAgent ────────────────────────────────────────────────────

  describe('sendToAgent', () => {
    it('delegates to handle.steer() and returns { ok: true }', async () => {
      const handle = createMockHandle(6001)
      mockProvider(handle)
      await spawnClaudeAgent({ task: 'setup', repoPath: '/tmp/repo' })

      const result = sendToAgent(6001, 'follow up')

      expect(result).toEqual({ ok: true })
      expect(handle.steer).toHaveBeenCalledWith('follow up')
    })

    it('returns { ok: false } when PID is not found', () => {
      const result = sendToAgent(99999, 'hello')
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  // ── isAgentInteractive ─────────────────────────────────────────────

  describe('isAgentInteractive', () => {
    it('returns true when PID has an active handle', async () => {
      const handle = createMockHandle(7001)
      mockProvider(handle)
      await spawnClaudeAgent({ task: 'test', repoPath: '/tmp/repo' })

      expect(isAgentInteractive(7001)).toBe(true)
    })

    it('returns false when PID is not in active handles', () => {
      expect(isAgentInteractive(88888)).toBe(false)
    })
  })

  // ── tailAgentLog ───────────────────────────────────────────────────

  describe('tailAgentLog', () => {
    /** Create a mock file handle that reads from `content` */
    function mockFileHandle(content: Buffer) {
      const mockFh = {
        stat: vi.fn().mockResolvedValue({ size: content.length }),
        read: vi.fn().mockImplementation((buf: Buffer, offset: number, length: number, position: number) => {
          content.copy(buf, offset, position, position + length)
          return Promise.resolve({ bytesRead: length })
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }
      vi.mocked(open).mockResolvedValue(mockFh as never)
      return mockFh
    }

    it('reads full file when fromByte is 0', async () => {
      const buf = Buffer.from('line1\nline2\n')
      mockFileHandle(buf)

      const result = await tailAgentLog({ logPath: '/tmp/bde-agents/test.log' })

      expect(result.content).toBe('line1\nline2\n')
      expect(result.nextByte).toBe(buf.length)
    })

    it('reads partial file from byte offset', async () => {
      const buf = Buffer.from('line1\nline2\n')
      mockFileHandle(buf)

      const result = await tailAgentLog({ logPath: '/tmp/bde-agents/test.log', fromByte: 6 })

      expect(result.content).toBe('line2\n')
      expect(result.nextByte).toBe(buf.length)
    })

    it('returns empty content and same offset when file does not exist', async () => {
      vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

      const result = await tailAgentLog({ logPath: '/tmp/bde-agents/missing.log', fromByte: 42 })

      expect(result.content).toBe('')
      expect(result.nextByte).toBe(42)
    })
  })

  // ── cleanupOldLogs ─────────────────────────────────────────────────

  describe('cleanupOldLogs', () => {
    it('deletes old .log files, preserves recent ones, ignores non-.log files', async () => {
      vi.mocked(readdir).mockResolvedValue(['old.log', 'new.log', 'readme.txt'] as never)
      const now = Date.now()
      const eightDays = 8 * 24 * 60 * 60 * 1000
      vi.mocked(stat)
        .mockResolvedValueOnce({ mtimeMs: now - eightDays } as never)
        .mockResolvedValueOnce({ mtimeMs: now - 1000 } as never)
      vi.mocked(unlink).mockResolvedValue(undefined)

      await cleanupOldLogs()

      expect(unlink).toHaveBeenCalledTimes(1)
      expect(unlink).toHaveBeenCalledWith(expect.stringContaining('old.log'))
    })

    it('does not throw when log directory does not exist', async () => {
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'))
      await expect(cleanupOldLogs()).resolves.toBeUndefined()
    })
  })
})
