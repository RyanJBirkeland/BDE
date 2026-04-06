/**
 * Tests for captureDiffSnapshot — verifies we build a structured snapshot
 * by running git diff numstat + name-status + per-file patches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'

// Mock node:child_process before importing module under test so execFileAsync
// returns whatever we set up per-test.
vi.mock('node:child_process', () => {
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & { [k: symbol]: unknown }
  execFile[promisify.custom] = vi.fn()
  return { execFile }
})

vi.mock('../../env-utils', () => ({
  buildAgentEnv: () => ({ PATH: '/usr/bin' })
}))

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

async function setupMockExec(responses: Record<string, string | Error>) {
  const childProcess = await import('node:child_process')
  const execFileAny = childProcess.execFile as unknown as {
    [k: symbol]: ReturnType<typeof vi.fn>
  }
  const execFileAsync = execFileAny[promisify.custom]
  execFileAsync.mockImplementation((...args: unknown[]) => {
    const [, gitArgs] = args as [string, string[]]
    const key = gitArgs.join(' ')
    const matchKey = Object.keys(responses).find((k) => key.includes(k))
    if (!matchKey) {
      return Promise.reject(new Error(`unexpected git call: ${key}`))
    }
    const val = responses[matchKey]
    if (val instanceof Error) return Promise.reject(val)
    return Promise.resolve({ stdout: val, stderr: '' })
  })
}

describe('captureDiffSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no files changed', async () => {
    await setupMockExec({
      '--numstat': '',
      '--name-status': ''
    })
    const { captureDiffSnapshot } = await import('../diff-snapshot')
    const snapshot = await captureDiffSnapshot('/fake/worktree', 'origin/main', logger)
    expect(snapshot).toBeNull()
  })

  it('builds snapshot with file totals and per-file patches', async () => {
    await setupMockExec({
      '--numstat': '5\t2\tsrc/foo.ts\n10\t0\tsrc/bar.ts',
      '--name-status': 'M\tsrc/foo.ts\nA\tsrc/bar.ts',
      '-- src/foo.ts': 'diff --git a/src/foo.ts b/src/foo.ts\n+added\n-removed',
      '-- src/bar.ts': 'diff --git a/src/bar.ts b/src/bar.ts\n+new file'
    })
    const { captureDiffSnapshot } = await import('../diff-snapshot')
    const snapshot = await captureDiffSnapshot('/fake/worktree', 'origin/main', logger)

    expect(snapshot).not.toBeNull()
    expect(snapshot!.totals).toEqual({ additions: 15, deletions: 2, files: 2 })
    expect(snapshot!.files).toHaveLength(2)
    expect(snapshot!.files[0].path).toBe('src/foo.ts')
    expect(snapshot!.files[0].status).toBe('M')
    expect(snapshot!.files[0].additions).toBe(5)
    expect(snapshot!.files[0].patch).toContain('diff --git a/src/foo.ts')
    expect(snapshot!.files[1].status).toBe('A')
    expect(snapshot!.truncated).toBeUndefined()
    expect(snapshot!.capturedAt).toBeTypeOf('string')
  })

  it('returns null on execFile error', async () => {
    await setupMockExec({
      '--numstat': new Error('not a git repo')
    })
    const { captureDiffSnapshot } = await import('../diff-snapshot')
    const snapshot = await captureDiffSnapshot('/fake/worktree', 'origin/main', logger)
    expect(snapshot).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('marks snapshot truncated and drops single oversized patch (file stats preserved)', async () => {
    const hugePatch = 'x'.repeat(600_000) // > 500_000 cap
    await setupMockExec({
      '--numstat': '1000\t1000\tbig.txt',
      '--name-status': 'M\tbig.txt',
      '-- big.txt': hugePatch
    })
    const { captureDiffSnapshot } = await import('../diff-snapshot')
    const snapshot = await captureDiffSnapshot('/fake/worktree', 'origin/main', logger)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.truncated).toBe(true)
    expect(snapshot!.files[0].patch).toBeUndefined()
    // Stats still preserved
    expect(snapshot!.files[0].additions).toBe(1000)
  })

  it('skips oversized files but keeps patches for smaller files later in the list', async () => {
    // First file is huge (over budget), second file is small — second should
    // still have its patch attached after the first is skipped.
    const hugePatch = 'x'.repeat(600_000)
    const smallPatch = 'diff --git a/small.ts b/small.ts\n+ok'
    await setupMockExec({
      '--numstat': '5000\t5000\tbig.txt\n2\t1\tsmall.ts',
      '--name-status': 'M\tbig.txt\nM\tsmall.ts',
      '-- big.txt': hugePatch,
      '-- small.ts': smallPatch
    })
    const { captureDiffSnapshot } = await import('../diff-snapshot')
    const snapshot = await captureDiffSnapshot('/fake/worktree', 'origin/main', logger)
    expect(snapshot).not.toBeNull()
    expect(snapshot!.truncated).toBe(true)
    expect(snapshot!.files).toHaveLength(2)
    // Big file's patch was skipped
    const big = snapshot!.files.find((f) => f.path === 'big.txt')!
    expect(big.patch).toBeUndefined()
    expect(big.additions).toBe(5000)
    // Small file's patch is still attached
    const small = snapshot!.files.find((f) => f.path === 'small.ts')!
    expect(small.patch).toBe(smallPatch)
    expect(small.additions).toBe(2)
  })
})
