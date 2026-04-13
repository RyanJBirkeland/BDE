/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'util'

// Mock child_process so executeMergeStrategy's git calls are observable.
// Must be hoisted above the module import below.
vi.mock('node:child_process', () => {
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & { [k: symbol]: unknown }
  execFile[promisify.custom] = vi.fn()
  return { execFile }
})
vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

import { execFile } from 'node:child_process'
import { parseNumstat, executeMergeStrategy } from '../review-merge-service'

const execFileMock = vi.mocked(execFile)
function getCustomMock(): ReturnType<typeof vi.fn> {
  return (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[promisify.custom]
}

describe('parseNumstat', () => {
  it('should parse numstat output with patch map', () => {
    const numstatInput = `10\t5\tsrc/main/handlers/review.ts
0\t20\tsrc/main/services/deleted.ts
15\t0\tsrc/main/services/new.ts`

    const patchMap = new Map([
      ['src/main/handlers/review.ts', 'diff --git a/src/main/handlers/review.ts...'],
      ['src/main/services/deleted.ts', 'diff --git a/src/main/services/deleted.ts...'],
      ['src/main/services/new.ts', 'diff --git a/src/main/services/new.ts...']
    ])

    const result = parseNumstat(numstatInput, patchMap)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({
      path: 'src/main/handlers/review.ts',
      status: 'modified',
      additions: 10,
      deletions: 5,
      patch: 'diff --git a/src/main/handlers/review.ts...'
    })
    expect(result[1]).toEqual({
      path: 'src/main/services/deleted.ts',
      status: 'deleted',
      additions: 0,
      deletions: 20,
      patch: 'diff --git a/src/main/services/deleted.ts...'
    })
    expect(result[2]).toEqual({
      path: 'src/main/services/new.ts',
      status: 'added',
      additions: 15,
      deletions: 0,
      patch: 'diff --git a/src/main/services/new.ts...'
    })
  })

  it('should handle files not in patch map', () => {
    const numstatInput = '5\t3\tREADME.md'
    const patchMap = new Map<string, string>()

    const result = parseNumstat(numstatInput, patchMap)

    expect(result).toHaveLength(1)
    expect(result[0].patch).toBe('')
  })

  it('should handle binary files with "-" markers', () => {
    const numstatInput = '-\t-\tsrc/assets/image.png'
    const patchMap = new Map([['src/assets/image.png', 'Binary files differ']])

    const result = parseNumstat(numstatInput, patchMap)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      path: 'src/assets/image.png',
      status: 'deleted',
      additions: 0,
      deletions: 0,
      patch: 'Binary files differ'
    })
  })

  it('should handle empty input', () => {
    const result = parseNumstat('', new Map())
    expect(result).toEqual([])
  })

  it('should handle file paths with tabs', () => {
    const numstatInput = '5\t2\tpath/with\ttab.txt'
    const patchMap = new Map([['path/with\ttab.txt', 'diff --git...']])

    const result = parseNumstat(numstatInput, patchMap)

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('path/with\ttab.txt')
  })
})

describe('executeMergeStrategy (squash)', () => {
  const mockEnv = { PATH: '/usr/bin' }
  const repoPath = '/repo/bde'
  const branch = 'agent/some-branch'

  beforeEach(() => {
    vi.clearAllMocks()
    getCustomMock().mockReset()
  })

  it('should skip squash+commit when branch is already patch-merged into local main', async () => {
    // Regression scenario: a prior Ship It attempt already ran `git merge --squash`
    // and `git commit`, but the subsequent `git push` failed. The squash commit is
    // sitting on local main. Retry Ship It: `git merge --squash` would stage
    // nothing (branch tree already equals local main's tree), `git commit` would
    // fail with "nothing to commit", and the user would be stuck.
    //
    // Fix: at the start of the squash path, run `git cherry HEAD <branch>` to
    // detect whether every commit on the branch has a patch-equivalent on main.
    // If so, skip the squash+commit entirely and return success so the caller
    // can proceed to push the already-existing squash commit.
    const gitCalls: string[][] = []
    getCustomMock().mockImplementation(async (_cmd: string, args: readonly string[]) => {
      gitCalls.push([...args])
      if (args[0] === 'cherry') {
        // Every branch commit already has a patch-equivalent on HEAD.
        // `git cherry` prefixes applied commits with `-`, unapplied with `+`.
        return { stdout: '- aaaaaaa\n- bbbbbbb\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await executeMergeStrategy(
      branch,
      repoPath,
      'squash',
      'task1',
      'My Task',
      mockEnv
    )

    expect(result.success).toBe(true)
    // Verify NO squash merge or commit happened
    expect(gitCalls.some((args) => args[0] === 'merge' && args[1] === '--squash')).toBe(false)
    expect(gitCalls.some((args) => args[0] === 'commit')).toBe(false)
    // Verify the cherry check DID run
    expect(gitCalls.some((args) => args[0] === 'cherry')).toBe(true)
  })

  it('should run squash+commit when branch has commits not yet on main', async () => {
    // Baseline: fresh branch with new work → cherry reports `+` lines → do the
    // squash. Ensures the idempotent-skip only fires in the already-merged case.
    const gitCalls: string[][] = []
    getCustomMock().mockImplementation(async (_cmd: string, args: readonly string[]) => {
      gitCalls.push([...args])
      if (args[0] === 'cherry') {
        return { stdout: '+ aaaaaaa\n+ bbbbbbb\n', stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await executeMergeStrategy(
      branch,
      repoPath,
      'squash',
      'task1',
      'My Task',
      mockEnv
    )

    expect(result.success).toBe(true)
    expect(gitCalls.some((args) => args[0] === 'merge' && args[1] === '--squash')).toBe(true)
    expect(gitCalls.some((args) => args[0] === 'commit')).toBe(true)
  })
})
