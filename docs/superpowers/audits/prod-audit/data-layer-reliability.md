# Data Layer -- Reliability Engineer Audit

**Date:** 2026-03-29
**Scope:** 19 files (10 source, 9 test)
**Persona:** Reliability Engineer

---

## Cross-Reference with Synthesis Final Report (2026-03-28)

### Previously Reported -- Now Fixed

| Synthesis ID | Issue                                          | Status                                                                                                         |
| ------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SEC-6        | SQL string interpolation in `backupDatabase()` | **Fixed.** `db.ts:32` now validates `backupPath` with regex before interpolation. Defense-in-depth is present. |

### Previously Reported -- Still Open

| Synthesis ID | Issue                                                                                                  | Status                                                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-2       | Repository pattern inconsistently applied -- IPC handlers and Queue API bypass `ISprintTaskRepository` | **Still open.** `sprint-queries.ts` functions are imported directly by IPC handlers and Queue API. The `ISprintTaskRepository` in `sprint-task-repository.ts` is only used by agent-manager. This means audit trail behavior (e.g., `recordTaskChanges` is only called via `updateTask()`) depends on which codepath is used. |

---

## Findings

### Critical

None found.

### High

#### DL-REL-1: Migration v9 disables foreign_keys without guaranteed re-enable on failure

**File:** `src/main/db.ts:205-259` (migration v9)
**Evidence:**

```sql
PRAGMA foreign_keys = OFF;
-- ... DDL statements ...
PRAGMA foreign_keys = ON;
```

**Problem:** If any statement between `PRAGMA foreign_keys = OFF` and `PRAGMA foreign_keys = ON` fails, the PRAGMA remains OFF for the rest of the session. Migration v10 (lines 267-310) has the same pattern. While `runMigrations()` wraps all migrations in a single transaction (line 440-446), a PRAGMA is not transactional in SQLite -- it takes effect immediately and is not rolled back. If the migration transaction fails after `foreign_keys = OFF`, the database connection continues without FK enforcement.
**Impact:** Silent data integrity violations -- orphaned rows or dangling references go undetected for the remainder of the process lifetime.
**Fix:** After the transaction in `runMigrations()`, unconditionally reassert `db.pragma('foreign_keys = ON')`. Or restructure so the PRAGMA is restored in a `finally` block within the migration's `up()` function.

#### DL-REL-2: updateTask does not wrap read + audit + write in a single transaction

**File:** `src/main/data/sprint-queries.ts:180-233`
**Evidence:**

```typescript
const oldTask = getTask(id)     // READ (separate statement)
// ... build SET clause ...
const result = db.prepare(...).get(...values)  // WRITE (separate statement)
recordTaskChanges(id, oldTask, auditPatch)     // AUDIT WRITE (separate statement)
```

**Problem:** Three separate database operations are not wrapped in a transaction. Between `getTask(id)` and the UPDATE, another process (e.g., Queue API running concurrently) could modify the same task. The audit trail would then record incorrect "old" values. Similarly, if the audit write fails, the task is updated but the change is unrecorded (though this is mitigated by the try/catch on line 218).
**Impact:** Audit trail can record stale old values under concurrent writes, silently producing an incorrect change history.
**Fix:** Wrap the entire read-update-audit sequence in `db.transaction(() => { ... })()`.

#### DL-REL-3: markTaskDoneByPrNumber and markTaskCancelledByPrNumber bypass audit trail

**File:** `src/main/data/sprint-queries.ts:351-415`
**Evidence:** Both functions use direct SQL `UPDATE` statements within transactions but never call `recordTaskChanges()`. Status transitions from `active` to `done`/`cancelled` and `pr_status` changes from `open` to `merged`/`closed` are not recorded in the `task_changes` table.
**Impact:** Silent gap in audit trail. PR-driven status transitions (the most important lifecycle events) have no change history.
**Fix:** Within each transaction, call `recordTaskChanges()` for each affected task ID, recording the status and pr_status changes.

#### DL-REL-4: Supabase import has TOCTOU race on "table is empty" check

**File:** `src/main/data/supabase-import.ts:54-61`
**Evidence:**

```typescript
const countRow = db.prepare('SELECT COUNT(*) as cnt FROM sprint_tasks').get()
if (countRow.cnt > 0) {
  return
}
// ... network fetch takes seconds ...
// ... insertAll(rows) runs later ...
```

**Problem:** The check for `cnt > 0` and the subsequent insert are not atomic. If the app creates tasks (via IPC or Queue API) between the count check and the `importAll()` call, the import could insert duplicate data alongside newly created tasks. While `INSERT OR IGNORE` prevents primary key collisions, there is no deduplication on title/content -- a task could be manually created and then the Supabase version also imported.
**Impact:** Potential duplicate tasks on first launch if the user creates tasks while import is in-flight. Low probability but non-zero.
**Fix:** Move the count check inside the transaction that performs the insert: `importAll` should re-check `cnt` at the start of the transaction.

### Significant

#### DL-REL-5: backupDatabase silently swallows VACUUM INTO failures

**File:** `src/main/db.ts:36-40`
**Evidence:**

```typescript
try {
  db.exec(`VACUUM INTO '${backupPath}'`)
} catch (err) {
  console.error('[db] Backup failed:', err)
}
```

**Problem:** If the disk is full, the backup path is inaccessible, or a WAL checkpoint fails during VACUUM, the error is logged to console but no caller is notified. The backup runs on startup and every 24 hours. If it fails persistently, the user has no backup and no indication of this.
**Impact:** User believes they have a backup when they may not. If the primary DB corrupts, no recovery is possible.
**Fix:** Return a boolean or throw. Callers (startup, 24h timer) should surface persistent backup failures to the UI or logger.

#### DL-REL-6: No WAL checkpoint is ever explicitly triggered

**File:** `src/main/db.ts:11`
**Evidence:** The database is opened with `journal_mode = WAL` and `synchronous = NORMAL`, but no explicit `PRAGMA wal_checkpoint(TRUNCATE)` is ever called. SQLite auto-checkpoints at ~1000 pages, but with `synchronous = NORMAL`, a crash during auto-checkpoint can lose the last transaction.
**Problem:** With WAL mode + `synchronous = NORMAL`, writes are durable in the WAL but a crash during checkpoint can corrupt the main database file. The combination is documented by SQLite as trading durability for speed. There is no periodic explicit checkpoint or checkpoint on graceful shutdown.
**Impact:** Possible data loss of the most recent transaction(s) on unexpected app crash or power failure. The `-wal` file can also grow unbounded if checkpoints are blocked.
**Fix:** Call `db.pragma('wal_checkpoint(TRUNCATE)')` in `closeDb()` (graceful shutdown). Consider switching to `synchronous = FULL` if crash safety is more important than write speed.

#### DL-REL-7: closeDb() does not checkpoint WAL before closing

**File:** `src/main/db.ts:22-25`
**Evidence:**

```typescript
export function closeDb(): void {
  _db?.close()
  _db = null
}
```

**Problem:** `better-sqlite3`'s `.close()` will attempt a passive checkpoint, but if there are concurrent readers (e.g., from Queue API serving requests), the passive checkpoint may not fully complete, leaving the WAL file with uncommitted pages. On next startup, SQLite will replay the WAL, but if the WAL file is corrupted (e.g., partial write during crash), this can fail.
**Fix:** Before `_db.close()`, call `_db.pragma('wal_checkpoint(TRUNCATE)')` to ensure all WAL content is written to the main database.

#### DL-REL-8: claimTask without maxActive does not record audit trail

**File:** `src/main/data/sprint-queries.ts:269-278`
**Evidence:** The non-WIP-limited code path directly issues `UPDATE ... SET status = 'active'` via `db.prepare(...).get(...)` without calling `recordTaskChanges()`. The status transition from `queued` to `active` is not audited.
**Impact:** Agent claim events are invisible in the audit trail when WIP limit is not specified.
**Fix:** Call `recordTaskChanges()` after the claim succeeds, recording the status change.

#### DL-REL-9: releaseTask does not record audit trail

**File:** `src/main/data/sprint-queries.ts:286-302`
**Evidence:** `releaseTask` transitions a task from `active` back to `queued` and clears `claimed_by`, `started_at`, and `agent_run_id`. None of these changes are recorded via `recordTaskChanges()`.
**Impact:** Task releases are invisible in the audit history.
**Fix:** Add `recordTaskChanges()` call with the fields being cleared.

#### DL-REL-10: deleteTask does not record audit trail or cascade to task_changes

**File:** `src/main/data/sprint-queries.ts:235-241`
**Evidence:** `deleteTask` issues a bare `DELETE FROM sprint_tasks WHERE id = ?`. The `task_changes` table has no foreign key to `sprint_tasks` and no `ON DELETE CASCADE`. After deletion, orphaned audit records remain in `task_changes` with no parent task.
**Impact:** Orphaned audit records accumulate over time. They are harmless but waste space and may confuse queries. Additionally, the deletion itself is not audited -- there is no record that a task was deleted.
**Fix:** Either add a "deleted" audit entry before deletion, or add a cascade delete for `task_changes` rows matching the task_id.

#### DL-REL-11: Supabase import does not validate status values against CHECK constraint

**File:** `src/main/data/supabase-import.ts:128`
**Evidence:**

```typescript
status: row.status ?? 'backlog',
```

**Problem:** The Supabase row's `status` field is inserted directly. If Supabase contained a status value not in the local CHECK constraint (e.g., a status that existed in an older schema version), the `INSERT OR IGNORE` will silently skip that row. The `imported` counter still increments (line 157), so the log message reports a misleading count.
**Impact:** Silent data loss during import -- tasks with unexpected status values are silently dropped with an incorrect success count.
**Fix:** Validate status against the known set before insert. Log skipped rows explicitly. Only increment `imported` if `insert.run()` actually inserted (check `changes` on the RunResult).

### Moderate

#### DL-REL-12: recordTaskChanges is not transactional for multi-field patches

**File:** `src/main/data/task-changes.ts:18-41`
**Evidence:**

```typescript
for (const [field, newValue] of Object.entries(newPatch)) {
  // ...
  if (oldStr !== newStr) {
    stmt.run(taskId, field, oldStr, newStr, changedBy)
  }
}
```

**Problem:** Each `stmt.run()` call is a separate implicit transaction. If the process crashes mid-loop, some field changes are recorded and others are not, producing a partial audit record.
**Impact:** Incomplete audit records for multi-field updates after a crash. Low probability but violates atomicity expectations.
**Fix:** Wrap the loop in `db.transaction(() => { ... })()`.

#### DL-REL-13: updateTask column names are built from allowlist strings, not validated against schema

**File:** `src/main/data/sprint-queries.ts:195-200`
**Evidence:**

```typescript
for (const [key, value] of entries) {
  setClauses.push(`${key} = ?`)
```

**Problem:** While the `UPDATE_ALLOWLIST` set restricts which keys are accepted, the column names are interpolated into the SQL string. If `UPDATE_ALLOWLIST` were ever modified to include a string containing SQL metacharacters, it would result in SQL injection. The synthesis report (main-process-sd S7) already flagged this as needing a regex assertion.
**Impact:** Defense-in-depth gap. Currently safe because allowlist values are hardcoded string literals, but fragile.
**Fix:** Add a compile-time or startup assertion that every allowlist entry matches `/^[a-z_]+$/`.

#### DL-REL-14: agent-queries updateAgentMeta has same column interpolation pattern

**File:** `src/main/data/agent-queries.ts:128-133`
**Evidence:**

```typescript
const col = AGENT_COLUMN_MAP[key]
if (col) {
  setClauses.push(`${col} = ?`)
```

**Problem:** Same pattern as DL-REL-13 -- column names from `AGENT_COLUMN_MAP` values are interpolated into SQL. Currently safe because the map values are hardcoded, but no validation exists.
**Fix:** Same as DL-REL-13 -- add a startup assertion that all map values match `/^[a-z_]+$/`.

#### DL-REL-15: getDb() singleton under concurrent Queue API load

**File:** `src/main/db.ts:7-20`
**Evidence:**

```typescript
let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    // ... create and migrate ...
  }
  return _db
}
```

**Problem:** `getDb()` is a singleton that returns the same `better-sqlite3` connection. `better-sqlite3` is synchronous and uses Node.js's single-threaded event loop, so concurrent operations are serialized. However, the Queue API runs in the same process and can call `getDb()` while the main process is also using it. SQLite with WAL mode supports concurrent reads but only one writer at a time. The `busy_timeout = 5000` pragma handles this, but if a long-running transaction (e.g., batch import) holds the write lock for >5 seconds, other writes will fail with `SQLITE_BUSY`.
**Impact:** Under heavy concurrent write load (unlikely in practice for a desktop app), Queue API writes could fail with SQLITE_BUSY errors. The 5-second timeout is likely sufficient for normal use.
**Fix:** This is low risk for the desktop use case. Document the constraint. For safety, ensure no transaction holds the lock for more than a few seconds.

#### DL-REL-16: event-queries pruneEventsByAgentIds vulnerable to large IN clause

**File:** `src/main/data/event-queries.ts:121-126`
**Evidence:**

```typescript
const placeholders = agentIds.map(() => '?').join(', ')
db.prepare(`DELETE FROM agent_events WHERE agent_id IN (${placeholders})`).run(...agentIds)
```

**Problem:** SQLite has a default limit of 999 bound parameters (`SQLITE_MAX_VARIABLE_NUMBER`). If `agentIds` has more than 999 entries, this query will fail. The same pattern exists in `queryEvents` (line 90) for `agentIds`.
**Impact:** Runtime error when pruning events for large numbers of agents. Would occur during cleanup of old agent data.
**Fix:** Batch the deletions in groups of 500 or use a temp table for the IDs.

#### DL-REL-17: Supabase import counter always increments regardless of INSERT OR IGNORE result

**File:** `src/main/data/supabase-import.ts:156-157`
**Evidence:**

```typescript
insert.run({ ... })
imported++
```

**Problem:** `INSERT OR IGNORE` silently skips rows that violate constraints (e.g., CHECK constraint on status, or duplicate primary key). The counter increments unconditionally, so the logged "Imported N sprint tasks" message may overcount.
**Fix:** Check `insert.run(...).changes` -- it returns 0 when the row was ignored. Only increment when `changes > 0`.

#### DL-REL-18: No compound index on task_changes for common query pattern

**File:** `src/main/db.ts:367-368`
**Evidence:** Two separate indexes exist: `idx_task_changes_task_id` on `task_id` and `idx_task_changes_changed_at` on `changed_at`. But `getTaskChanges()` queries `WHERE task_id = ? ORDER BY changed_at DESC LIMIT ?`, which would benefit from a compound index `(task_id, changed_at DESC)`.
**Impact:** Performance degradation as audit records grow. Minor for current scale.
**Fix:** Replace the two indexes with one compound index: `CREATE INDEX idx_task_changes_task_at ON task_changes(task_id, changed_at DESC)`.

### Low

#### DL-REL-19: getSettingJson swallows parse errors silently

**File:** `src/main/data/settings-queries.ts:30-33`
**Evidence:**

```typescript
try {
  return JSON.parse(raw) as T
} catch {
  return null
}
```

**Problem:** If a setting value is corrupted or has been manually edited to invalid JSON, `getSettingJson` returns `null` silently. Callers cannot distinguish "setting not found" from "setting exists but is corrupt."
**Impact:** Misconfigured settings silently fall back to defaults, making debugging difficult.
**Fix:** Log a warning when JSON parse fails, including the key name.

#### DL-REL-20: sanitizeDependsOn uses recursive call with potential for deep nesting

**File:** `src/shared/sanitize-depends-on.ts:16`
**Evidence:**

```typescript
const parsed = JSON.parse(value)
return sanitizeDependsOn(parsed) // Recursive call
```

**Problem:** If a string value parses to another string (e.g., double-encoded JSON), this recurses. While JSON.parse of a non-JSON-string will throw (caught), a pathological input of nested JSON-encoded strings could recurse until stack overflow.
**Impact:** Extremely unlikely in practice. Would require intentionally crafted nested JSON-string encoding.
**Fix:** Add a depth parameter or limit recursion to 1 level (which covers the known Supabase JSONB-as-string case).

#### DL-REL-21: cost_events table is created but never used

**File:** `src/main/db.ts:118-130` (migration v4)
**Evidence:** The `cost_events` table is created in migration v4. No query function reads from or writes to `cost_events`. All cost data flows through the `agent_runs` table (via `cost_usd`, `tokens_in`, `tokens_out` columns added in migration v3).
**Impact:** Dead table consuming schema space. No data reliability risk, but adds confusion about the data model.
**Fix:** Document as deprecated or drop in a future migration.

---

## Test Coverage Assessment

| Source File                               | Test File                  | Coverage Assessment                                                                                                                                                                                                                                                           |
| ----------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/db.ts`                          | `db.test.ts`               | Good: migrations, idempotency, backup creation. **Gap:** No test for migration failure/rollback, no test for `VACUUM INTO` failure path, no test for `closeDb()` behavior.                                                                                                    |
| `src/main/data/sprint-queries.ts`         | `sprint-queries.test.ts`   | Strong: 16 describe blocks covering CRUD, claim/release, WIP limit, boolean coercion, depends_on serialization. **Gap:** No test for concurrent access, no test for `getAllTaskIds()`, no test verifying audit trail is skipped on `claimTask`/`releaseTask`/`markTaskDone*`. |
| `src/main/data/agent-queries.ts`          | `agent-queries.test.ts`    | Good: covers all exported functions. **Gap:** No test for `getAgentLogInfo()`, no error-path tests.                                                                                                                                                                           |
| `src/main/data/cost-queries.ts`           | `cost-queries.test.ts`     | Adequate: covers summary and recent runs. **Gap:** No test for `getAgentHistory()`, no edge case tests for null cost fields.                                                                                                                                                  |
| `src/main/data/event-queries.ts`          | `event-queries.test.ts`    | Strong: covers all functions including batch, pagination, pruning. **Gap:** No test for large IN clause (DL-REL-16).                                                                                                                                                          |
| `src/main/data/settings-queries.ts`       | `settings-queries.test.ts` | Good: covers CRUD and JSON round-trip. Tests invalid JSON returns null.                                                                                                                                                                                                       |
| `src/main/data/task-changes.ts`           | `task-changes.test.ts`     | Good: covers record, query, prune. **Gap:** No test for partial crash during multi-field record (DL-REL-12).                                                                                                                                                                  |
| `src/main/data/supabase-import.ts`        | (none)                     | **No dedicated test file.** Import is async, network-dependent, and has several edge cases (DL-REL-4, DL-REL-11, DL-REL-17).                                                                                                                                                  |
| `src/main/data/sprint-task-repository.ts` | (none)                     | Thin delegation layer, tested indirectly via agent-manager integration tests. Acceptable.                                                                                                                                                                                     |
| `src/main/auth-guard.ts`                  | `auth-handlers.test.ts`    | Tested via handler mock. **Gap:** No direct unit test for `checkAuthStatus()` with various credential scenarios (missing token, expired token, NaN expiresAt).                                                                                                                |

---

## Summary Table

| ID        | Severity    | Category       | File                      | Summary                                                |
| --------- | ----------- | -------------- | ------------------------- | ------------------------------------------------------ |
| DL-REL-1  | High        | Migration      | db.ts:205                 | `foreign_keys = OFF` not restored on migration failure |
| DL-REL-2  | High        | Transaction    | sprint-queries.ts:180     | updateTask read+write+audit not in transaction         |
| DL-REL-3  | High        | Audit Trail    | sprint-queries.ts:351     | markTaskDone/Cancelled bypass audit trail              |
| DL-REL-4  | High        | Race Condition | supabase-import.ts:54     | TOCTOU on "table is empty" check                       |
| DL-REL-5  | Significant | Backup         | db.ts:36                  | VACUUM INTO failures silently swallowed                |
| DL-REL-6  | Significant | Durability     | db.ts:11                  | No explicit WAL checkpoint ever triggered              |
| DL-REL-7  | Significant | Shutdown       | db.ts:22                  | closeDb() does not checkpoint WAL                      |
| DL-REL-8  | Significant | Audit Trail    | sprint-queries.ts:269     | claimTask (no WIP) skips audit trail                   |
| DL-REL-9  | Significant | Audit Trail    | sprint-queries.ts:286     | releaseTask skips audit trail                          |
| DL-REL-10 | Significant | Audit Trail    | sprint-queries.ts:235     | deleteTask leaves orphaned audit records               |
| DL-REL-11 | Significant | Data Import    | supabase-import.ts:128    | Invalid status values silently dropped                 |
| DL-REL-12 | Moderate    | Atomicity      | task-changes.ts:30        | recordTaskChanges not transactional                    |
| DL-REL-13 | Moderate    | SQL Safety     | sprint-queries.ts:200     | Column names interpolated without schema validation    |
| DL-REL-14 | Moderate    | SQL Safety     | agent-queries.ts:131      | Same column interpolation pattern                      |
| DL-REL-15 | Moderate    | Concurrency    | db.ts:7                   | Singleton DB under concurrent Queue API load           |
| DL-REL-16 | Moderate    | SQL Limits     | event-queries.ts:124      | Large IN clause can exceed SQLite parameter limit      |
| DL-REL-17 | Moderate    | Data Import    | supabase-import.ts:156    | Import counter overcounts on IGNORE                    |
| DL-REL-18 | Moderate    | Performance    | db.ts:367                 | Missing compound index on task_changes                 |
| DL-REL-19 | Low         | Error Handling | settings-queries.ts:30    | JSON parse errors swallowed silently                   |
| DL-REL-20 | Low         | Robustness     | sanitize-depends-on.ts:16 | Recursive parse with no depth limit                    |
| DL-REL-21 | Low         | Dead Schema    | db.ts:118                 | cost_events table created but never used               |

---

## Recommended Priority

**Immediate (Sprint 1):**

- DL-REL-1: Add `foreign_keys = ON` reassertion after migration transaction
- DL-REL-2: Wrap updateTask in a transaction
- DL-REL-3: Add audit trail to markTaskDone/Cancelled
- DL-REL-7: Add WAL checkpoint to closeDb()

**Near-term (Sprint 2):**

- DL-REL-5: Surface backup failures
- DL-REL-6: Add periodic WAL checkpoint
- DL-REL-8, DL-REL-9: Add audit trail to claim/release
- DL-REL-13, DL-REL-14: Add column name regex assertions
- Write tests for supabase-import.ts

**Backlog:**

- DL-REL-4, DL-REL-11, DL-REL-17: Supabase import hardening (low priority since it is a one-time migration)
- DL-REL-10, DL-REL-12, DL-REL-16, DL-REL-18: Moderate cleanup items
- DL-REL-19, DL-REL-20, DL-REL-21: Low-severity items
