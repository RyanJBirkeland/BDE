import { describe, it, expect } from 'vitest'
import { parseReviewResponse, MalformedReviewError } from './review-service'

describe('parseReviewResponse', () => {
  const validJson = JSON.stringify({
    qualityScore: 92,
    openingMessage: 'Looks good.',
    perFile: [
      {
        path: 'src/foo.ts',
        status: 'issues',
        comments: [{ line: 10, severity: 'high', category: 'security', message: 'XSS' }]
      }
    ]
  })

  it('parses plain JSON', () => {
    const out = parseReviewResponse(validJson)
    expect(out.qualityScore).toBe(92)
    expect(out.perFile[0]?.path).toBe('src/foo.ts')
  })

  it('strips ```json fences', () => {
    const out = parseReviewResponse('```json\n' + validJson + '\n```')
    expect(out.qualityScore).toBe(92)
  })

  it('strips plain ``` fences', () => {
    const out = parseReviewResponse('```\n' + validJson + '\n```')
    expect(out.qualityScore).toBe(92)
  })

  it('strips leading/trailing prose', () => {
    const out = parseReviewResponse('Here is the review:\n' + validJson + '\nHope that helps!')
    expect(out.qualityScore).toBe(92)
  })

  it('throws MalformedReviewError on non-JSON', () => {
    expect(() => parseReviewResponse('not json at all')).toThrow(MalformedReviewError)
  })

  it('throws on missing required fields', () => {
    expect(() => parseReviewResponse('{"qualityScore": 92}')).toThrow(MalformedReviewError)
  })

  it('throws on qualityScore out of range', () => {
    const bad = JSON.stringify({
      qualityScore: 150,
      openingMessage: 'bad',
      perFile: []
    })
    expect(() => parseReviewResponse(bad)).toThrow(MalformedReviewError)
  })
})

import { createReviewService, WorktreeMissingError } from './review-service'
import type { IReviewRepository } from '../data/review-repository'
import type { ReviewResult } from '../../shared/types'

function makeFakeRepo(): IReviewRepository & { _set: Record<string, ReviewResult> } {
  const _set: Record<string, ReviewResult> = {}
  return {
    _set,
    getCached: (taskId, sha) => _set[`${taskId}:${sha}`] ?? null,
    setCached: (taskId, sha, result) => {
      _set[`${taskId}:${sha}`] = result
    },
    invalidate: (taskId) => {
      for (const k of Object.keys(_set)) {
        if (k.startsWith(taskId + ':')) delete _set[k]
      }
    }
  }
}

function makeTask() {
  return {
    id: 'task-1',
    title: 'Fix auth',
    spec: '# Spec\nFix auth.',
    repo: 'bde',
    branch: 'feat/auth',
    status: 'review' as const
  }
}

function makeFakeTaskRepo(task = makeTask()) {
  return {
    getTask: (id: string) => (id === task.id ? task : null)
  } as any
}

function baseDeps(overrides: Partial<any> = {}) {
  return {
    repo: makeFakeRepo(),
    taskRepo: makeFakeTaskRepo(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    resolveWorktreePath: async () => '/tmp/fake-worktree',
    getHeadCommitSha: async () => 'sha-abc',
    getDiff: async () => 'diff --git a/x b/x\n+ change',
    getBranch: async () => 'feat/auth',
    runSdkOnce: async () =>
      JSON.stringify({
        qualityScore: 88,
        openingMessage: 'Looks good.',
        perFile: [
          {
            path: 'src/foo.ts',
            status: 'issues',
            comments: [
              { line: 10, severity: 'high', category: 'security', message: 'XSS' },
              { line: 20, severity: 'medium', category: 'correctness', message: 'Off-by-one' },
              { line: 30, severity: 'low', category: 'style', message: 'Name' }
            ]
          },
          { path: 'src/bar.ts', status: 'clean', comments: [] }
        ]
      }),
    ...overrides
  }
}

describe('reviewService.reviewChanges', () => {
  it('returns the cached result without hitting the SDK', async () => {
    const repo = makeFakeRepo()
    const cached: ReviewResult = {
      qualityScore: 77,
      issuesCount: 0,
      filesCount: 1,
      openingMessage: 'From cache.',
      findings: { perFile: [] },
      model: 'claude-opus-4-6',
      createdAt: 0
    }
    repo._set['task-1:sha-abc'] = cached

    let sdkCalled = false
    const svc = createReviewService(
      baseDeps({
        repo,
        runSdkOnce: async () => {
          sdkCalled = true
          return '{}'
        }
      })
    )

    const result = await svc.reviewChanges('task-1')
    expect(result.openingMessage).toBe('From cache.')
    expect(sdkCalled).toBe(false)
  })

  it('force:true bypasses the cache', async () => {
    const repo = makeFakeRepo()
    repo._set['task-1:sha-abc'] = {
      qualityScore: 1,
      issuesCount: 0,
      filesCount: 0,
      openingMessage: 'Stale.',
      findings: { perFile: [] },
      model: 'x',
      createdAt: 0
    }

    const svc = createReviewService(baseDeps({ repo }))
    const result = await svc.reviewChanges('task-1', { force: true })
    expect(result.openingMessage).toBe('Looks good.')
  })

  it('short-circuits on empty diff without calling the SDK', async () => {
    let sdkCalled = false
    const svc = createReviewService(
      baseDeps({
        getDiff: async () => '',
        runSdkOnce: async () => {
          sdkCalled = true
          return '{}'
        }
      })
    )
    const result = await svc.reviewChanges('task-1')
    expect(sdkCalled).toBe(false)
    expect(result.qualityScore).toBe(100)
    expect(result.filesCount).toBe(0)
    expect(result.openingMessage).toContain('No changes')
  })

  it('computes aggregates: filesCount and issuesCount (high+medium only)', async () => {
    const svc = createReviewService(baseDeps())
    const result = await svc.reviewChanges('task-1')
    expect(result.filesCount).toBe(2)
    // One high + one medium = 2 (the low-severity one does not count)
    expect(result.issuesCount).toBe(2)
  })

  it('persists the result to the cache', async () => {
    const repo = makeFakeRepo()
    const svc = createReviewService(baseDeps({ repo }))
    await svc.reviewChanges('task-1')
    expect(repo._set['task-1:sha-abc']).toBeDefined()
    expect(repo._set['task-1:sha-abc']?.qualityScore).toBe(88)
    expect(repo._set['task-1:sha-abc']?.findings.branch).toBe('feat/auth')
  })

  it('throws on malformed model response', async () => {
    const svc = createReviewService(baseDeps({ runSdkOnce: async () => 'not json, twice' }))
    await expect(svc.reviewChanges('task-1')).rejects.toThrow()
  })

  it('rejects when task is not in review status', async () => {
    const task = { ...makeTask(), status: 'queued' as const }
    const svc = createReviewService(baseDeps({ taskRepo: makeFakeTaskRepo(task) }))
    await expect(svc.reviewChanges('task-1')).rejects.toThrow(/review status/)
  })

  it('throws WorktreeMissingError when worktree resolver rejects', async () => {
    const svc = createReviewService(
      baseDeps({
        resolveWorktreePath: async () => {
          throw new WorktreeMissingError('/tmp/missing')
        }
      })
    )
    await expect(svc.reviewChanges('task-1')).rejects.toThrow(WorktreeMissingError)
  })
})
