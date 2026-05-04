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
          // Combined diff call — includes --- a/<path> for path matching.
          callback(null, {
            stdout:
              'diff --git a/src/main/index.ts b/src/main/index.ts\n--- a/src/main/index.ts\n+++ b/src/main/index.ts\n+added line\n'
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

  it('should call execFileAsync at most 3 times regardless of file count', async () => {
    // numstat → 5 files, name-status → 5 files, combined diff → 1 call. Total = 3, not 5+2.
    mockExecFile = vi.fn(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        callback: (err: Error | null, result?: { stdout: string }) => void
      ) => {
        if (args.includes('--numstat')) {
          callback(null, {
            stdout: [
              '10\t5\ta.ts',
              '2\t1\tb.ts',
              '3\t0\tc.ts',
              '1\t1\td.ts',
              '4\t2\te.ts'
            ]
              .join('\n')
              .concat('\n')
          })
        } else if (args.includes('--name-status')) {
          callback(null, {
            stdout: 'M\ta.ts\nM\tb.ts\nM\tc.ts\nM\td.ts\nM\te.ts\n'
          })
        } else {
          // Combined diff — no -- path filter
          callback(null, {
            stdout: [
              'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n+a',
              'diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n+b',
              'diff --git a/c.ts b/c.ts\n--- a/c.ts\n+++ b/c.ts\n+c',
              'diff --git a/d.ts b/d.ts\n--- a/d.ts\n+++ b/d.ts\n+d',
              'diff --git a/e.ts b/e.ts\n--- a/e.ts\n+++ b/e.ts\n+e'
            ].join('\n')
          })
        }
      }
    )

    await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(mockExecFile).toHaveBeenCalledTimes(3)
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
    const largeBlock = 'x'.repeat(600_000)
    // Combined diff returns both files in one output; large.ts patch exceeds budget.
    const combinedDiff =
      `diff --git a/large.ts b/large.ts\n--- a/large.ts\n+++ b/large.ts\n${largeBlock}` +
      `\ndiff --git a/small.ts b/small.ts\n--- a/small.ts\n+++ b/small.ts\nsmall patch`
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
        } else {
          // Combined diff call (no -- path filter)
          callback(null, { stdout: combinedDiff })
        }
      }
    )

    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(result?.files).toHaveLength(2)
    expect(result?.files[0].patch).toBeUndefined()
    expect(result?.files[1].patch).toContain('small patch')
    expect(result?.truncated).toBe(true)
  })

  it('should log warning and return unpatchted files if combined diff fetch fails', async () => {
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
          // Combined diff fails
          callback(new Error('Git error'))
        }
      }
    )

    const result = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    // File stats are still present; patch is absent because combined diff failed.
    expect(result?.files[0].patch).toBeUndefined()
    expect(result?.files[0]).toMatchObject({ path: 'foo.ts', additions: 10, deletions: 5 })
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

  it('T-56: returned files are new objects — calling twice produces independent results', async () => {
    // Two calls with identical mock state must each return a result with patches
    // on the returned objects. If fetchAndDistributePatches mutated the input array,
    // the second call would see already-patched objects and the budget arithmetic
    // would behave differently, causing test asymmetry. Identical results confirm
    // that no shared mutable state exists between calls.
    const firstResult = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)
    const secondResult = await captureDiffSnapshot('/path/to/worktree', 'main', mockLogger)

    expect(firstResult?.files[0].patch).toContain('diff --git')
    expect(secondResult?.files[0].patch).toContain('diff --git')
    // Distinct object references confirm a new array is returned each time.
    expect(firstResult?.files).not.toBe(secondResult?.files)
    expect(firstResult?.files[0]).not.toBe(secondResult?.files[0])
  })
})
