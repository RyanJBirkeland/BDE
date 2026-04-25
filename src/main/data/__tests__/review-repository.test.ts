import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runMigrations } from '../../db'
import { createReviewRepository } from '../review-repository'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})
afterEach(() => {
  db.close()
})

function insertRawRow(taskId: string, commitSha: string, findingsJson: string): void {
  db.prepare(
    `INSERT INTO task_reviews
     (task_id, commit_sha, quality_score, issues_count, files_count, opening_message,
      findings_json, raw_response, model, created_at)
     VALUES (?, ?, 80, 2, 3, 'looks good', ?, '{}', 'claude', 1000)`
  ).run(taskId, commitSha, findingsJson)
}

describe('review-repository getCached — findings_json validation', () => {
  it('returns findings when findings_json is a valid ReviewFindings object', () => {
    const repo = createReviewRepository(db)
    insertRawRow('t-1', 'abc123', JSON.stringify({ perFile: [{ path: 'foo.ts', comments: [] }] }))
    const result = repo.getCached('t-1', 'abc123')
    expect(result).not.toBeNull()
    expect(Array.isArray(result!.findings.perFile)).toBe(true)
    expect(result!.findings.perFile).toHaveLength(1)
  })

  it('returns empty perFile when findings_json has unexpected shape', () => {
    const repo = createReviewRepository(db)
    insertRawRow('t-2', 'def456', JSON.stringify({ not: 'a findings object' }))
    const result = repo.getCached('t-2', 'def456')
    expect(result).not.toBeNull()
    expect(result!.findings.perFile).toEqual([])
  })

  it('returns null and deletes the row when findings_json is malformed JSON', () => {
    const repo = createReviewRepository(db)
    insertRawRow('t-3', 'ghi789', 'not-valid-json')
    const result = repo.getCached('t-3', 'ghi789')
    expect(result).toBeNull()
    const row = db.prepare('SELECT * FROM task_reviews WHERE task_id = ?').get('t-3')
    expect(row).toBeUndefined()
  })
})
