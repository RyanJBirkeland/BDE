import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../diff-snapshot', () => ({ captureDiffSnapshot: vi.fn() }))
vi.mock('../../shared/time', () => ({ nowIso: vi.fn(() => '2026-04-25T18:00:00.000Z') }))
vi.mock('../../lib/async-utils', () => ({ execFileAsync: vi.fn() }))
vi.mock('../../env-utils', () => ({ buildAgentEnv: vi.fn(() => ({})) }))

import { transitionToReview } from '../review-transition'
import type { TransitionToReviewOpts } from '../review-transition'
import { captureDiffSnapshot } from '../diff-snapshot'
import { execFileAsync } from '../../lib/async-utils'

function makeOpts(overrides: Partial<TransitionToReviewOpts> = {}): TransitionToReviewOpts {
  return {
    taskId: 'task-1',
    worktreePath: '/tmp/worktrees/task-1',
    rebaseNote: undefined,
    rebaseBaseSha: 'abc123',
    rebaseSucceeded: true,
    repo: {
      getTask: vi.fn().mockReturnValue({ id: 'task-1', started_at: '2026-04-25T17:00:00.000Z' })
    } as never,
    logger: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn()
    } as never,
    taskStateService: { transition: vi.fn().mockResolvedValue(undefined) } as never,
    ...overrides
  }
}

beforeEach(() => {
  vi.mocked(captureDiffSnapshot).mockResolvedValue(null)
  vi.mocked(execFileAsync).mockResolvedValue({ stdout: '3\n', stderr: '' })
})

describe('transitionToReview — happy path', () => {
  it('calls transition with review status and core fields', async () => {
    const opts = makeOpts()
    await transitionToReview(opts)
    expect(opts.taskStateService.transition).toHaveBeenCalledWith(
      'task-1', 'review',
      expect.objectContaining({
        fields: expect.objectContaining({
          worktree_path: '/tmp/worktrees/task-1',
          claimed_by: null,
          promoted_to_review_at: '2026-04-25T18:00:00.000Z'
        }),
        caller: 'review-transition'
      })
    )
  })

  it('includes rebase_base_sha and rebased_at when rebase succeeded', async () => {
    const opts = makeOpts({ rebaseBaseSha: 'def456', rebaseSucceeded: true })
    await transitionToReview(opts)
    const call = vi.mocked(opts.taskStateService.transition).mock.calls[0]
    expect(call[2]?.fields?.rebase_base_sha).toBe('def456')
    expect(call[2]?.fields?.rebased_at).toBeTruthy()
  })

  it('sets rebased_at to null when rebase failed', async () => {
    const opts = makeOpts({ rebaseSucceeded: false })
    await transitionToReview(opts)
    const call = vi.mocked(opts.taskStateService.transition).mock.calls[0]
    expect(call[2]?.fields?.rebased_at).toBeNull()
  })
})

describe('transitionToReview — diff snapshot failure', () => {
  it('proceeds to transition even when snapshot capture throws', async () => {
    vi.mocked(captureDiffSnapshot).mockRejectedValue(new Error('git error'))
    const opts = makeOpts()
    await transitionToReview(opts)
    expect(opts.taskStateService.transition).toHaveBeenCalledWith(
      'task-1', 'review', expect.anything()
    )
  })
})

describe('transitionToReview — T-8 fallback to failed', () => {
  it('transitions to failed when review transition throws', async () => {
    const opts = makeOpts()
    vi.mocked(opts.taskStateService.transition)
      .mockRejectedValueOnce(new Error('InvalidTransition'))
      .mockResolvedValueOnce(undefined)
    await transitionToReview(opts)
    const calls = vi.mocked(opts.taskStateService.transition).mock.calls
    expect(calls[0][1]).toBe('review')
    expect(calls[1][1]).toBe('failed')
    expect(calls[1][2]?.fields?.failure_reason).toBe('review-transition-failed')
  })
})
