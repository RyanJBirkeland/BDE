import { describe, it, expect, vi } from 'vitest'
import { handleAutoReview, handleChatStream, buildChatStreamDeps } from './review-assistant'
import type { ReviewService } from '../services/review-service'
import type { IReviewRepository } from '../data/review-repository'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { ReviewResult, PartnerMessage, ChatChunk } from '../../shared/types'

function fakeResult(): ReviewResult {
  return {
    qualityScore: 88,
    issuesCount: 1,
    filesCount: 1,
    openingMessage: 'ok',
    findings: { perFile: [] },
    model: 'claude-opus-4-6',
    createdAt: 0
  }
}

function fakeTask() {
  return {
    id: 'task-1',
    title: 'Fix auth',
    spec: '# Spec',
    repo: 'bde',
    branch: 'feat/auth',
    status: 'review' as const,
    worktree_path: '/tmp/wt'
  } as any
}

describe('buildChatStreamDeps', () => {
  it('wires the injected inputs into the deps bag', () => {
    const taskRepo = {} as any
    const reviewRepo = {} as any
    const getHeadCommitSha = async () => 'sha'
    const getBranch = async () => 'feat/auth'
    const getDiff = async () => 'diff --git a/x b/x\n+ change'
    const activeStreams = new Map<string, { close: () => void }>()
    const deps = buildChatStreamDeps({
      taskRepo,
      reviewRepo,
      getHeadCommitSha,
      getBranch,
      getDiff,
      activeStreams
    })
    expect(deps.taskRepo).toBe(taskRepo)
    expect(deps.reviewRepo).toBe(reviewRepo)
    expect(deps.getHeadCommitSha).toBe(getHeadCommitSha)
    expect(deps.getBranch).toBe(getBranch)
    expect(deps.getDiff).toBe(getDiff)
    expect(deps.activeStreams).toBe(activeStreams)
    expect(typeof deps.buildChatPrompt).toBe('function')
    expect(typeof deps.runSdkStreaming).toBe('function')
  })
})

describe('handleAutoReview', () => {
  it('delegates to reviewService.reviewChanges', async () => {
    const reviewChanges = vi.fn().mockResolvedValue(fakeResult())
    const svc: ReviewService = { reviewChanges }
    const result = await handleAutoReview(svc, 'task-1', false)
    expect(reviewChanges).toHaveBeenCalledWith('task-1', { force: false })
    expect(result.qualityScore).toBe(88)
  })

  it('passes force flag through', async () => {
    const reviewChanges = vi.fn().mockResolvedValue(fakeResult())
    await handleAutoReview({ reviewChanges }, 'task-x', true)
    expect(reviewChanges).toHaveBeenCalledWith('task-x', { force: true })
  })

  it('rejects when reviewService throws', async () => {
    const reviewChanges = vi.fn().mockRejectedValue(new Error('nope'))
    await expect(handleAutoReview({ reviewChanges }, 'task-y', false)).rejects.toThrow('nope')
  })

  it('rejects invalid taskId format', async () => {
    const reviewChanges = vi.fn()
    const svc: ReviewService = { reviewChanges }
    // Path traversal attempt
    await expect(handleAutoReview(svc, '../../../etc/passwd', false)).rejects.toThrow(
      'Invalid task ID format'
    )
    // Shell injection attempt
    await expect(handleAutoReview(svc, 'task; rm -rf /', false)).rejects.toThrow(
      'Invalid task ID format'
    )
    // Empty string
    await expect(handleAutoReview(svc, '', false)).rejects.toThrow('Invalid task ID format')
    // Non-string
    await expect(handleAutoReview(svc, null as any, false)).rejects.toThrow(
      'Invalid task ID format'
    )
    // Service should never be called for invalid IDs
    expect(reviewChanges).not.toHaveBeenCalled()
  })
})

describe('handleChatStream', () => {
  it('starts a stream and emits chunks + done', async () => {
    const chunks: ChatChunk[] = []
    const sender = { send: (_ch: string, payload: ChatChunk) => chunks.push(payload) }
    const deps = {
      taskRepo: { getTask: () => fakeTask() } as unknown as IAgentTaskRepository,
      reviewRepo: {
        getCached: () => fakeResult(),
        setCached: () => {},
        invalidate: () => {}
      } as IReviewRepository,
      getHeadCommitSha: async () => 'sha-abc',
      getBranch: async () => 'feat/auth',
      getDiff: async () => 'diff --git a/x b/x\n+ change',
      buildChatPrompt: vi.fn().mockReturnValue('BUILT_PROMPT'),
      runSdkStreaming: vi.fn(
        async (
          _prompt: string,
          onChunk: (c: string) => void,
          _map: Map<string, { close: () => void }>,
          _id: string,
          _t: number,
          _opts: any
        ) => {
          onChunk('hello ')
          onChunk('world')
          return 'hello world'
        }
      ),
      activeStreams: new Map<string, { close: () => void }>()
    }
    const input: { taskId: string; messages: PartnerMessage[] } = {
      taskId: 'task-1',
      messages: [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 0 }]
    }

    const { streamId } = await handleChatStream(deps, input, sender as any)
    // Streaming runs asynchronously after the return — flush microtasks
    await new Promise((r) => setImmediate(r))

    expect(streamId).toMatch(/^review-/)
    expect(deps.buildChatPrompt).toHaveBeenCalled()
    const promptArg = deps.buildChatPrompt.mock.calls[0]?.[0]
    expect(promptArg?.agentType).toBe('reviewer')
    expect(promptArg?.reviewerMode).toBe('chat')
    expect(promptArg?.reviewSeed).toBeDefined() // seed lookup confirmed
    expect(promptArg?.branch).toBe('feat/auth')
    expect(promptArg?.diff).toBeTruthy()
    expect(chunks.some((c) => c.chunk === 'hello ')).toBe(true)
    expect(chunks.some((c) => c.done === true)).toBe(true)
  })

  it('emits error chunk when runSdkStreaming throws', async () => {
    const chunks: ChatChunk[] = []
    const sender = { send: (_c: string, p: ChatChunk) => chunks.push(p) }
    const deps = {
      taskRepo: { getTask: () => fakeTask() } as unknown as IAgentTaskRepository,
      reviewRepo: {
        getCached: () => null,
        setCached: () => {},
        invalidate: () => {}
      } as IReviewRepository,
      getHeadCommitSha: async () => 'sha-abc',
      getBranch: async () => 'feat/auth',
      getDiff: async () => 'diff --git a/x b/x\n+ change',
      buildChatPrompt: () => 'prompt',
      runSdkStreaming: async () => {
        throw new Error('rate limit')
      },
      activeStreams: new Map<string, { close: () => void }>()
    }
    await handleChatStream(deps, { taskId: 'task-1', messages: [] }, sender as any)
    await new Promise((r) => setImmediate(r))
    expect(chunks.some((c) => c.error?.includes('rate limit'))).toBe(true)
  })

  it('throws when task is not found', async () => {
    const sender = { send: () => {} }
    const deps = {
      taskRepo: { getTask: () => null } as unknown as IAgentTaskRepository,
      reviewRepo: { getCached: () => null, setCached: () => {}, invalidate: () => {} },
      getHeadCommitSha: async () => 'sha',
      getBranch: async () => 'feat/auth',
      getDiff: async () => '',
      buildChatPrompt: () => '',
      runSdkStreaming: async () => '',
      activeStreams: new Map()
    }
    await expect(
      handleChatStream(deps, { taskId: 'missing', messages: [] }, sender as any)
    ).rejects.toThrow(/not found/i)
  })

  it('rejects invalid taskId format before task lookup', async () => {
    const sender = { send: () => {} }
    const taskRepo = { getTask: vi.fn() }
    const deps = {
      taskRepo: taskRepo as unknown as IAgentTaskRepository,
      reviewRepo: { getCached: () => null, setCached: () => {}, invalidate: () => {} },
      getHeadCommitSha: async () => 'sha',
      getBranch: async () => 'feat/auth',
      getDiff: async () => '',
      buildChatPrompt: () => '',
      runSdkStreaming: async () => '',
      activeStreams: new Map()
    }
    // Path traversal attempt
    await expect(
      handleChatStream(deps, { taskId: '../../../etc/passwd', messages: [] }, sender as any)
    ).rejects.toThrow('Invalid task ID format')
    // Shell injection attempt
    await expect(
      handleChatStream(deps, { taskId: 'task; rm -rf /', messages: [] }, sender as any)
    ).rejects.toThrow('Invalid task ID format')
    // Empty string
    await expect(
      handleChatStream(deps, { taskId: '', messages: [] }, sender as any)
    ).rejects.toThrow('Invalid task ID format')
    // Non-string
    await expect(
      handleChatStream(deps, { taskId: null as any, messages: [] }, sender as any)
    ).rejects.toThrow('Invalid task ID format')
    // Task lookup should never be called for invalid IDs
    expect(taskRepo.getTask).not.toHaveBeenCalled()
  })
})
