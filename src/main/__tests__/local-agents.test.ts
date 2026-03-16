import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exec } from 'child_process'
import { readdir, stat, unlink } from 'fs/promises'

vi.mock('child_process', () => ({
  exec: vi.fn(),
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

import { getAgentProcesses, cleanupOldLogs } from '../local-agents'
import { listAgents, updateAgentMeta } from '../agent-history'

// Helper: make exec call the callback with given stdout
function mockExecResult(stdout: string) {
  vi.mocked(exec).mockImplementation((_cmd: string, cb: unknown) => {
    ;(cb as (err: Error | null, result: { stdout: string; stderr: string }) => void)(null, {
      stdout,
      stderr: '',
    })
    return {} as ReturnType<typeof exec>
  })
}

function mockExecFailure(err: Error) {
  vi.mocked(exec).mockImplementation((_cmd: string, cb: unknown) => {
    ;(cb as (err: Error | null) => void)(err)
    return {} as ReturnType<typeof exec>
  })
}

describe('local-agents.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAgentProcesses', () => {
    it('parses ps output and identifies known agent binaries', async () => {
      // First call: ps output. Subsequent calls: lsof for CWD resolution
      let callCount = 0
      vi.mocked(exec).mockImplementation((_cmd: string, cb: unknown) => {
        callCount++
        const callback = cb as (err: Error | null, result: { stdout: string; stderr: string }) => void
        if (callCount === 1) {
          // ps output
          callback(null, {
            stdout: [
              '  PID  %CPU   RSS     ELAPSED COMMAND',
              ' 1234  2.5  51200       05:30 /usr/local/bin/claude --model sonnet',
              ' 5678  0.1  10240       01:00 /opt/homebrew/bin/aider --watch',
              ' 9999  1.0  20480       00:30 /usr/bin/node server.js',
            ].join('\n'),
            stderr: '',
          })
        } else {
          // lsof output for CWD resolution
          callback(null, { stdout: 'p1234\nn/Users/dev/project\n', stderr: '' })
        }
        return {} as ReturnType<typeof exec>
      })

      const processes = await getAgentProcesses()

      // Should find claude and aider, but not node
      expect(processes).toHaveLength(2)
      expect(processes[0].bin).toBe('claude')
      expect(processes[0].pid).toBe(1234)
      expect(processes[0].args).toBe('--model sonnet')
      expect(processes[1].bin).toBe('aider')
      expect(processes[1].pid).toBe(5678)
    })

    it('excludes macOS .app bundles', async () => {
      let callCount = 0
      vi.mocked(exec).mockImplementation((_cmd: string, cb: unknown) => {
        callCount++
        const callback = cb as (err: Error | null, result: { stdout: string; stderr: string }) => void
        if (callCount === 1) {
          callback(null, {
            stdout: [
              '  PID  %CPU   RSS     ELAPSED COMMAND',
              ' 1234  2.5  51200       05:30 /Applications/Cursor.app/Contents/MacOS/cursor helper',
            ].join('\n'),
            stderr: '',
          })
        } else {
          callback(null, { stdout: '', stderr: '' })
        }
        return {} as ReturnType<typeof exec>
      })

      const processes = await getAgentProcesses()
      expect(processes).toHaveLength(0)
    })

    it('returns empty array when ps command fails', async () => {
      mockExecFailure(new Error('command not found'))

      const processes = await getAgentProcesses()
      expect(processes).toEqual([])
    })

    it('reconciles agent history — marks dead PIDs as unknown', async () => {
      // ps shows no running agents
      mockExecResult(
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

      expect(updateAgentMeta).toHaveBeenCalledWith('agent-1', {
        finishedAt: expect.any(String),
        status: 'unknown',
        exitCode: null,
      })
    })
  })

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
