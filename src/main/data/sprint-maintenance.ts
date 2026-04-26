import type Database from 'better-sqlite3'
import { getDb } from '../db'
import { MS_PER_DAY } from '../../shared/time'

/**
 * How many days to retain `review_diff_snapshot` blobs for tasks in terminal
 * states. Snapshots are only useful while a task is in `review` — once
 * merged/discarded their value drops sharply, but at ~500KB per row they can
 * cause significant database bloat over time. Tunable here.
 */
export const DIFF_SNAPSHOT_RETENTION_DAYS = 30

/**
 * Delete sprint_tasks rows created by agents running `npm test` in worktrees.
 * Vitest's task-runner integration inserts "Test task" records during test
 * execution; this cleanup removes them on startup before the UI loads.
 * Returns the number of rows deleted.
 */
export function cleanTestArtifacts(db?: Database.Database): number {
  const conn = db ?? getDb()
  const sql = "DELETE FROM sprint_tasks WHERE title LIKE 'Test task%'"
  const result = conn.prepare(sql).run()
  return result.changes
}

/**
 * Null out `review_diff_snapshot` for tasks in terminal states older than
 * `retentionDays` days. Returns the number of rows updated.
 *
 * Snapshots on tasks still in `review` (or any non-terminal state) are
 * preserved unconditionally — the cleanup only targets done / cancelled /
 * failed / error tasks where the worktree is long gone and the snapshot is
 * unlikely to be useful.
 */
export function pruneOldDiffSnapshots(
  retentionDays: number = DIFF_SNAPSHOT_RETENTION_DAYS,
  db?: Database.Database
): number {
  const conn = db ?? getDb()
  const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY).toISOString()
  const result = conn
    .prepare(
      `UPDATE sprint_tasks
       SET review_diff_snapshot = NULL
       WHERE review_diff_snapshot IS NOT NULL
         AND status IN ('done', 'cancelled', 'failed', 'error')
         AND updated_at < ?`
    )
    .run(cutoff)
  return result.changes
}
