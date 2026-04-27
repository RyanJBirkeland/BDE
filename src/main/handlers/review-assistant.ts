import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'
import { buildAgentPrompt } from '../lib/prompt-composer'
import { runSdkStreaming } from '../sdk-streaming'
import { isValidTaskId } from '../lib/validation'
import { resolveAgentRuntime as resolveAgentRuntimeFn } from '../agent-manager/backend-selector'
import type { AgentBackendConfig } from '../agent-manager/backend-selector'
import type { ReviewService } from '../services/review-service'
import type { IReviewRepository } from '../data/review-repository'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { ChatChunk, PartnerMessage, ReviewResult } from '../../shared/types'
import { getErrorMessage } from '../../shared/errors'

const log = createLogger('review-assistant')

// Hard ceiling on spend for a single reviewer-chat session. The chat is
// user-triggered and open-ended; a runaway tool-use loop or prompt-injected
// conversation would otherwise accumulate cost without bound. Matches the
// pipeline default (src/main/agent-manager/spawn-sdk.ts). Exported so the
// SDK-options policy guardrail test can assert the invariant in one place.
export const REVIEWER_CHAT_MAX_BUDGET_USD = 2.0

// ---------- Pure logic functions (testable without ipcMain) ----------

/** autoReview handler body — extracted for unit testing. */
export async function handleAutoReview(
  svc: Pick<ReviewService, 'reviewChanges'>,
  taskId: string,
  force: boolean
): Promise<ReviewResult> {
  if (!isValidTaskId(taskId)) {
    throw new Error('Invalid task ID format')
  }
  log.info(`review:autoReview task=${taskId} force=${force}`)
  return svc.reviewChanges(taskId, { force })
}

export interface ChatStreamDeps {
  taskRepo: IAgentTaskRepository
  reviewRepo: IReviewRepository
  getHeadCommitSha: (worktreePath: string) => Promise<string>
  getBranch: (worktreePath: string) => Promise<string>
  getDiff: (worktreePath: string) => Promise<string>
  buildChatPrompt: typeof buildAgentPrompt
  runSdkStreaming: typeof runSdkStreaming
  activeStreams: Map<string, { close: () => void }>
  resolveAgentRuntime: () => AgentBackendConfig
}

/**
 * chatStream handler body — extracted for unit testing. Returns immediately
 * with the streamId; streaming runs asynchronously and pushes chunks to the
 * sender via `review:chatChunk`.
 */
export async function handleChatStream(
  deps: ChatStreamDeps,
  input: { taskId: string; messages: PartnerMessage[] },
  sender: Pick<WebContents, 'send'> | null
): Promise<{ streamId: string }> {
  if (!isValidTaskId(input.taskId)) {
    throw new Error('Invalid task ID format')
  }
  const streamId = randomUUID()
  log.info(`review:chatStream task=${input.taskId} stream=${streamId}`)

  const task = deps.taskRepo.getTask(input.taskId)
  if (!task) throw new Error(`Task not found: ${input.taskId}`)
  if (!task.worktree_path) {
    throw new Error(`Task ${input.taskId} has no worktree path`)
  }

  // Look up the cached review to pass as reviewSeed — gives the chat model
  // access to the structured auto-review state, not just visible messages.
  let reviewSeed: ReviewResult | undefined
  try {
    const headSha = await deps.getHeadCommitSha(task.worktree_path)
    reviewSeed = deps.reviewRepo.getCached(input.taskId, headSha) ?? undefined
  } catch (err) {
    log.warn(`Could not load review seed for task=${input.taskId}: ${(err as Error).message}`)
  }

  const branch = await deps.getBranch(task.worktree_path)
  const diff = await deps.getDiff(task.worktree_path)

  const prompt = deps.buildChatPrompt({
    agentType: 'reviewer',
    reviewerMode: 'chat',
    taskContent: task.spec ?? task.title,
    branch,
    diff,
    messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    reviewSeed
  })

  const { model: reviewerModel } = deps.resolveAgentRuntime()

  ;(async () => {
    try {
      const full = await deps.runSdkStreaming(
        prompt,
        (chunk) => {
          const payload: ChatChunk = { streamId, chunk }
          sender?.send('review:chatChunk', payload)
        },
        deps.activeStreams,
        streamId,
        180_000,
        {
          cwd: task.worktree_path!,
          tools: ['Read', 'Grep', 'Glob'],
          model: reviewerModel,
          // Reviewer chat is read-only (Read/Grep/Glob) — bypass is safe and
          // keeps the chat streaming headless without human-in-the-loop prompts.
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          // Skip CLAUDE.md at spawn — reviewer conventions come from the
          // composed prompt (Option-A debranding policy). Without this, the
          // SDK defaults to ['user','project','local'] and silently loads
          // the project's CLAUDE.md into every chat session.
          settingSources: [],
          maxBudgetUsd: REVIEWER_CHAT_MAX_BUDGET_USD,
          onToolUse: (event) => {
            const payload: ChatChunk = { streamId, toolUse: event }
            sender?.send('review:chatChunk', payload)
          }
        }
      )
      const done: ChatChunk = { streamId, done: true, fullText: full }
      sender?.send('review:chatChunk', done)
      deps.activeStreams.delete(streamId)
    } catch (err) {
      log.error(`review:chatStream failed stream=${streamId}: ${(err as Error).message}`)
      const payload: ChatChunk = { streamId, error: (err as Error).message }
      sender?.send('review:chatChunk', payload)
      deps.activeStreams.delete(streamId)
    }
  })().catch((err) =>
    log.error(`[review-assistant] unhandled rejection in chatStream: ${getErrorMessage(err)}`)
  )

  return { streamId }
}

/** Build the ChatStreamDeps bag from the registration inputs. */
export function buildChatStreamDeps(input: {
  taskRepo: IAgentTaskRepository
  reviewRepo: IReviewRepository
  getHeadCommitSha: (worktreePath: string) => Promise<string>
  getBranch: (worktreePath: string) => Promise<string>
  getDiff: (worktreePath: string) => Promise<string>
  activeStreams: Map<string, { close: () => void }>
}): ChatStreamDeps {
  return {
    ...input,
    buildChatPrompt: buildAgentPrompt,
    runSdkStreaming,
    resolveAgentRuntime: () => resolveAgentRuntimeFn('reviewer')
  }
}

// ---------- Registration (wraps the pure functions in safeHandle) ----------

export interface ReviewAssistantRegistrationInput {
  reviewService: ReviewService
  chatStreamDeps: ChatStreamDeps
}

export function registerReviewAssistantHandlers(input: ReviewAssistantRegistrationInput): void {
  safeHandle('review:autoReview', async (_e, taskId, force) => {
    return handleAutoReview(input.reviewService, taskId, force)
  })

  safeHandle('review:chatStream', async (e, chatInput) => {
    return handleChatStream(input.chatStreamDeps, chatInput, e.sender)
  })

  safeHandle('review:chatAbort', async (_e, streamId) => {
    log.info(`review:chatAbort stream=${streamId}`)
    const entry = input.chatStreamDeps.activeStreams.get(streamId)
    if (entry) entry.close()
  })
}
