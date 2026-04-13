/**
 * Sprint task diff snapshot management and cleanup.
 * Extracted from sprint-queries.ts to improve modularity.
 */
import type Database from 'better-sqlite3'
import { getDb } from '../db'

/**
 * How many days to retain `review_diff_snapshot` blobs for tasks in terminal
 * states. Snapshots are only useful while a task is in `review` — once
 * merged/discarded their value drops sharply, but at ~500KB per row they can
 * cause significant database bloat over time. Tunable here.
 */
export const DIFF_SNAPSHOT_RETENTION_DAYS = 30

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
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
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
