import type Database from 'better-sqlite3'
import type { ReviewResult } from '../../shared/types'
import { createLogger } from '../logger'

const log = createLogger('review-repository')

export interface IReviewRepository {
  getCached(taskId: string, commitSha: string): ReviewResult | null
  setCached(taskId: string, commitSha: string, result: ReviewResult, rawResponse: string): void
  invalidate(taskId: string): void
}

interface Row {
  task_id: string
  commit_sha: string
  quality_score: number
  issues_count: number
  files_count: number
  opening_message: string
  findings_json: string
  raw_response: string
  model: string
  created_at: number
}

export function createReviewRepository(db: Database.Database): IReviewRepository {
  const getStmt = db.prepare<[string, string]>(
    'SELECT * FROM task_reviews WHERE task_id = ? AND commit_sha = ?'
  )
  const upsertStmt = db.prepare<
    [string, string, number, number, number, string, string, string, string, number]
  >(
    `INSERT OR REPLACE INTO task_reviews
     (task_id, commit_sha, quality_score, issues_count, files_count,
      opening_message, findings_json, raw_response, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const deleteRowStmt = db.prepare<[string, string]>(
    'DELETE FROM task_reviews WHERE task_id = ? AND commit_sha = ?'
  )
  const invalidateStmt = db.prepare<[string]>('DELETE FROM task_reviews WHERE task_id = ?')

  return {
    getCached(taskId, commitSha) {
      const row = getStmt.get(taskId, commitSha) as Row | undefined
      if (!row) return null
      try {
        const findings = JSON.parse(row.findings_json)
        return {
          qualityScore: row.quality_score,
          issuesCount: row.issues_count,
          filesCount: row.files_count,
          openingMessage: row.opening_message,
          findings,
          model: row.model,
          createdAt: row.created_at
        }
      } catch (err) {
        log.warn(
          `Corrupt findings_json for task=${taskId} sha=${commitSha}; deleting row: ${(err as Error).message}`
        )
        deleteRowStmt.run(taskId, commitSha)
        return null
      }
    },

    setCached(taskId, commitSha, result, rawResponse) {
      upsertStmt.run(
        taskId,
        commitSha,
        result.qualityScore,
        result.issuesCount,
        result.filesCount,
        result.openingMessage,
        JSON.stringify(result.findings),
        rawResponse,
        result.model,
        result.createdAt
      )
    },

    invalidate(taskId) {
      invalidateStmt.run(taskId)
    }
  }
}
