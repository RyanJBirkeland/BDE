import type { ReviewFindings, FileFinding, ReviewResult } from '../../shared/types'
import type { IReviewRepository } from '../data/review-repository'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import type { SdkStreamingOptions } from '../sdk-streaming'
import { buildAgentPrompt } from '../lib/prompt-composer'
import { parseReviewResponse, MalformedReviewError } from './review-response-parser'
import type { ParsedReview } from './review-response-parser'

export class WorktreeMissingError extends Error {
  constructor(public readonly path: string) {
    super(`Worktree not found at ${path}`)
    this.name = 'WorktreeMissingError'
  }
}

export { MalformedReviewError, parseReviewResponse }
export type { ParsedReview }
export type { ReviewFindings }

export interface ReviewServiceDeps {
  repo: IReviewRepository
  taskRepo: IAgentTaskRepository
  logger: Logger
  resolveWorktreePath: (taskId: string) => Promise<string>
  getHeadCommitSha: (worktreePath: string) => Promise<string>
  getDiff: (worktreePath: string) => Promise<string>
  getBranch: (worktreePath: string) => Promise<string>
  runSdkOnce: (prompt: string, options: SdkStreamingOptions) => Promise<string>
}

export interface ReviewService {
  reviewChanges(taskId: string, opts?: { force?: boolean }): Promise<ReviewResult>
}

const REVIEWER_MODEL = 'claude-opus-4-6'

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const {
    repo,
    taskRepo,
    logger,
    resolveWorktreePath,
    getHeadCommitSha,
    getDiff,
    getBranch,
    runSdkOnce
  } = deps

  return {
    async reviewChanges(taskId, opts) {
      const task = taskRepo.getTask(taskId)
      if (!task) {
        throw new Error(`Task not found: ${taskId}`)
      }
      if (task.status !== 'review') {
        throw new Error(`Task ${taskId} is not in review status (current: ${task.status})`)
      }

      const worktreePath = await resolveWorktreePath(taskId)
      const headSha = await getHeadCommitSha(worktreePath)

      if (!opts?.force) {
        const cached = repo.getCached(taskId, headSha)
        if (cached) {
          logger.info(`Cache hit for task=${taskId} sha=${headSha}`)
          return cached
        }
      }

      const diff = await getDiff(worktreePath)
      const branch = await getBranch(worktreePath)

      if (!diff.trim()) {
        logger.info(`Empty diff for task=${taskId} — synthetic result`)
        const synthetic: ReviewResult = {
          qualityScore: 100,
          issuesCount: 0,
          filesCount: 0,
          openingMessage: 'No changes detected on this branch.',
          findings: { perFile: [], branch },
          model: '(none)',
          createdAt: Date.now()
        }
        return synthetic
      }

      const prompt = buildAgentPrompt({
        agentType: 'reviewer',
        reviewerMode: 'review',
        taskContent: task.spec ?? task.title,
        branch,
        diff
      })

      logger.info(`Firing auto-review for task=${taskId} sha=${headSha}`)
      let raw: string
      try {
        raw = await runSdkOnce(prompt, {
          model: REVIEWER_MODEL,
          maxTurns: 1,
          tools: [],
          // Reviewer generates opinions, not code. CLAUDE.md implementation
          // guidelines are irrelevant and waste ~5-10KB per review call.
          settingSources: []
        })
      } catch (err) {
        logger.error(`Review SDK call failed for task=${taskId}: ${(err as Error).message}`)
        throw err
      }

      let parsed: ParsedReview
      try {
        parsed = parseReviewResponse(raw)
      } catch (err) {
        logger.error(`Parse failed for task=${taskId}: ${(err as Error).message}`)
        throw err
      }

      const aggregates = aggregate(parsed.perFile)
      const result: ReviewResult = {
        qualityScore: parsed.qualityScore,
        issuesCount: aggregates.issuesCount,
        filesCount: aggregates.filesCount,
        openingMessage: parsed.openingMessage,
        findings: { perFile: parsed.perFile, branch },
        model: REVIEWER_MODEL,
        createdAt: Date.now()
      }

      repo.setCached(taskId, headSha, result, raw)
      return result
    }
  }
}

function aggregate(perFile: FileFinding[]): {
  filesCount: number
  issuesCount: number
} {
  let issuesCount = 0
  for (const f of perFile) {
    for (const c of f.comments) {
      if (c.severity === 'high' || c.severity === 'medium') issuesCount++
    }
  }
  return { filesCount: perFile.length, issuesCount }
}
