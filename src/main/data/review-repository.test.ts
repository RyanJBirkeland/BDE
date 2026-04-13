import Database from 'better-sqlite3'
import { describe, it, expect, beforeEach } from 'vitest'
import { createReviewRepository, type IReviewRepository } from './review-repository'
import type { ReviewResult } from '../../shared/types'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.prepare(
    `CREATE TABLE IF NOT EXISTS task_reviews (
      task_id TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      quality_score INTEGER NOT NULL,
      issues_count INTEGER NOT NULL,
      files_count INTEGER NOT NULL,
      opening_message TEXT NOT NULL,
      findings_json TEXT NOT NULL,
      raw_response TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (task_id, commit_sha)
    )`
  ).run()
  return db
}

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    qualityScore: 92,
    issuesCount: 3,
    filesCount: 8,
    openingMessage: 'Looks good overall, few issues to address.',
    findings: {
      perFile: [
        {
          path: 'src/foo.ts',
          status: 'issues',
          commentCount: 2,
          comments: [
            { line: 10, severity: 'high', category: 'security', message: 'XSS' },
            { line: 20, severity: 'low', category: 'style', message: 'Name' }
          ]
        }
      ]
    },
    model: 'claude-opus-4-6',
    createdAt: 1_700_000_000_000,
    ...overrides
  }
}

describe('review-repository', () => {
  let db: Database.Database
  let repo: IReviewRepository

  beforeEach(() => {
    db = makeDb()
    repo = createReviewRepository(db)
  })

  it('returns null on cache miss', () => {
    expect(repo.getCached('task-1', 'abc123')).toBeNull()
  })

  it('round-trips a set then get', () => {
    const result = makeResult()
    repo.setCached('task-1', 'abc123', result, '{"raw":true}')
    const got = repo.getCached('task-1', 'abc123')
    expect(got).not.toBeNull()
    expect(got?.qualityScore).toBe(92)
    expect(got?.findings.perFile[0]?.path).toBe('src/foo.ts')
    expect(got?.findings.perFile[0]?.comments[0]?.severity).toBe('high')
  })

  it('differentiates rows by commit sha', () => {
    repo.setCached('task-1', 'sha-a', makeResult({ qualityScore: 80 }), 'raw-a')
    repo.setCached('task-1', 'sha-b', makeResult({ qualityScore: 95 }), 'raw-b')
    expect(repo.getCached('task-1', 'sha-a')?.qualityScore).toBe(80)
    expect(repo.getCached('task-1', 'sha-b')?.qualityScore).toBe(95)
  })

  it('upserts on set when a row already exists for the same key', () => {
    repo.setCached('task-1', 'abc', makeResult({ qualityScore: 50 }), 'raw1')
    repo.setCached('task-1', 'abc', makeResult({ qualityScore: 75 }), 'raw2')
    expect(repo.getCached('task-1', 'abc')?.qualityScore).toBe(75)
  })

  it('invalidate removes every sha for a task', () => {
    repo.setCached('task-1', 'sha-a', makeResult(), 'raw')
    repo.setCached('task-1', 'sha-b', makeResult(), 'raw')
    repo.setCached('task-2', 'sha-c', makeResult(), 'raw')
    repo.invalidate('task-1')
    expect(repo.getCached('task-1', 'sha-a')).toBeNull()
    expect(repo.getCached('task-1', 'sha-b')).toBeNull()
    expect(repo.getCached('task-2', 'sha-c')).not.toBeNull()
  })

  it('returns null and deletes the row when findings_json is corrupt', () => {
    db.prepare(
      `INSERT INTO task_reviews
       (task_id, commit_sha, quality_score, issues_count, files_count,
        opening_message, findings_json, raw_response, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('task-x', 'sha-x', 90, 0, 1, 'msg', '{not valid json', 'raw', 'm', 0)
    expect(repo.getCached('task-x', 'sha-x')).toBeNull()
    const row = db.prepare('SELECT * FROM task_reviews WHERE task_id = ?').get('task-x')
    expect(row).toBeUndefined()
  })
})
