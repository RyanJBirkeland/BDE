/**
 * Tests for already-done-check.ts.
 *
 * Covers:
 *  - The 16 MiB `maxBuffer` is wired through (large stdout returns parsed entries
 *    rather than the silent-error empty list)
 *  - The per-`repoPath` TTL cache collapses repeated drain-tick lookups into one
 *    git invocation, and re-fetches once the TTL has elapsed
 *  - Body-trailer matching: a commit whose subject is generic but whose body
 *    contains the task-id marker or the `agent-run-id:` trailer is still detected
 *    (squash-merge / historical-commit fallback)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAlreadyDoneCache,
  ALREADY_DONE_CACHE_TTL_MS,
  taskHasMatchingCommitOnMain,
  type AlreadyDoneTask
} from '../already-done-check'

vi.mock('../../lib/async-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/async-utils')>()
  return {
    ...actual,
    execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
  }
})

vi.mock('../../lib/default-branch', () => ({
  resolveDefaultBranch: vi.fn().mockResolvedValue('main')
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn().mockReturnValue({})
}))

const COMMIT_FIELD_SEPARATOR = '\x1e'
const COMMIT_RECORD_SEPARATOR = '\x1f'

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}

const repoPath = '/fake/repo'

const sampleTask: AlreadyDoneTask = {
  id: 'task-already-done-1',
  title: 'Some task title that will not match anything synthetic',
  agent_run_id: null
}

function makeCommitStdout(
  records: Array<{ sha: string; subject: string; body?: string }>
): string {
  return records
    .map(
      (r) =>
        `${r.sha}${COMMIT_FIELD_SEPARATOR}${r.subject}${COMMIT_FIELD_SEPARATOR}${r.body ?? ''}${COMMIT_RECORD_SEPARATOR}`
    )
    .join('')
}

beforeEach(() => {
  __resetAlreadyDoneCache()
  vi.clearAllMocks()
})

afterEach(() => {
  __resetAlreadyDoneCache()
})

describe('taskHasMatchingCommitOnMain — large output handling', () => {
  it('parses commit records when stdout exceeds the legacy 1 MB execFile maxBuffer', async () => {
    const { execFileAsync } = await import('../../lib/async-utils')

    // Build > 1 MB of commit records. Each record is small (~80 bytes), so we
    // generate ~20k records to comfortably clear the 1 MB threshold.
    const ONE_MEGABYTE = 1024 * 1024
    const records: Array<{ sha: string; subject: string }> = []
    let stdoutSize = 0
    let index = 0
    while (stdoutSize <= ONE_MEGABYTE + 64 * 1024) {
      const sha = String(index).padStart(40, 'a')
      const subject = `chore(noise): commit number ${index} with filler text to push past the buffer threshold`
      records.push({ sha, subject })
      stdoutSize += sha.length + subject.length + 2
      index += 1
    }
    // Plant a matching commit at the end so we can prove the parser saw the full output.
    records.push({ sha: 'cafef00dcafef00dcafef00dcafef00dcafef00d', subject: sampleTask.title })

    const stdout = makeCommitStdout(records)
    expect(stdout.length).toBeGreaterThan(ONE_MEGABYTE)
    ;(execFileAsync as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stdout, stderr: '' })

    const match = await taskHasMatchingCommitOnMain(sampleTask, repoPath, silentLogger)

    expect(match).toEqual({
      sha: 'cafef00dcafef00dcafef00dcafef00dcafef00d',
      matchedOn: 'title'
    })

    // Sanity-check the maxBuffer option was passed through.
    const callOptions = (execFileAsync as ReturnType<typeof vi.fn>).mock.calls[0][2] as {
      maxBuffer?: number
    }
    expect(callOptions.maxBuffer).toBe(16 * 1024 * 1024)
  })
})

describe('taskHasMatchingCommitOnMain — commit-body matching', () => {
  it('matches when (T-<id>) appears only in the commit body', async () => {
    const { execFileAsync } = await import('../../lib/async-utils')

    const task: AlreadyDoneTask = {
      id: 'task-body-1',
      title: 'A title that will not appear in any commit subject',
      agent_run_id: null
    }
    const stdout = makeCommitStdout([
      {
        sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        subject: 'chore: cleanup unrelated module',
        body: `Some explanatory paragraph.\n\nRefs (T-${task.id})`
      }
    ])
    ;(execFileAsync as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stdout, stderr: '' })

    const match = await taskHasMatchingCommitOnMain(task, repoPath, silentLogger)

    expect(match).toEqual({
      sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      matchedOn: 'task-id'
    })
  })

  it('matches when agent-run-id: <runId> appears only in the commit body', async () => {
    const { execFileAsync } = await import('../../lib/async-utils')

    const task: AlreadyDoneTask = {
      id: 'task-body-2',
      title: 'Another title that will not appear in any commit subject',
      agent_run_id: 'run-abc-123'
    }
    const stdout = makeCommitStdout([
      {
        sha: 'feedfacefeedfacefeedfacefeedfacefeedface',
        subject: 'feat(scope): squash-merged work',
        body: `Implements the feature.\n\nagent-run-id: ${task.agent_run_id}`
      }
    ])
    ;(execFileAsync as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stdout, stderr: '' })

    const match = await taskHasMatchingCommitOnMain(task, repoPath, silentLogger)

    expect(match).toEqual({
      sha: 'feedfacefeedfacefeedfacefeedfacefeedface',
      matchedOn: 'agent-run-id'
    })
  })
})

describe('taskHasMatchingCommitOnMain — per-repoPath TTL cache', () => {
  it('serves repeated lookups within the TTL from cache (single git invocation)', async () => {
    const { execFileAsync } = await import('../../lib/async-utils')

    const stdout = makeCommitStdout([
      { sha: '1111111111111111111111111111111111111111', subject: 'unrelated commit' }
    ])
    ;(execFileAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout, stderr: '' })

    const firstCallTask: AlreadyDoneTask = { id: 'a', title: 'task A', agent_run_id: null }
    const secondCallTask: AlreadyDoneTask = { id: 'b', title: 'task B', agent_run_id: null }

    await taskHasMatchingCommitOnMain(firstCallTask, repoPath, silentLogger)
    await taskHasMatchingCommitOnMain(secondCallTask, repoPath, silentLogger)

    expect(execFileAsync).toHaveBeenCalledTimes(1)
  })

  it('re-fetches once the TTL has expired', async () => {
    vi.useFakeTimers()
    try {
      const { execFileAsync } = await import('../../lib/async-utils')

      const stdout = makeCommitStdout([
        { sha: '2222222222222222222222222222222222222222', subject: 'unrelated commit' }
      ])
      ;(execFileAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout, stderr: '' })

      const probeTask: AlreadyDoneTask = { id: 'a', title: 'task A', agent_run_id: null }

      await taskHasMatchingCommitOnMain(probeTask, repoPath, silentLogger)
      expect(execFileAsync).toHaveBeenCalledTimes(1)

      // Advance just past the TTL — the next call must hit git again.
      vi.advanceTimersByTime(ALREADY_DONE_CACHE_TTL_MS + 1)
      await taskHasMatchingCommitOnMain(probeTask, repoPath, silentLogger)

      expect(execFileAsync).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
