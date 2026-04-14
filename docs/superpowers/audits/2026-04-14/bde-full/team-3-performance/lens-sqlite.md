# SQLite & Data Layer Audit — Team 3

**Executive Summary:** The BDE application demonstrates strong data layer fundamentals with proper use of transactions, audit trails, and defense-in-depth parameterization. However, five critical gaps emerged: (1) missing indices on `started_at` and `completed_at` columns cause full table scans in health-check and reporting queries executed every 60–300 seconds; (2) large unbounded result sets fetched without pagination expose memory risk as task volume grows; (3) user_version pragma uses string interpolation instead of bound parameters, violating defense-in-depth; (4) `updateTaskMergeableState` iterates per-task instead of bulk-recording audit changes; and (5) `getDailySuccessRate` uses recursive CTE with date formatting that may not benefit from any index. These findings represent actionable performance debt and injection risk mitigations.

---

## F-t3-sqlite-1: Missing indices on started_at and completed_at
**Severity:** High  
**Category:** Data Layer  
**Location:** `src/main/db.ts`, `src/main/data/sprint-agent-queries.ts:95–103`, `src/main/data/reporting-queries.ts:167–214`  
**Evidence:**  
- `getHealthCheckTasks()` executes: `SELECT ... FROM sprint_tasks WHERE status = 'active' AND started_at < ?` (line 101)
- `getDailySuccessRate()` executes: `WHERE completed_at IS NOT NULL AND date(completed_at) >= date('now', '-${days}')` (line 187)
- Grep confirms no index on `sprint_tasks(started_at)` or `sprint_tasks(completed_at)` exists in migrations
- Index map shows only: `idx_sprint_tasks_status`, `idx_sprint_tasks_claimed_by`, `idx_sprint_tasks_pr_number`, `idx_sprint_tasks_pr_open`, `idx_sprint_tasks_status_claimed`, `idx_sprint_tasks_group_id`

**Impact:**  
- `getHealthCheckTasks()` is called by health-check loop every 60–120 seconds (from audit context); without `started_at` index, query must scan entire `sprint_tasks` table to filter active tasks older than 1 hour
- `getDailySuccessRate()` runs on dashboard load and cache refresh; the recursive CTE with date filtering will full-scan `sprint_tasks` to group by completed_at
- As task volume grows beyond 10K rows, these queries become O(N) rather than O(log N), causing UI latency spikes and CPU waste

**Recommendation:**  
Create migration `v050-add-indices-on-started-at-completed-at.ts` with:
```sql
CREATE INDEX IF NOT EXISTS idx_sprint_tasks_started_at ON sprint_tasks(started_at ASC);
CREATE INDEX IF NOT EXISTS idx_sprint_tasks_completed_at ON sprint_tasks(completed_at ASC);
```
For `getHealthCheckTasks()`, consider a covering index: `idx_sprint_tasks_status_started_at ON sprint_tasks(status, started_at ASC)` to eliminate the table lookup entirely.

**Effort:** S  
**Confidence:** High

---

## F-t3-sqlite-2: Unbounded listTasks() result set
**Severity:** Medium  
**Category:** Data Layer  
**Location:** `src/main/data/sprint-task-crud.ts:32–55`  
**Evidence:**  
```typescript
export function listTasks(status?: string): SprintTask[] {
  try {
    const db = getDb()
    if (status) {
      const rows = db
        .prepare(`SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE status = ? ...`)
        .all(status) as Record<string, unknown>[]
      return mapRowsToTasks(rows)
    }
    const rows = db
      .prepare(`SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks ...`)
      .all() as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) { ... }
}
```
- No `LIMIT` clause; `.all()` fetches every matching row into memory
- `mapRowsToTasks` allocates array and maps each row (O(N) memory overhead)
- If called with `status = null`, entire table is hydrated and returned to caller

**Impact:**  
- Current dataset unknown, but if sprint_tasks grows to 50K–100K rows (reasonable for a year of work), `listTasks(null)` allocates >100MB of JS objects
- Caller (likely dashboard or queue manager) must iterate the entire array; if called in a loop or on every tick, memory churn causes GC pauses
- No visibility into which callers invoke this unbounded query — risk of accidental O(N²) if caller iterates further

**Recommendation:**  
1. Add optional `limit` parameter with sensible default (e.g., 500 recent tasks):
   ```typescript
   export function listTasks(status?: string, limit: number = 500): SprintTask[] {
     ...
     .all(status)
     LIMIT ?
   ```
2. Audit all callers of `listTasks()` to confirm they don't expect the full set; if they do, document why and make limit explicit at call site
3. Consider a separate `listTasksPaginated(status, page, pageSize)` function for UI consumption

**Effort:** M  
**Confidence:** High

---

## F-t3-sqlite-3: String interpolation in user_version pragma
**Severity:** High  
**Category:** Data Layer (Injection Risk)  
**Location:** `src/main/db.ts:108`  
**Evidence:**  
```typescript
for (const migration of pending) {
  try {
    const runSingle = db.transaction(() => {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)  // ← String interpolation
    })
    runSingle()
  } catch (err) { ... }
}
```
- `migration.version` is a number loaded from module exports (not user input), so immediate risk is low
- However, defense-in-depth principle violated: pragmas should use bound parameters where available
- If migration.ts file ever loaded from untrusted source (e.g., plugin system), this becomes injection vector

**Impact:**  
- Low immediate risk because `migration.version` is hardcoded in migration files, not user-supplied
- Violates defense-in-depth: if someone later refactors to load migration versions from config or IPC, this line becomes a SQL injection sink
- Sets bad precedent — pragma statements should be parameterized even if the payload isn't user-controlled

**Recommendation:**  
Use bound parameters:
```typescript
db.prepare('PRAGMA user_version = ?').run(migration.version)
```
This is slightly less readable than pragma shorthand but eliminates the interpolation entirely.

**Effort:** S  
**Confidence:** High

---

## F-t3-sqlite-4: Unbounded iteration in updateTaskMergeableState
**Severity:** Medium  
**Category:** Data Layer  
**Location:** `src/main/data/sprint-pr-ops.ts:199–231`  
**Evidence:**  
```typescript
export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  if (!mergeableState) return
  try {
    const db = getDb()
    db.transaction(() => {
      const sql = `SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE pr_number = ?`
      const affected = db.prepare(sql).all(prNumber) as Array<Record<string, unknown>>

      db.prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?').run(
        mergeableState,
        prNumber
      )

      for (const oldTask of affected) {  // ← Per-task iteration
        recordTaskChanges(
          oldTask.id as string,
          oldTask,
          { pr_mergeable_state: mergeableState },
          'pr-poller',
          db
        )
      }
    })()
  } catch (err) { ... }
}
```
- Fetches all affected tasks (potentially hundreds per PR update spike)
- Calls `recordTaskChanges()` once per task in a loop; each call prepares and executes an INSERT
- Contrast with `transitionTasksToDone()` and `transitionTasksToCancelled()` which use `recordTaskChangesBulk()` with statement reuse

**Impact:**  
- If 50 tasks are affected by a single PR merge, `recordTaskChanges()` is called 50 times, each with its own prepared statement allocation
- PR poller runs every 60 seconds; if repos have high PR churn, this becomes a micro-optimization target
- Memory and CPU waste compared to bulk audit trail recording

**Recommendation:**  
Refactor to use `recordTaskChangesBulk()` like the PR transition functions already do:
```typescript
const changes = affected.map((oldTask) => ({
  taskId: oldTask.id as string,
  oldTask,
  newPatch: { pr_mergeable_state: mergeableState }
}))
recordTaskChangesBulk(changes, 'pr-poller', db)
```
This reuses a single prepared INSERT statement across all tasks.

**Effort:** S  
**Confidence:** High

---

## F-t3-sqlite-5: Missing index on sprint_tasks(pr_number, status) for PR poller
**Severity:** Medium  
**Category:** Data Layer  
**Location:** `src/main/data/sprint-pr-ops.ts:15–54, 60–97`  
**Evidence:**  
- `transitionTasksToDone()` and `transitionTasksToCancelled()` both execute:
  ```sql
  SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE pr_number = ? AND status = ?
  ```
- Migration v039 adds `idx_sprint_tasks_pr_open` (partial index on `pr_status = 'open'`)
- Migration v015 adds `idx_sprint_tasks_pr_number` (single column)
- No composite index on `(pr_number, status)` exists

**Impact:**  
- Query uses `idx_sprint_tasks_pr_number` but must then filter by status, requiring a second lookup or full table scan of the pr_number matches
- PR poller runs every 60 seconds; with thousands of tasks, this micro-workload adds up
- With a covering index `(pr_number, status)`, both predicates are satisfied in a single B-tree traversal

**Recommendation:**  
Create migration `v051-add-index-on-pr-number-status.ts`:
```sql
CREATE INDEX IF NOT EXISTS idx_sprint_tasks_pr_number_status ON sprint_tasks(pr_number, status);
```

**Effort:** S  
**Confidence:** Medium

---

## F-t3-sqlite-6: getDailySuccessRate recursive CTE may not benefit from indices
**Severity:** Low  
**Category:** Data Layer  
**Location:** `src/main/data/reporting-queries.ts:167–214`  
**Evidence:**  
```typescript
const rows = db.prepare(`
  WITH RECURSIVE dates(date) AS (
    SELECT date('now', '-${days - 1} days')
    UNION ALL
    SELECT date(date, '+1 day')
    FROM dates
    WHERE date < date('now')
  ),
  daily_stats AS (
    SELECT
      date(completed_at) as date,
      COUNT(CASE WHEN status = 'done' THEN 1 END) as done,
      COUNT(CASE WHEN status IN ('failed', 'error') THEN 1 END) as failed
    FROM sprint_tasks
    WHERE completed_at IS NOT NULL
      AND date(completed_at) >= date('now', '-${days} days')
    GROUP BY date(completed_at)
  )
  SELECT ... FROM dates LEFT JOIN daily_stats
`).all()
```
- The `date(completed_at)` function call in WHERE clause prevents index use for the `>=` predicate
- Even with `idx_sprint_tasks_completed_at`, the function call forces full scan evaluation

**Impact:**  
- Dashboard loads or refreshes hit this query; with 50K tasks, scanning all of them to extract completed ones is expensive
- Function call overhead is per-row; SQLite cannot use index range on `date(completed_at)` because index stores raw timestamps
- Not an immediate crisis (reporting queries typically run infrequently), but optimization opportunity for large datasets

**Recommendation:**  
Rewrite to use timestamp comparison without function call:
```typescript
const cutoffIso = new Date(Date.now() - days * 86400000).toISOString()
// Then in SQL: WHERE completed_at >= ?
```
This allows the index on `completed_at` to be used for range filtering, and the date grouping happens on a smaller result set.

**Effort:** M  
**Confidence:** Medium

---

## Summary

| ID | Title | Severity | Effort |
|-------|-------|----------|--------|
| F-t3-sqlite-1 | Missing indices on started_at and completed_at | High | S |
| F-t3-sqlite-2 | Unbounded listTasks() result set | Medium | M |
| F-t3-sqlite-3 | String interpolation in user_version pragma | High | S |
| F-t3-sqlite-4 | Unbounded iteration in updateTaskMergeableState | Medium | S |
| F-t3-sqlite-5 | Missing index on sprint_tasks(pr_number, status) | Medium | S |
| F-t3-sqlite-6 | getDailySuccessRate recursive CTE function call overhead | Low | M |

**Quick Wins (Start Here):**
1. Add indices (F-t3-sqlite-1, F-t3-sqlite-5) — two small migrations, immediate query performance gain
2. Fix user_version pragma (F-t3-sqlite-3) — one line change, defense-in-depth improvement
3. Refactor updateTaskMergeableState (F-t3-sqlite-4) — reuse existing bulk audit pattern

**Longer-Term Improvements:**
1. Paginate listTasks() (F-t3-sqlite-2) — requires caller audit and optional breaking changes
2. Optimize getDailySuccessRate (F-t3-sqlite-6) — measurable improvement for large datasets, lower priority
