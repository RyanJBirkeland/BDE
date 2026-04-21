import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { loadMigrations } from '../loader'
import {
  up,
  version,
  description
} from '../v038-normalize-sprint-tasks-repo-to-lowercase-for-case-'

const V037_SPRINT_TASK_COLUMNS = [
  'id',
  'title',
  'prompt',
  'repo',
  'status',
  'priority',
  'depends_on',
  'spec',
  'notes',
  'pr_url',
  'pr_number',
  'pr_status',
  'pr_mergeable_state',
  'agent_run_id',
  'retry_count',
  'fast_fail_count',
  'started_at',
  'completed_at',
  'claimed_by',
  'template_name',
  'playground_enabled',
  'needs_review',
  'max_runtime_ms',
  'spec_type',
  'worktree_path',
  'session_id',
  'next_eligible_at',
  'model',
  'retry_context',
  'failure_reason',
  'max_cost_usd',
  'partial_diff',
  'assigned_reviewer',
  'tags',
  'group_id',
  'sprint_id',
  'duration_ms',
  'sort_order',
  'cross_repo_contract',
  'rebase_base_sha',
  'rebased_at',
  'review_diff_snapshot',
  'revision_feedback',
  'created_at',
  'updated_at'
] as const

type SprintTaskColumn = (typeof V037_SPRINT_TASK_COLUMNS)[number]

type SqliteValue = string | number | null

type SprintTaskRow = Record<SprintTaskColumn, SqliteValue>

const PRESERVED_COLUMNS: SprintTaskColumn[] = V037_SPRINT_TASK_COLUMNS.filter(
  (col) => col !== 'repo' && col !== 'updated_at'
)

function applyMigrationsUpTo(db: Database.Database, targetVersion: number): void {
  const migrations = loadMigrations().filter((m) => m.version <= targetVersion)
  for (const migration of migrations) {
    migration.up(db)
  }
}

function listTableColumns(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
}

function insertSprintTaskRow(db: Database.Database, row: SprintTaskRow): void {
  const columns = V037_SPRINT_TASK_COLUMNS.join(', ')
  const placeholders = V037_SPRINT_TASK_COLUMNS.map((c) => `@${c}`).join(', ')
  db.prepare(`INSERT INTO sprint_tasks (${columns}) VALUES (${placeholders})`).run(row)
}

function selectSprintTaskById(db: Database.Database, id: string): SprintTaskRow {
  return db.prepare('SELECT * FROM sprint_tasks WHERE id = ?').get(id) as SprintTaskRow
}

function buildFullySeededRow(
  overrides: Partial<SprintTaskRow> & Pick<SprintTaskRow, 'id' | 'repo'>
): SprintTaskRow {
  return {
    id: overrides.id,
    title: 'Seeded task title',
    prompt: 'Do the seeded thing.',
    repo: overrides.repo,
    status: 'active',
    priority: 2,
    depends_on: JSON.stringify([
      { id: 'upstream-hard', type: 'hard' },
      { id: 'upstream-soft', type: 'soft' }
    ]),
    spec: '## Summary\nSeeded spec\n\n## Files to Change\n- src/foo.ts',
    notes: 'Operator notes: case-sensitive data we must preserve.',
    pr_url: 'https://github.com/example/example/pull/42',
    pr_number: 42,
    pr_status: 'open',
    pr_mergeable_state: 'clean',
    agent_run_id: 'run-seed-001',
    retry_count: 2,
    fast_fail_count: 1,
    started_at: '2026-02-03T09:00:00.000Z',
    completed_at: null,
    claimed_by: 'pipeline-agent-7',
    template_name: 'feature',
    playground_enabled: 1,
    needs_review: 1,
    max_runtime_ms: 3_600_000,
    spec_type: 'feature',
    worktree_path: '/tmp/worktrees/bde/task-seed',
    session_id: 'sess-abc-123',
    next_eligible_at: '2026-02-03T10:00:00.000Z',
    model: 'claude-sonnet-4-5',
    retry_context: 'Previous attempt timed out during vitest run',
    failure_reason: 'watchdog_timeout',
    max_cost_usd: 2.5,
    partial_diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@\n-old\n+new\n',
    assigned_reviewer: 'user@example.com',
    tags: JSON.stringify(['backend', 'migration', 'P1']),
    group_id: null,
    sprint_id: null,
    duration_ms: 123_456,
    sort_order: 5,
    cross_repo_contract: '{"api":"v1","shape":"OrderDTO"}',
    rebase_base_sha: 'deadbeefcafebabe1234567890abcdef01234567',
    rebased_at: '2026-02-03T11:30:00.000Z',
    review_diff_snapshot: '{"files":[{"path":"src/foo.ts","additions":3,"deletions":1}]}',
    revision_feedback: '{"requested_changes":["tighten error handling"],"round":1}',
    created_at: '2026-02-03T08:00:00.000Z',
    updated_at: '2026-02-03T09:15:00.000Z',
    ...overrides
  }
}

function pickPreserved(row: SprintTaskRow): Record<string, SqliteValue> {
  const subset: Record<string, SqliteValue> = {}
  for (const column of PRESERVED_COLUMNS) {
    subset[column] = row[column]
  }
  return subset
}

describe('migration v038', () => {
  it('has version 38 and a non-placeholder description', () => {
    expect(version).toBe(38)
    expect(description).not.toMatch(/^Add\s*$/)
    expect(description.length).toBeGreaterThan(10)
  })

  it('chains v001..v037 to produce the real v037 sprint_tasks schema', () => {
    const db = new Database(':memory:')
    applyMigrationsUpTo(db, 37)

    const columns = listTableColumns(db, 'sprint_tasks')
    for (const expected of V037_SPRINT_TASK_COLUMNS) {
      expect(columns).toContain(expected)
    }
    db.close()
  })

  it('lowercases repo on rows with uppercase or mixed case and preserves every other column', () => {
    const db = new Database(':memory:')
    applyMigrationsUpTo(db, 37)

    const uppercaseRow = buildFullySeededRow({ id: 'task-uppercase', repo: 'BDE' })
    const titleCaseRow = buildFullySeededRow({
      id: 'task-titlecase',
      repo: 'Bde',
      status: 'queued',
      claimed_by: null,
      started_at: null,
      agent_run_id: null,
      pr_url: null,
      pr_number: null,
      pr_status: null,
      pr_mergeable_state: null
    })
    const mixedCaseRow = buildFullySeededRow({
      id: 'task-mixed',
      repo: 'bDE',
      status: 'review',
      completed_at: null,
      pr_status: 'draft'
    })
    const lowercaseRow = buildFullySeededRow({
      id: 'task-lowercase',
      repo: 'bde',
      status: 'done',
      completed_at: '2026-02-04T12:00:00.000Z',
      pr_status: 'merged'
    })

    const seeds = [uppercaseRow, titleCaseRow, mixedCaseRow, lowercaseRow]
    for (const seed of seeds) insertSprintTaskRow(db, seed)

    up(db)

    expect(selectSprintTaskById(db, 'task-uppercase').repo).toBe('bde')
    expect(selectSprintTaskById(db, 'task-titlecase').repo).toBe('bde')
    expect(selectSprintTaskById(db, 'task-mixed').repo).toBe('bde')
    expect(selectSprintTaskById(db, 'task-lowercase').repo).toBe('bde')

    for (const seed of seeds) {
      const row = selectSprintTaskById(db, seed.id as string)
      expect(pickPreserved(row)).toEqual(pickPreserved(seed))
    }

    db.close()
  })

  it('leaves updated_at untouched for rows whose repo was already lowercase', () => {
    const db = new Database(':memory:')
    applyMigrationsUpTo(db, 37)

    const lowercaseRow = buildFullySeededRow({
      id: 'task-already-lower',
      repo: 'other-repo',
      updated_at: '2026-02-03T09:15:00.000Z'
    })
    insertSprintTaskRow(db, lowercaseRow)

    up(db)

    const row = selectSprintTaskById(db, 'task-already-lower')
    expect(row.updated_at).toBe('2026-02-03T09:15:00.000Z')
    expect(row.repo).toBe('other-repo')
  })

  it('refreshes updated_at via the sprint_tasks_updated_at trigger for normalized rows', () => {
    const db = new Database(':memory:')
    applyMigrationsUpTo(db, 37)

    const seededUpdatedAt = '2026-02-03T09:15:00.000Z'
    const uppercaseRow = buildFullySeededRow({
      id: 'task-will-update',
      repo: 'BDE',
      updated_at: seededUpdatedAt
    })
    insertSprintTaskRow(db, uppercaseRow)

    up(db)

    const row = selectSprintTaskById(db, 'task-will-update')
    expect(row.repo).toBe('bde')
    expect(row.updated_at).not.toBe(seededUpdatedAt)
    expect(typeof row.updated_at).toBe('string')
    db.close()
  })

  it('is a no-op when every repo is already lowercase', () => {
    const db = new Database(':memory:')
    applyMigrationsUpTo(db, 37)

    const rowA = buildFullySeededRow({ id: 'a', repo: 'bde' })
    const rowB = buildFullySeededRow({ id: 'b', repo: 'other-repo' })
    insertSprintTaskRow(db, rowA)
    insertSprintTaskRow(db, rowB)

    const info = db
      .prepare('UPDATE sprint_tasks SET repo = lower(repo) WHERE repo <> lower(repo)')
      .run()
    expect(info.changes).toBe(0)

    expect(() => up(db)).not.toThrow()
    expect(selectSprintTaskById(db, 'a').repo).toBe('bde')
    expect(selectSprintTaskById(db, 'b').repo).toBe('other-repo')
    db.close()
  })

  it('is idempotent (applying twice produces the same repo values)', () => {
    const db = new Database(':memory:')
    applyMigrationsUpTo(db, 37)

    insertSprintTaskRow(db, buildFullySeededRow({ id: 'task-twice', repo: 'MixedCase' }))

    up(db)
    up(db)

    expect(selectSprintTaskById(db, 'task-twice').repo).toBe('mixedcase')
    db.close()
  })
})
