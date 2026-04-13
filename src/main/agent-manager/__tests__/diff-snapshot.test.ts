import { describe, it, expect, vi, beforeEach } from 'vitest'
import { captureDiffSnapshot } from '../diff-snapshot'
import type { Logger } from '../types'

vi.mock('node:child_process', () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    callback: (err: Error | null, result: { stdout: string }) => void
  ) => {
    const mockExecFile = getMockExecFile()
    mockExecFile(_cmd, _args, _opts, callback)
  }
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/bin' }))
}))

let mockExecFile: ReturnType<typeof vi.fn>

function getMockExecFile() {
  return mockExecFile
}

describe('diff-snapshot', () => {
  let mockLogger: Logger

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as unknown as Logger

    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('--numstat')) {
          callback(null, { stdout: '10\t5\tsrc/main/index.ts\n' })
        } else if (args.includes('--name-status')) {
          callback(null, { stdout: 'M\tsrc/main/index.ts\n' })
        } else {
          callback(null, {
            stdout: 'diff --git a/src/main/index.ts b/src/main/index.ts\n+added line\n'
          })
        }
      }
    )
  })

  it('should capture diff snapshot with file stats', async () => {
    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(result).not.toBeNull()
    expect(result?.files).toHaveLength(1)
    expect(result?.files[0]).toMatchObject({
      path: 'src/main/index.ts',
      status: 'M',
      additions: 10,
      deletions: 5
    })
    expect(result?.totals).toEqual({
      additions: 10,
      deletions: 5,
      files: 1
    })
  })

  it('should attach patches to files', async () => {
    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(result?.files[0].patch).toContain('diff --git')
    expect(result?.files[0].patch).toContain('+added line')
  })

  it('should return null if no files changed', async () => {
    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        callback(null, { stdout: '' })
      }
    )

    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)
    expect(result).toBeNull()
  })

  it('should handle binary files with - in numstat', async () => {
    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('--numstat')) {
          callback(null, { stdout: '-\t-\timage.png\n' })
        } else if (args.includes('--name-status')) {
          callback(null, { stdout: 'A\timage.png\n' })
        } else {
          callback(null, { stdout: '' })
        }
      }
    )

    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(result?.files[0]).toMatchObject({
      path: 'image.png',
      status: 'A',
      additions: 0,
      deletions: 0
    })
  })

  it('should skip oversized patches but keep file stats', async () => {
    const largeContent = 'x'.repeat(600_000)
    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('--numstat')) {
          callback(null, { stdout: '100\t50\tlarge.ts\n5\t2\tsmall.ts\n' })
        } else if (args.includes('--name-status')) {
          callback(null, { stdout: 'M\tlarge.ts\nM\tsmall.ts\n' })
        } else if (args.includes('large.ts')) {
          callback(null, { stdout: largeContent })
        } else {
          callback(null, { stdout: 'small patch' })
        }
      }
    )

    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(result?.files).toHaveLength(2)
    expect(result?.files[0].patch).toBeUndefined()
    expect(result?.files[1].patch).toBe('small patch')
    expect(result?.truncated).toBe(true)
  })

  it('should log warning and skip file if patch fetch fails', async () => {
    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('--numstat')) {
          callback(null, { stdout: '10\t5\tfoo.ts\n' })
        } else if (args.includes('--name-status')) {
          callback(null, { stdout: 'M\tfoo.ts\n' })
        } else {
          callback(new Error('Git error'))
        }
      }
    )

    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(result?.files[0].patch).toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[diff-snapshot]'))
  })

  it('should return null and log warning on git command failure', async () => {
    mockExecFile = vi.fn(
      (_cmd: string, _args: string[], _opts: unknown, callback: (err: Error | null) => void) => {
        callback(new Error('Git not found'))
      }
    )

    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(result).toBeNull()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[diff-snapshot] capture failed')
    )
  })

  it('should handle tabs in file paths', async () => {
    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('--numstat')) {
          callback(null, { stdout: '10\t5\tpath\twith\ttabs.ts\n' })
        } else if (args.includes('--name-status')) {
          callback(null, { stdout: 'M\tpath\twith\ttabs.ts\n' })
        } else {
          callback(null, { stdout: '' })
        }
      }
    )

    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(result?.files[0].path).toBe('path\twith\ttabs.ts')
  })

  it('should include capturedAt timestamp', async () => {
    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(result?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
