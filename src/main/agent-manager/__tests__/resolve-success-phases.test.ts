import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecFileAsync = vi.fn()
vi.mock('../../lib/async-utils', () => ({
  execFileAsync: (...args: unknown[]) => mockExecFileAsync(...args)
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn().mockReturnValue({})
}))

vi.mock('../git-operations', () => ({
  rebaseOntoMain: vi.fn(),
  autoCommitIfDirty: vi.fn()
}))

vi.mock('../review-transition', () => ({
  transitionToReview: vi.fn()
}))

import {
  extractTaskIdFromBranch,
  branchMatchesTask,
  assertBranchTipMatches,
  BranchTipMismatchError,
  hasCommitsAheadOfMain
} from '../resolve-success-phases'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

describe('extractTaskIdFromBranch', () => {
  it('extracts the task id slug from a standard agent branch name', () => {
    expect(extractTaskIdFromBranch('agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef')).toBe(
      '11'
    )
  })

  it('handles alphanumeric task ids', () => {
    expect(extractTaskIdFromBranch('agent/t-abc123-some-slugified-title-12345678')).toBe('abc123')
  })

  it('handles longer numeric task ids', () => {
    expect(extractTaskIdFromBranch('agent/t-20260420-audit-worktree-base-064f79ef')).toBe(
      '20260420'
    )
  })

  it('returns null for a malformed branch name', () => {
    expect(extractTaskIdFromBranch('main')).toBeNull()
    expect(extractTaskIdFromBranch('feat/something')).toBeNull()
    expect(extractTaskIdFromBranch('agent/no-t-prefix-here-12345678')).toBeNull()
  })

  it('returns null when the group-hash suffix is missing', () => {
    expect(extractTaskIdFromBranch('agent/t-11-pass-encoding-utf8-to-execfile')).toBeNull()
  })
})

describe('branchMatchesTask', () => {
  it('matches when branch id suffix matches the task id tail', () => {
    expect(
      branchMatchesTask(
        'agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef',
        'audit-20260420-t-11'
      )
    ).toBe(true)
  })

  it('matches numeric-only task ids', () => {
    expect(
      branchMatchesTask('agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef', 't-11')
    ).toBe(true)
  })

  it('does not match when the ids differ', () => {
    expect(
      branchMatchesTask(
        'agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef',
        'audit-20260420-t-22'
      )
    ).toBe(false)
  })

  it('does not match a malformed branch', () => {
    expect(branchMatchesTask('main', 'audit-20260420-t-11')).toBe(false)
  })

  it('is case-insensitive on the id comparison', () => {
    expect(branchMatchesTask('agent/t-abc123-something-12345678', 'AUDIT-20260420-T-abc123')).toBe(
      true
    )
  })

  it('matches UUID task ids via the 8-char hash suffix', () => {
    expect(
      branchMatchesTask(
        'agent/t-13-stabilize-sprinttasks-loaddata-to-a-9f04f0d0',
        '9f04f0d089a0f3e3a45ff13ab2887a02'
      )
    ).toBe(true)
  })

  it('does not match a UUID whose prefix differs from the branch hash', () => {
    expect(
      branchMatchesTask(
        'agent/t-13-stabilize-sprinttasks-loaddata-to-a-9f04f0d0',
        'deadbeef89a0f3e3a45ff13ab2887a02'
      )
    ).toBe(false)
  })
})

describe('assertBranchTipMatches — branch-name path (primary)', () => {
  const taskRow = {
    id: 'audit-20260420-t-11',
    title: "T-11 · Pass {encoding:'utf8'} to execFile in auth-guard",
    agent_run_id: '82fa9f9a-6011-449f-b965-ec3ecd1c166e'
  }

  it('accepts when the branch name matches the task id, regardless of commit subject', async () => {
    const readTipCommit = async (): Promise<string> =>
      'fix(auth-guard): pass encoding to execFile — eliminate unsafe type casts'
    await expect(
      assertBranchTipMatches(
        taskRow,
        'agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef',
        '/nonexistent',
        readTipCommit
      )
    ).resolves.not.toThrow()
  })

  it('short-circuits the git read when the branch name matches', async () => {
    let callCount = 0
    const readTipCommit = async (): Promise<string> => {
      callCount += 1
      return 'fix(auth-guard): pass encoding to execFile'
    }
    await assertBranchTipMatches(
      taskRow,
      'agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef',
      '/nonexistent',
      readTipCommit
    )
    expect(callCount).toBe(0)
  })

  it('falls back to commit-message match when the branch name does not parse', async () => {
    const readTipCommit = async (): Promise<string> =>
      'fix for audit-20260420-t-11: pass encoding to execFile'
    await expect(
      assertBranchTipMatches(taskRow, 'main', '/nonexistent', readTipCommit)
    ).resolves.not.toThrow()
  })

  it('rejects when neither branch nor message match', async () => {
    const readTipCommit = async (): Promise<string> => 'fix: unrelated work'
    await expect(
      assertBranchTipMatches(
        taskRow,
        'agent/t-99-unrelated-work-abcdef12',
        '/nonexistent',
        readTipCommit
      )
    ).rejects.toBeInstanceOf(BranchTipMismatchError)
  })

  it('rejects when the commit message references a different task id and branch disagrees', async () => {
    const readTipCommit = async (): Promise<string> =>
      'docs(audit): add 2026-04-20 install-readiness audit specs'
    await expect(
      assertBranchTipMatches(
        taskRow,
        'agent/t-99-something-else-abcdef12',
        '/nonexistent',
        readTipCommit
      )
    ).rejects.toBeInstanceOf(BranchTipMismatchError)
  })
})

describe('wave-2 salvage replay — all 6 cases pass the new guard', () => {
  const cases: Array<{
    taskId: string
    title: string
    branch: string
    subject: string
  }> = [
    {
      taskId: 'audit-20260420-t-11',
      title: "T-11 · Pass {encoding:'utf8'} to execFile in auth-guard",
      branch: 'agent/t-11-pass-encoding-utf8-to-execfile-in-a-064f79ef',
      subject: 'fix(auth-guard): pass encoding to execFile — eliminate unsafe type casts'
    },
    {
      taskId: 'audit-20260420-t-13',
      title: 'T-13 · Fix typo pruneTakeChangesInterval',
      branch: 'agent/t-13-fix-typo-prunetakechangesinterval-064f79ef',
      subject: 'fix(bootstrap): rename pruneTakeChangesInterval to pruneTaskChangesInterval'
    },
    {
      taskId: 'audit-20260420-t-17',
      title: 'T-17 · Guard user_version pragma cast in db.ts',
      branch: 'agent/t-17-guard-user-version-pragma-cast-in-d-29dddf16',
      subject: 'fix(db): guard user_version pragma cast — prevent silent migration failures'
    },
    {
      taskId: 'audit-20260420-t-44',
      title: 'T-44 · Remove unused defaultGetRepos from tools/meta.ts',
      branch: 'agent/t-44-remove-unused-defaultgetrepos-from--6beda6a3',
      subject: 'docs(mcp-server): update meta module docs — remove defaultGetRepos export'
    },
    {
      taskId: 'audit-20260420-t-46',
      title: 'T-46 · Drop as SprintTask cast from fakeTask builder',
      branch: 'agent/t-46-drop-as-sprinttask-cast-from-faketa-6beda6a3',
      subject: 'refactor(test): drop cast from fakeTask builder'
    },
    {
      taskId: 'audit-20260420-t-66',
      title: 'T-66 · Extract shared copyToClipboard helper',
      branch: 'agent/t-66-extract-shared-copytoclipboard-help-528349b6',
      subject: 'refactor(onboarding): extract shared copyToClipboard helper'
    }
  ]

  for (const c of cases) {
    it(`accepts ${c.taskId}`, async () => {
      const readTipCommit = async () => c.subject
      await expect(
        assertBranchTipMatches(
          { id: c.taskId, title: c.title, agent_run_id: null },
          c.branch,
          '/nonexistent',
          readTipCommit
        )
      ).resolves.not.toThrow()
    })
  }
})

describe('legitimate tip-mismatch still rejected', () => {
  it('rejects when neither branch name nor commit message reference the task', async () => {
    const readTipCommit = async () => 'docs: unrelated commit on main'
    await expect(
      assertBranchTipMatches(
        { id: 'audit-20260420-t-99', title: 'Test Task', agent_run_id: null },
        'agent/t-88-different-work-abcdef12',
        '/nonexistent',
        readTipCommit
      )
    ).rejects.toBeInstanceOf(BranchTipMismatchError)
  })
})

describe('hasCommitsAheadOfMain — no-commits structured event', () => {
  function makeLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
  }

  function makeRepo(): IAgentTaskRepository {
    return {
      getTask: vi.fn().mockReturnValue({ id: 'task-1', status: 'active', started_at: null }),
      updateTask: vi.fn().mockResolvedValue(undefined),
      claimTask: vi.fn(),
      getQueuedTasks: vi.fn().mockReturnValue([]),
      getOrphanedTasks: vi.fn().mockReturnValue([]),
      getTasksWithDependencies: vi.fn().mockReturnValue([]),
      clearStaleClaimedBy: vi.fn().mockReturnValue(0),
      getActiveTaskCount: vi.fn().mockReturnValue(0),
      getGroup: vi.fn().mockReturnValue(null),
      getGroupTasks: vi.fn().mockReturnValue([]),
      getGroupsWithDependencies: vi.fn().mockReturnValue([])
    } as unknown as IAgentTaskRepository
  }

  function makeBaseOpts(overrides: Partial<Parameters<typeof hasCommitsAheadOfMain>[0]> = {}) {
    const logger = makeLogger()
    const repo = makeRepo()
    const resolveFailure = vi.fn().mockResolvedValue({ isTerminal: false, writeFailed: false })
    return {
      taskId: 'task-1',
      branch: 'agent/t-1-test-branch-abcdef12',
      worktreePath: '/tmp/worktrees/task-1',
      agentSummary: null,
      retryCount: 0,
      repo,
      logger,
      onTaskTerminal: vi.fn().mockResolvedValue(undefined),
      taskStateService: { transition: vi.fn().mockResolvedValue(undefined) } as never,
      resolveFailure,
      ...overrides
    }
  }

  beforeEach(() => {
    mockExecFileAsync.mockReset()
  })

  it('emits completion.no_commits event when rev-list returns 0 and retry is available', async () => {
    // All execFileAsync calls return empty — rev-list=0, git diff/status for logging
    mockExecFileAsync.mockResolvedValue({ stdout: '0\n', stderr: '' })

    const opts = makeBaseOpts({ retryCount: 0 })
    await hasCommitsAheadOfMain(opts)

    expect(opts.logger.event).toHaveBeenCalledWith(
      'completion.no_commits',
      expect.objectContaining({ taskId: 'task-1', branch: 'agent/t-1-test-branch-abcdef12', retryCount: 0 })
    )
  })

  it('emits completion.no_commits event when rev-list returns 0 and retries are exhausted', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '0\n', stderr: '' })

    // MAX_NO_COMMITS_RETRIES is 3 — pass retryCount at or above to trigger exhausted path
    const opts = makeBaseOpts({ retryCount: 3 })
    await hasCommitsAheadOfMain(opts)

    expect(opts.logger.event).toHaveBeenCalledWith(
      'completion.no_commits',
      expect.objectContaining({ taskId: 'task-1', retryCount: 3 })
    )
  })

  it('does not emit completion.no_commits when commits exist', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '3\n', stderr: '' })

    const opts = makeBaseOpts()
    await hasCommitsAheadOfMain(opts)

    expect(opts.logger.event).not.toHaveBeenCalledWith('completion.no_commits', expect.anything())
  })
})
