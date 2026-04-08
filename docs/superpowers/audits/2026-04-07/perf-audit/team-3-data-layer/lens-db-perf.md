# Database Performance Engineer

**Lens scope:** SQLite query performance, indexing, query plans, WAL contention.
**Summary:** The audit identified 7 performance issues spanning missing indexes, full-table scans, SELECT * overuse, and loop-based inserts that amplify audit writes to 2648+ changes per task. The database design is sound (WAL mode, transactions, prepared statements) but query optimization and index coverage are weak points. Most issues are High or Medium severity with straightforward fixes.

## Findings

## F-t3-db-1: Missing index on pr_number + pr_status composite for listTasksWithOpenPrs
**Severity:** High
**Category:** I/O | Latency
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts:788-809`
**Evidence:**
```sql
SELECT id, title, ... FROM sprint_tasks WHERE pr_number IS NOT NULL AND pr_status = 'open'
EXPLAIN QUERY PLAN: SCAN sprint_tasks
```
Query scans entire table (525 rows) with no index guidance. Index exists on `pr_number` alone but filtering on `pr_number IS NOT NULL AND pr_status = 'open'` requires either a composite index or an indexed scan.
**Impact:** UI listbox of open PRs requires full-table scan on every load. With 157 distinct PR numbers and ~0 currently open (snapshot shows 0 rows), but in steady state this is a hotpath for PR tracking.
**Recommendation:** Create composite index `CREATE INDEX idx_sprint_tasks_pr_open ON sprint_tasks(pr_status, pr_number) WHERE pr_status = 'open'` (or non-filtered version if `INCLUDE` is used). This enables indexed range scans.
**Effort:** S
**Confidence:** High

## F-t3-db-2: Unprepared SELECT * in listTasksRecent triggers full-table scan and temp sort
**Severity:** High
**Category:** I/O | Latency
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts:216-234`
**Evidence:**
```sql
SELECT * FROM sprint_tasks WHERE status NOT IN ('done','cancelled','failed','error') 
  OR completed_at >= datetime('now', '-7 days')
ORDER BY priority ASC, created_at ASC
EXPLAIN QUERY PLAN: SCAN sprint_tasks + USE TEMP B-TREE FOR ORDER BY
```
The OR condition prevents index usage (neither `idx_sprint_tasks_status` nor any date index applies). Full scan + external sort.
**Impact:** Called on `sprint:list` IPC which runs frequently. With 525 tasks and ~350 non-terminal tasks, scans ~525 rows and sorts in memory every time.
**Recommendation:** 
1. Rewrite as UNION of two indexed queries:
```sql
(SELECT * FROM sprint_tasks WHERE status NOT IN ('done','cancelled','failed','error') ORDER BY priority, created_at)
UNION ALL
(SELECT * FROM sprint_tasks WHERE status IN ('done','cancelled','failed','error') 
  AND completed_at >= datetime('now', '-7 days') ORDER BY priority, created_at)
```
2. Add index on `created_at` if missing, ensure sort can use `idx_sprint_tasks_status` for first branch.
**Effort:** M
**Confidence:** High

## F-t3-db-3: Multiple full-table scans on (status, claimed_by) due to missing composite index
**Severity:** Medium
**Category:** I/O | Latency
**Location:** Multiple: `getOrphanedTasks` (877), `claimTask` (442-443)
**Evidence:**
```sql
SELECT ... FROM sprint_tasks WHERE status = 'active' AND claimed_by = ?
EXPLAIN QUERY PLAN: SEARCH using idx_sprint_tasks_claimed_by (claimed_by=?)
-- Falls back to claimed_by index; status filter requires post-index scan.
```
Queries filter on both `status` and `claimed_by` but only `idx_sprint_tasks_claimed_by` exists.
**Impact:** Orphaned task detection and WIP checking scan all rows claimed by an agent regardless of status, then filter. Low row counts now, but scales poorly as agent pool grows.
**Recommendation:** Create composite index `CREATE INDEX idx_sprint_tasks_status_claimed ON sprint_tasks(status, claimed_by)` to enable tight bounds.
**Effort:** S
**Confidence:** High

## F-t3-db-4: Loop-based insertions in markTaskDoneByPrNumber and markTaskCancelledByPrNumber amplify writes
**Severity:** High
**Category:** I/O | Latency
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts:620-702, 704-786`
**Evidence:**
```typescript
for (const oldTask of affected) {
  recordTaskChanges(oldTask.id as string, oldTask, { status: 'done', completed_at }, 'pr-poller', db)
}
// Inside recordTaskChanges (task-changes.ts:28-43):
const stmt = conn.prepare('INSERT INTO task_changes (...)')
for (const [field, newValue] of Object.entries(newPatch)) {
  stmt.run(taskId, field, oldStr, newStr, changedBy)
}
```
Each affected task is iterated, calling `recordTaskChanges`, which itself iterates field changes and issues individual INSERTs. With typical task record ~35 fields, a single `markTaskDoneByPrNumber` call can insert 50+ rows into `task_changes` for one PR.
Snapshot shows tasks with 2648+ changes recorded (7 tasks with >100 changes each).
**Impact:** WAL write amplification. A bulk status update for 5 tasks triggers 5 × 2 calls to `recordTaskChanges`, each inserting multiple audit rows. Under concurrent PR polling, this fragments the WAL and slows down readers.
**Recommendation:** Batch the audit trail inserts:
1. Collect all `(task_id, field, old_value, new_value, changed_by)` tuples into a single list.
2. Prepare a single INSERT statement: `INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?)` and bind once per tuple.
3. Example refactor: Pass a list of changes to `recordTaskChanges`, not individual patches.
**Effort:** M
**Confidence:** High

## F-t3-db-5: SELECT * in getQueuedTasks, listTasksWithOpenPrs, and getOrphanedTasks fetches 40+ columns unnecessarily
**Severity:** Medium
**Category:** I/O | Latency
**Location:** Multiple:
- getQueuedTasks (840-864)
- listTasksWithOpenPrs (788-809)
- getOrphanedTasks (866-887)
**Evidence:**
```sql
SELECT id, title, prompt, repo, status, ... (40 columns) FROM sprint_tasks WHERE status = 'queued' ...
```
Each query explicitly names 40 columns but in many cases (e.g., getQueuedTasks on agent polling) only needs `(id, title, repo, status, claimed_by)`. Large text fields like `spec`, `notes`, `prompt`, `partial_diff`, `review_diff_snapshot` are fetched from disk/WAL but never used by the caller.
**Impact:** Larger result sets mean more I/O and memory pressure. With `review_diff_snapshot` potentially large (~500KB per row as noted in code), fetching unnecessary blobs inflates cache pressure.
**Recommendation:** Profile each call site and fetch only required columns. Example:
```sql
-- Instead of SELECT * or all 40 columns
SELECT id, title, repo, status FROM sprint_tasks WHERE status = 'queued' ...
```
**Effort:** M
**Confidence:** Medium

## F-t3-db-6: cost_events table is never written; write path is dark
**Severity:** Medium
**Category:** I/O | Latency
**Location:** Schema defined in `/Users/ryan/projects/BDE/src/main/db.ts` (migrations). No INSERT or UPDATE on `cost_events` found in codebase.
**Evidence:**
```sql
CREATE TABLE cost_events (id TEXT PRIMARY KEY, source TEXT NOT NULL, session_key TEXT, 
  model TEXT NOT NULL, total_tokens INTEGER, cost_usd REAL, recorded_at TEXT NOT NULL)
SELECT COUNT(*) FROM cost_events;
-- Result: 0 (empty after 525 sprint_tasks and 500 agent_runs)
```
The table is defined but never populated. Cost data exists in `agent_runs` (`cost_usd`, `tokens_in`, `tokens_out`, etc.) instead.
**Impact:** Dead table consumes schema space and maintenance overhead. If cost tracking is intended to migrate to `cost_events` in the future, the write path is missing and will silently fail if enabled.
**Recommendation:** 
1. If `cost_events` is unused, drop the table and migration to reduce bloat.
2. If it is planned, implement the write path immediately with feature flags to avoid bifurcation.
3. Document the intent (cost tracking lives in `agent_runs` for now).
**Effort:** S
**Confidence:** High

## F-t3-db-7: No index on task_changes(task_id, changed_at) causes full scan for change history queries
**Severity:** Medium
**Category:** I/O | Latency
**Location:** `/Users/ryan/projects/BDE/src/main/data/task-changes.ts:64-70`
**Evidence:**
```sql
SELECT id, task_id, field, old_value, new_value, changed_by, changed_at 
FROM task_changes WHERE task_id = ? ORDER BY changed_at DESC LIMIT 50
```
Index `idx_task_changes_task_id` exists, but it is single-column. The ORDER BY requires a post-scan sort or separate traversal. Snapshot shows tasks with 2600+ change records; filtering one task requires scanning or sorting.
**Impact:** Export task history (`sprint:exportTaskHistory`) and change log UI require reading change history. With tasks accumulating 2600+ changes, even indexed lookup must sort 2600 rows externally.
**Recommendation:** Create composite index `CREATE INDEX idx_task_changes_task_date ON task_changes(task_id, changed_at DESC)` to provide both filter and sort order.
**Effort:** S
**Confidence:** High

## Open questions

1. **WAL contention under concurrent writes:** The audit does not measure contention but flag it as a risk. If multiple agents poll and update tasks concurrently, WAL write amplification (F-t3-db-4) could cause `SQLITE_BUSY` retries. Are agents truly concurrent, or is polling serialized?

2. **Transaction size:** `markTaskDoneByPrNumber` and similar functions wrap bulk updates in a transaction but fetch full task records for audit. If a PR affects 100 tasks, the transaction holds locks for 100+ INSERTs. Is this acceptable for the typical PR size?

3. **Cost data strategy:** Are there plans to move token/cost tracking from `agent_runs` to a separate cost analysis table? If so, `cost_events` should be enabled; if not, it should be dropped.

4. **Prepared statement reuse:** All prepared statements in sprint-queries.ts are created fresh per call (37 `.prepare()` calls visible). better-sqlite3 caches statements internally, but confirming whether statement caching is enabled in the driver config would confirm efficiency.

5. **Change history retention:** Pruning old changes (task-changes.ts:75) is defined but when is it called? With 2600+ changes per task, long-running tasks could accumulate unbounded history.
