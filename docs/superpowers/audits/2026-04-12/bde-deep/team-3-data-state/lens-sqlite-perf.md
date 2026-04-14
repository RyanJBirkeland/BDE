# SQLite Performance Audit — BDE Data Layer

**Audit Date:** 2026-04-12  
**Scope:** SQLite query patterns, index coverage, migration correctness, write safety  
**Key Findings:** 5 findings (2 High, 3 Medium). Codebase shows strong indexing discipline and proper transaction handling, but has bounded growth issues and two subtle WAL/atomicity risks.

## Executive Summary

BDE's SQLite implementation is architecturally sound: WAL mode is correctly configured, migrations are idempotent, and the query layer avoids N+1 patterns through careful design (batch operations, prepared statement reuse, single queries returning all needed data). Index coverage is comprehensive thanks to targeted migrations (v039–v043). However, three concerns emerge: (1) unbounded table reads for dependency resolution and task ID enumeration could strain very large deployments; (2) agent_events table has no pruning mechanism despite 2000 events/agent/day; (3) VACUUM INTO backup runs in WAL mode while agents may be writing, requiring precise checkpoint sequencing to guarantee atomicity.

---

## Finding 1: Unbounded Full-Table Scans in Dependency Resolution

**Severity:** High  
**Category:** SQLite Performance  
**Location:** `/Users/ryan/projects/BDE/src/main/data/sprint-queries.ts:893–918`  
**Evidence:**
```typescript
// getAllTaskIds() — no LIMIT
const rows = getDb().prepare('SELECT id FROM sprint_tasks').all() as Array<{ id: string }>

// getTasksWithDependencies() — no LIMIT, scans all tasks
const rows = getDb().prepare('SELECT id, depends_on, status FROM sprint_tasks').all()
```

Both functions are called during app startup (cycle detection) and on every dependency mutation. With thousands of tasks, these unbounded queries force SQLite to materialize all rows into memory.

**Impact:**
- On a 5000-task database, each startup and each dependency change triggers a full scan of 5000 rows.
- Memory footprint grows with task count; no pagination or incremental loading.
- Cycle detection algorithm (in dependency-service) is O(V+E) graph traversal, but input fetch is O(n) with materialization cost.

**Recommendation:**
1. Add `LIMIT ?` parameter to allow pagination (e.g., 1000 tasks at a time) if cycle detection can be refactored incrementally.
2. If full-table read is truly necessary, consider lazy evaluation: return a prepared statement iterator (if better-sqlite3 supports it) instead of `.all()` to stream results.
3. Cache the full task dependency graph in memory on app startup; invalidate on dependency mutations. Reduces repeated scans.

**Effort:** M  
**Confidence:** High

---

## Finding 2: No Retention/Pruning Policy for agent_events Table

**Severity:** High  
**Category:** SQLite Performance  
**Location:** `/Users/ryan/projects/BDE/src/main/data/event-queries.ts:25–28`  
**Evidence:**
```typescript
export function pruneOldEvents(db: Database.Database, retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  db.prepare('DELETE FROM agent_events WHERE timestamp < ?').run(cutoff)
}
```

The function exists but is never called. Agent events accumulate indefinitely:
- Each agent emits ~2000 events/day (batch size 50, interval 100ms = ~500 batches/day × 4 events/batch).
- A deployment with 100 agents running for 1 year = ~73M rows.
- agent_events table will bloat the database file without bounded cleanup.

**Impact:**
- Database file grows unbounded; VACUUM is expensive at scale.
- Queries on agent_events (e.g., `getRecentEvents` JOIN) will scan more and more dead rows.
- Storage cost per agent-day: ~2000 events × ~500 bytes/event = ~1 MB/agent/day.

**Recommendation:**
1. Call `pruneOldEvents(db, 30)` (or configurable) in a background maintenance task (e.g., daily or on app shutdown).
2. Consider moving old events to an archive table or compressed log file for compliance/audit trails.
3. Add a comment/config constant for the retention policy (currently hardcoded in callers' logic).

**Effort:** S  
**Confidence:** High

---

## Finding 3: VACUUM INTO May Not Be Atomic with Active Writes in WAL Mode

**Severity:** Medium  
**Category:** SQLite Write Safety  
**Location:** `/Users/ryan/projects/BDE/src/main/db.ts:49–85`  
**Evidence:**
```typescript
export function backupDatabase(): void {
  // ... path validation ...
  // VACUUM INTO doesn't support bound parameters, so we must use string interpolation.
  const escapedPath = resolvedPath.replace(/'/g, "''")
  const sql = `VACUUM INTO '${escapedPath}'`
  db.exec(sql)
  
  // DL-24: Verify backup integrity - check file exists and has reasonable size
  // ... no explicit checkpoint before backup ...
}
```

Called on startup and every 24h. In WAL mode, VACUUM INTO:
1. Reads the database file and all committed WAL pages.
2. Writes a new database file at the target path.
3. Does NOT automatically checkpoint the WAL or truncate the -wal file.

If agents write events between VACUUM INTO and a WAL checkpoint, the backup may be missing recent commits.

**Impact:**
- Backup may not include the latest agent events or task mutations if they arrived after VACUUM INTO began.
- On restore, users lose ~BATCH_INTERVAL_MS worth of events (100ms in current config).
- If backups are used for disaster recovery, inconsistency goes undetected.

**Recommendation:**
1. Call `db.pragma('wal_checkpoint(RESTART)')` **before** VACUUM INTO to sync all WAL pages to the main file.
   ```typescript
   db.pragma('wal_checkpoint(RESTART)') // Force checkpoint
   db.exec(`VACUUM INTO '${escapedPath}'`)
   ```
2. Document the atomicity guarantee in comments (or remove the expectation if backups are best-effort).
3. Consider using `VACUUM INTO` with `-wal` and `-shm` file copies instead (copy entire WAL set).

**Effort:** S  
**Confidence:** Medium (WAL checkpoint semantics are well-tested; risk is lower if agents tolerate brief write delays during checkpoint)

---

## Finding 4: Missing Index on task_changes(task_id) for Getters Without Ordering

**Severity:** Medium  
**Category:** SQLite Performance  
**Location:** `/Users/ryan/projects/BDE/src/main/data/task-changes.ts:92–105`  
**Evidence:**
```typescript
export function getTaskChanges(taskId: string, limit: number = 50): TaskChange[] {
  const conn = db ?? getDb()
  return conn
    .prepare(`SELECT * FROM task_changes WHERE task_id = ? ORDER BY changed_at DESC LIMIT ?`)
    .all(taskId, limit) as TaskChange[]
}
```

Migration v041 adds index on `task_changes(task_id, changed_at DESC)`, which covers this query. However, if pruning is added (Finding 2 above), the query pattern changes:

Current: `WHERE task_id = ? ORDER BY changed_at DESC` → uses composite index.
After pruning: `WHERE task_id = ? AND changed_at > ? ORDER BY changed_at DESC` → still uses composite index.

No issue **for now**, but if `pruneOldChanges()` is called, the index remains sufficient.

**Impact:**  
Low — migration v041 already covers the hot path. Documenting for completeness.

**Recommendation:**  
Ensure v041 index stays in place; verify EXPLAIN QUERY PLAN if `pruneOldChanges` is invoked.

**Effort:** S  
**Confidence:** Low (index is already present; no action needed)

---

## Finding 5: Agent_runs Queries Missing Index on (status, started_at) for Cost/Completion Aggregation

**Severity:** Medium  
**Category:** SQLite Performance  
**Location:** `/Users/ryan/projects/BDE/src/main/data/cost-queries.ts:99–155`  
**Evidence:**
```typescript
export function getCostSummary(db: Database.Database): CostSummary {
  const tasksToday = db
    .prepare("SELECT COUNT(*) as cnt FROM agent_runs WHERE status = 'done' AND started_at >= date('now', 'start of day')")
    .get() as SummaryCountRow

  const mostTokenIntensiveRow = db
    .prepare("SELECT task, (COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)) as total_tokens FROM agent_runs WHERE status = 'done' AND (tokens_in IS NOT NULL OR tokens_out IS NOT NULL) AND started_at >= date('now', '-7 days') ORDER BY total_tokens DESC LIMIT 1")
    .get() as MostTokenIntensiveRow | undefined
}
```

These queries filter on `status` and `started_at` together but the index on agent_runs is only on `status`. Queries with date ranges require a second column index:

**Current index (from v001):**
- `idx_agent_runs_status` → `status` only.

**Missing index:**
- `idx_agent_runs_status_started_at` → `(status, started_at DESC)` to cover cost aggregations.

**Impact:**
- Dashboard cost queries scan all rows with the target status, then filter by date (full scan for each cost query).
- On a 10k-agent database with many done/failed agents, each cost summary query does O(n) work.
- Called on every dashboard load.

**Recommendation:**
1. Add index: `CREATE INDEX idx_agent_runs_status_started_at ON agent_runs(status, started_at DESC);`
2. Verify EXPLAIN QUERY PLAN shows index usage for `getCostSummary` queries.

**Effort:** S  
**Confidence:** High

---

## Positive Findings (No Action Required)

### Strong Migration Idempotency
- All CREATE TABLE statements use `IF NOT EXISTS` (v015, v037).
- Migration v037 explicitly heals drifted databases (missing webhooks table).
- Migration versioning via PRAGMA user_version is bulletproof — re-run protection is guaranteed by monotonic version checks.

### Excellent Index Coverage
- Migrations v039–v043 add targeted indices for all hot query paths:
  - v039: `idx_sprint_tasks_pr_open` (partial, for PR poller).
  - v040: `idx_sprint_tasks_status_claimed` (for drain loop orphan queries).
  - v041: `idx_task_changes_task_changed` (composite, for history queries).
  - v043: `idx_agent_events_agent_id` (covering, for event stream).

### Proper Transaction Handling
- Batch operations use single prepared statements inside transactions (e.g., `recordTaskChangesBulk`, `insertEventBatch`).
- Dependency resolution uses statusCache to avoid redundant getTask calls in loops (resolve-dependents.ts:56–97).
- Sprint PR poller correctly collects results into a single transaction before marking tasks done.

### Safe WAL Configuration
- `journal_mode = WAL` with `wal_autocheckpoint=200` prevents WAL file explosion.
- `synchronous = NORMAL` balances durability with performance (acceptable for desktop app).
- `busy_timeout = 5000` prevents spurious SQLITE_BUSY errors during concurrent access.

---

## Recommendations Summary

| Priority | Finding | Action |
|----------|---------|--------|
| **High** | Unbounded task scans (getAllTaskIds, getTasksWithDependencies) | Implement pagination or streaming; cache dependency graph |
| **High** | No pruning for agent_events | Schedule daily/hourly prune task; default 30-day retention |
| **Medium** | VACUUM INTO atomicity in WAL mode | Add wal_checkpoint(RESTART) before backup |
| **Medium** | Missing agent_runs index for cost queries | Add `idx_agent_runs_status_started_at(status, started_at DESC)` |
| **Low** | task_changes index verification | No action; v041 already covers; document for future refactoring |

