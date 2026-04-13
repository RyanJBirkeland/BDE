import type { ReviewFindings, FileFinding } from '../../shared/types'

export class WorktreeMissingError extends Error {
  constructor(public readonly path: string) {
    super(`Worktree not found at ${path}`)
    this.name = 'WorktreeMissingError'
  }
}

export class MalformedReviewError extends Error {
  constructor(
    message: string,
    public readonly rawResponse?: string
  ) {
    super(message)
    this.name = 'MalformedReviewError'
  }
}

/** Parsed shape returned by the reviewer model — not yet aggregated. */
export interface ParsedReview {
  qualityScore: number
  openingMessage: string
  perFile: FileFinding[]
}

/**
 * Strip markdown fences, locate the JSON object in the model output, and
 * validate its shape. Throws `MalformedReviewError` on any failure.
 */
export function parseReviewResponse(raw: string): ParsedReview {
  const cleaned = stripFences(raw)
  const jsonText = extractFirstJsonObject(cleaned)
  if (!jsonText) {
    throw new MalformedReviewError('No JSON object found in model response', raw)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new MalformedReviewError(`JSON.parse failed: ${(err as Error).message}`, raw)
  }

  return validateParsedReview(parsed, raw)
}

function stripFences(raw: string): string {
  let out = raw.trim()
  // ```json\n...\n```
  const fenceMatch = out.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fenceMatch) out = (fenceMatch[1] ?? '').trim()
  return out
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function validateParsedReview(value: unknown, raw: string): ParsedReview {
  if (!value || typeof value !== 'object') {
    throw new MalformedReviewError('Response is not an object', raw)
  }
  const v = value as Record<string, unknown>

  if (typeof v.qualityScore !== 'number') {
    throw new MalformedReviewError('qualityScore missing or non-numeric', raw)
  }
  if (v.qualityScore < 0 || v.qualityScore > 100) {
    throw new MalformedReviewError('qualityScore out of range 0-100', raw)
  }
  if (typeof v.openingMessage !== 'string' || !v.openingMessage.trim()) {
    throw new MalformedReviewError('openingMessage missing or empty', raw)
  }
  if (!Array.isArray(v.perFile)) {
    throw new MalformedReviewError('perFile missing or not an array', raw)
  }

  const perFile: FileFinding[] = v.perFile.map((entry: unknown, idx: number) => {
    if (!entry || typeof entry !== 'object') {
      throw new MalformedReviewError(`perFile[${idx}] not an object`, raw)
    }
    const f = entry as Record<string, unknown>
    if (typeof f.path !== 'string') {
      throw new MalformedReviewError(`perFile[${idx}].path missing`, raw)
    }
    if (f.status !== 'clean' && f.status !== 'issues') {
      throw new MalformedReviewError(`perFile[${idx}].status invalid`, raw)
    }
    const comments = Array.isArray(f.comments) ? f.comments : []
    return {
      path: f.path,
      status: f.status,
      commentCount: comments.length,
      comments: comments.map((c: unknown, ci: number) => {
        if (!c || typeof c !== 'object') {
          throw new MalformedReviewError(`perFile[${idx}].comments[${ci}] not an object`, raw)
        }
        const cc = c as Record<string, unknown>
        return {
          line: typeof cc.line === 'number' ? cc.line : 0,
          severity:
            cc.severity === 'high' || cc.severity === 'medium' || cc.severity === 'low'
              ? cc.severity
              : 'low',
          category:
            cc.category === 'security' ||
            cc.category === 'performance' ||
            cc.category === 'correctness' ||
            cc.category === 'style'
              ? cc.category
              : 'correctness',
          message: typeof cc.message === 'string' ? cc.message : ''
        }
      })
    }
  })

  return {
    qualityScore: Math.round(v.qualityScore),
    openingMessage: v.openingMessage,
    perFile
  }
}

export type { ReviewFindings }

import type { IReviewRepository } from '../data/review-repository'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import type { SdkStreamingOptions } from '../sdk-streaming'
import type { ReviewResult } from '../../shared/types'
import { buildAgentPrompt } from '../agent-manager/prompt-composer'

export interface ReviewServiceDeps {
  repo: IReviewRepository
  taskRepo: ISprintTaskRepository
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
          tools: []
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
