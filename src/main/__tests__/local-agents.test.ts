import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFile } from 'child_process'
import { readdir, stat, unlink } from 'fs/promises'

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock('../agent-history', () => ({
  createAgentRecord: vi.fn(),
  updateAgentMeta: vi.fn(),
  appendLog: vi.fn(),
  listAgents: vi.fn().mockResolvedValue([]),
}))

import {
  getAgentProcesses,
  cleanupOldLogs,
  scanAgentProcesses,
  resolveProcessDetails,
  evictStaleCwdCache,
  reconcileStaleAgents,
  _resetReconcileThrottle,
} from '../local-agents'
import type { PsCandidate } from '../local-agents'
import { listAgents, updateAgentMeta } from '../agent-history'

// Helper: make execFile call the callback with given stdout
function mockExecFileResult(stdout: string) {
  vi.mocked(execFile).mockImplementation(
    (_cmd: string, _args: unknown, cb: unknown) => {
      ;(cb as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout,
        stderr: '',
      })
      return {} as ReturnType<typeof execFile>
    }
  )
}

// Helper: make execFile call different results based on call order
function mockExecFileSequence(results: { stdout: string }[]) {
  let callCount = 0
  vi.mocked(execFile).mockImplementation(
    (_cmd: string, _args: unknown, cb: unknown) => {
      const result = results[callCount] ?? results[results.length - 1]
      callCount++
      ;(cb as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout: result!.stdout,
        stderr: '',
      })
      return {} as ReturnType<typeof execFile>
    }
  )
}

function mockExecFileFailure(err: Error) {
  vi.mocked(execFile).mockImplementation(
    (_cmd: string, _args: unknown, cb: unknown) => {
      ;(cb as (err: Error | null) => void)(err)
      return {} as ReturnType<typeof execFile>
    }
  )
}

describe('local-agents.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetReconcileThrottle()
  })

  // --- scanAgentProcesses ---

  describe('scanAgentProcesses', () => {
    it('parses ps output and returns candidates for known agent binaries', async () => {
      mockExecFileResult(
        [
          '  PID  %CPU   RSS     ELAPSED COMMAND',
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
          '  PID  %CPU   RSS     ELAPSED COMMAND',
          ' 1234  2.5  51200       05:30 /Applications/Cursor.app/Contents/MacOS/cursor helper',
        ].join('\n')
      )

      const candidates = await scanAgentProcesses()
      expect(candidates).toHaveLength(0)
    })

    it('returns empty array for empty ps output', async () => {
      mockExecFileResult('  PID  %CPU   RSS     ELAPSED COMMAND\n')

      const candidates = await scanAgentProcesses()
      expect(candidates).toHaveLength(0)
    })
  })

  // --- resolveProcessDetails ---

  describe('resolveProcessDetails', () => {
    it('resolves CWD and builds LocalAgentProcess objects', async () => {
      // Mock lsof call for CWD resolution
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
      const results = await resolveProcessDetails([])
      expect(results).toHaveLength(0)
    })
  })

  // --- evictStaleCwdCache ---

  describe('evictStaleCwdCache', () => {
    it('is callable without throwing (cache is module-private)', () => {
      // evictStaleCwdCache operates on the module-private cwdCache.
      // We verify it doesn't throw when called with an empty set.
      expect(() => evictStaleCwdCache(new Set())).not.toThrow()
    })

    it('does not throw with a populated live pids set', () => {
      expect(() => evictStaleCwdCache(new Set([1234, 5678]))).not.toThrow()
    })
  })

  // --- reconcileStaleAgents ---

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

  // --- getAgentProcesses (orchestrator) ---

  describe('getAgentProcesses', () => {
    it('parses ps output and identifies known agent binaries', async () => {
      mockExecFileSequence([
        // ps output
        {
          stdout: [
            '  PID  %CPU   RSS     ELAPSED COMMAND',
            ' 1234  2.5  51200       05:30 /usr/local/bin/claude --model sonnet',
            ' 5678  0.1  10240       01:00 /opt/homebrew/bin/aider --watch',
            ' 9999  1.0  20480       00:30 /usr/bin/node server.js',
          ].join('\n'),
        },
        // lsof for PID 1234
        { stdout: 'p1234\nn/Users/dev/project\n' },
        // lsof for PID 5678
        { stdout: 'p5678\nn/Users/dev/other\n' },
      ])

      const processes = await getAgentProcesses()

      expect(processes).toHaveLength(2)
      expect(processes[0]!.bin).toBe('claude')
      expect(processes[0]!.pid).toBe(1234)
      expect(processes[0]!.args).toBe('--model sonnet')
      expect(processes[1]!.bin).toBe('aider')
      expect(processes[1]!.pid).toBe(5678)
    })

    it('excludes macOS .app bundles', async () => {
      mockExecFileSequence([
        {
          stdout: [
            '  PID  %CPU   RSS     ELAPSED COMMAND',
            ' 1234  2.5  51200       05:30 /Applications/Cursor.app/Contents/MacOS/cursor helper',
          ].join('\n'),
        },
      ])

      const processes = await getAgentProcesses()
      expect(processes).toHaveLength(0)
    })

    it('returns empty array when ps command fails', async () => {
      mockExecFileFailure(new Error('command not found'))

      const processes = await getAgentProcesses()
      expect(processes).toEqual([])
    })

    it('reconciles agent history — marks dead PIDs as unknown', async () => {
      // ps shows no running agents
      mockExecFileResult(
        '  PID  %CPU   RSS     ELAPSED COMMAND\n 9999  1.0  1024  00:10 /usr/bin/node app.js\n'
      )
      // agent-history has a running agent with PID 4444 (no longer in ps)
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

      await getAgentProcesses()

      // Reconciliation is fire-and-forget — give it a tick to settle
      await new Promise((r) => setTimeout(r, 10))

      expect(updateAgentMeta).toHaveBeenCalledWith('agent-1', {
        finishedAt: expect.any(String),
        status: 'unknown',
        exitCode: null,
      })
    })
  })

  // --- cleanupOldLogs ---

  describe('cleanupOldLogs', () => {
    it('removes log files older than 7 days', async () => {
      vi.mocked(readdir).mockResolvedValue(['old.log', 'new.log', 'readme.txt'] as never)
      const now = Date.now()
      const eightDaysMs = 8 * 24 * 60 * 60 * 1000
      vi.mocked(stat)
        .mockResolvedValueOnce({ mtimeMs: now - eightDaysMs } as never) // old.log — older than 7 days
        .mockResolvedValueOnce({ mtimeMs: now - 1000 } as never)        // new.log — recent
      vi.mocked(unlink).mockResolvedValue(undefined)

      await cleanupOldLogs()

      // Only old.log should be deleted (readme.txt is filtered out by .log check)
      expect(unlink).toHaveBeenCalledTimes(1)
      expect(unlink).toHaveBeenCalledWith(expect.stringContaining('old.log'))
    })

    it('returns gracefully when log directory does not exist', async () => {
      vi.mocked(readdir).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      )

      // Should not throw
      await expect(cleanupOldLogs()).resolves.toBeUndefined()
    })
  })
})
