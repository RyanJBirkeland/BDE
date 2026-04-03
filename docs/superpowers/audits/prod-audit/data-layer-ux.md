# Data Layer -- UX QA Audit

**Date:** 2026-03-29
**Scope:** 19 files (10 source, 9 test) in Data Layer
**Persona:** UX QA (API ergonomics and error propagation quality)

---

## Cross-Reference with Synthesis Final Report

### Previously Reported -- Now Fixed

- **SEC-6** (SQL string interpolation in `backupDatabase()`): Fixed. `backupDatabase()` now validates `backupPath` with a regex before interpolation (`src/main/db.ts:32`).
- **ARCH-2** (Repository pattern inconsistently applied): Partially addressed. `ISprintTaskRepository` exists and is used by agent manager, though IPC handlers and Queue API still call sprint-queries directly (by design per CLAUDE.md).

### Previously Reported -- Still Open

- **ARCH-2** (Queue API bypasses notification channels): The synthesis report notes Queue API writes bypass notification channels. This remains true -- `task-handlers.ts` imports sprint-queries directly, and status changes made through Queue API do not trigger the same side effects (e.g., IPC broadcast) as the `sprint:update` handler.
- **main-process-sd S7** (SQL column allowlist entries): `UPDATE_ALLOWLIST` entries are not regex-validated. Column names are interpolated directly into SQL SET clauses at `sprint-queries.ts:210`. The allowlist is a static `Set` so this is safe in practice, but there is no runtime assertion preventing future additions of unsafe strings.

---

## Findings

### Critical

None found.

### Significant

**DL-UX-1: `pr_status` type mismatch between SQLite CHECK constraint and TypeScript union**

- **File:** `src/main/db.ts:389` (migration v15) vs `src/shared/types.ts:46`
- **Evidence:** The SQLite CHECK constraint allows `('open','merged','closed','draft')`. The TypeScript `SprintTask.pr_status` type includes `'branch_only'` as a valid value. The completion handler writes `pr_status: 'branch_only'` at `src/main/agent-manager/completion.ts:354`.
- **Impact:** Writing `branch_only` to the database succeeds silently because SQLite CHECK constraints on nullable columns only reject non-NULL values that fail the check -- but `branch_only` is NOT in the CHECK list. It works because `pr_status` allows NULL and the CHECK is: `pr_status IS NULL OR pr_status IN (...)`. Wait -- actually, `'branch_only'` is not in the IN list, so `INSERT/UPDATE` with `pr_status = 'branch_only'` should fail the CHECK. However, `updateTask` uses parameterized updates that go through `serializeField`, and `pr_status` is in `UPDATE_ALLOWLIST`. The value `'branch_only'` is written via `updateTask()` which does a parameterized `UPDATE ... SET pr_status = ?`. SQLite will enforce the CHECK and this should throw. The fact that `branch_only` is used in production (`completion.ts:354`, `orphan-recovery.ts:17`, `TaskDetailDrawer.tsx:216`) means either: (a) the CHECK is not enforced (unlikely with `foreign_keys = ON`), or (b) the error is caught and swallowed by `updateTask`'s catch block at line 230, returning `null` silently.
- **Fix:** Add `'branch_only'` to the CHECK constraint in a new migration (v17). This is a type-system/schema mismatch that either silently fails or silently swallows data.

**DL-UX-2: Inconsistent error patterns -- some functions return null, some return empty arrays, some throw, some return Infinity**

- **File:** `src/main/data/sprint-queries.ts` (entire file)
- **Evidence:**
  - `getTask()` returns `null` on error (line 124)
  - `listTasks()` returns `[]` on error (line 146)
  - `createTask()` returns `null` on error (line 176)
  - `updateTask()` returns `null` on error (line 231) -- but also returns `null` when no allowed fields are provided (line 185), and `null` when the task doesn't exist (line 193). Three different failure modes, same return value.
  - `deleteTask()` returns `void` and silently swallows errors (line 239)
  - `getActiveTaskCount()` returns `Infinity` on error (line 457) -- intentional fail-closed design, but surprising
  - `getAllTaskIds()` intentionally throws (line 521) -- comment explains why
  - `getTasksWithDependencies()` intentionally throws (line 533) -- same rationale
- **Impact:** Callers cannot distinguish "not found" from "database error" from "no valid fields in patch." The `updateTask` triple-null is the worst offender: if the DB is down, callers silently get `null` and continue as if the task doesn't exist.
- **Fix:** Return a discriminated union `{ data: T | null; error?: string }` for write operations, or at minimum document the error contract per function. For `updateTask`, return separate signals for "empty patch," "task not found," and "DB error."

**DL-UX-3: Audit trail has silent gaps -- 5 write operations bypass `recordTaskChanges`**

- **File:** `src/main/data/sprint-queries.ts`
- **Evidence:** Only `updateTask()` (line 219) calls `recordTaskChanges()`. The following mutating functions write directly to the database without any audit trail:
  - `claimTask()` (line 243) -- changes `status`, `claimed_by`, `started_at`
  - `releaseTask()` (line 286) -- changes `status`, `claimed_by`, `started_at`, `agent_run_id`
  - `markTaskDoneByPrNumber()` (line 351) -- changes `status`, `completed_at`, `pr_status`
  - `markTaskCancelledByPrNumber()` (line 383) -- changes `status`, `completed_at`, `pr_status`
  - `updateTaskMergeableState()` (line 431) -- changes `pr_mergeable_state`
  - `clearSprintTaskFk()` (line 492) -- changes `agent_run_id`
  - `deleteTask()` (line 235) -- entire row deleted, no tombstone
- **Impact:** Task state changes made by the agent manager drain loop, PR poller, and release endpoints are invisible in the audit trail. A task can go from `active` to `done` via `markTaskDoneByPrNumber` with zero entries in `task_changes`.
- **Fix:** Route all state mutations through a single `updateTask()` call (or a new internal `updateTaskWithAudit()`) so the audit trail is comprehensive.

**DL-UX-4: `backupDatabase()` swallows errors -- caller and user have no feedback**

- **File:** `src/main/db.ts:38-40`
- **Evidence:**
  ```typescript
  } catch (err) {
    console.error('[db] Backup failed:', err)
  }
  ```
  The function returns `void`. The error goes to `console.error`, not to the structured logger. The caller (likely a scheduled job in `index.ts`) has no way to know the backup failed.
- **Impact:** If the backup has been silently failing for weeks (e.g., disk full, permissions), the user discovers this only after data loss.
- **Fix:** Return a success boolean or throw. Use `createLogger('db')` instead of `console.error`. Emit an IPC event or surface a toast on backup failure.

### Moderate

**DL-UX-5: `getSettingJson` silently returns null for corrupt JSON -- no way to distinguish "missing" from "corrupt"**

- **File:** `src/main/data/settings-queries.ts:26-34`
- **Evidence:**
  ```typescript
  export function getSettingJson<T>(db: Database.Database, key: string): T | null {
    const raw = getSetting(db, key)
    if (!raw) return null // key doesn't exist
    try {
      return JSON.parse(raw) as T
    } catch {
      return null // key exists but JSON is corrupt
    }
  }
  ```
- **Impact:** If a setting like `repos` contains corrupt JSON (e.g., truncated write), `getSettingJson` returns `null`, and the caller treats it as "not configured." This is particularly bad for the `repos` setting -- the entire agent manager becomes non-functional with no indication of why.
- **Fix:** Log a warning when JSON parsing fails. Consider returning `{ value: T | null; error?: string }` or a sentinel that distinguishes "missing" from "corrupt."

**DL-UX-6: `setSetting` silently coerces non-string values via JavaScript string coercion**

- **File:** `src/main/data/settings-queries.ts:14`
- **Evidence:** `setSetting` accepts `value: string`, but callers may pass numbers or booleans. JavaScript will coerce `42` to `"42"` and `true` to `"true"`. However, `getSettingJson` will parse `"42"` back to `42`, while `getSetting` returns `"42"` as a string. The two retrieval paths produce different types for the same stored value.
- **Impact:** If someone stores a boolean via `setSetting(db, 'flag', true as unknown as string)`, reading with `getSetting` returns `"true"` (string), but `getSettingJson` returns `true` (boolean). The behavior is correct but the API makes it easy to create type confusion.
- **Fix:** Add a JSDoc warning on `setSetting` that only string values should be passed, or add a runtime type check.

**DL-UX-7: `agent-queries` and `sprint-queries` use incompatible DI patterns**

- **File:** `src/main/data/agent-queries.ts` vs `src/main/data/sprint-queries.ts`
- **Evidence:**
  - `agent-queries.ts`: Every function takes `db: Database.Database` as the first parameter (explicit DI).
  - `sprint-queries.ts`: Every function calls `getDb()` internally (module-level singleton).
  - `cost-queries.ts`: Uses `db` parameter like agent-queries.
  - `event-queries.ts`: Uses `db` parameter like agent-queries.
  - `settings-queries.ts`: Uses `db` parameter like agent-queries.
  - `task-changes.ts`: Uses `db?: Database.Database` optional parameter (hybrid, defaults to `getDb()`).
- **Impact:** Consumers must know which pattern each module uses. Testing sprint-queries requires `vi.mock('../../db')` while all other query modules can simply pass an in-memory DB. This inconsistency is visible in the test files: `sprint-queries.test.ts` needs mock setup while all others just pass `db` directly.
- **Fix:** Migrate `sprint-queries` to accept `db` as a parameter (or use the repository pattern already in place). At minimum, document the divergence.

**DL-UX-8: `updateTask` returns null for empty patch with no indication of why**

- **File:** `src/main/data/sprint-queries.ts:184-185`
- **Evidence:**
  ```typescript
  const entries = Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))
  if (entries.length === 0) return null
  ```
  If a caller passes `{ id: 'new-id', created_at: '2026-01-01' }` (all protected fields), they get `null` back -- identical to "task not found." The filtered-out fields are silently dropped.
- **Impact:** Queue API consumers sending patches with wrong field names (e.g., camelCase `prUrl` instead of `pr_url`) get a `null` response and no indication their fields were ignored.
- **Fix:** Return a distinct result for "no updateable fields" vs "task not found." Log the rejected field names at debug level.

**DL-UX-9: `runMigrations` provides no error feedback on individual migration failure**

- **File:** `src/main/db.ts:440-447`
- **Evidence:**
  ```typescript
  const runAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    }
  })
  runAll()
  ```
  If migration v15 fails, the entire transaction rolls back (correct), but the error propagates as an unhandled exception from `better-sqlite3`. There is no try/catch, no logging of which migration failed, and no indication of what version the DB is stuck at.
- **Impact:** On app startup, a migration failure crashes the app with a raw SQLite error. The user sees an Electron crash dialog with no actionable information like "Migration v15 failed: UNIQUE constraint" or "Your database is at version 14, expected 16."
- **Fix:** Wrap the transaction in a try/catch that logs the failing migration version and description, then re-throws with a user-friendly message.

**DL-UX-10: `supabase-import.ts` silently drops rows with invalid status values**

- **File:** `src/main/data/supabase-import.ts:100-158`
- **Evidence:** The import uses `INSERT OR IGNORE`. If a Supabase row has a status not in the SQLite CHECK constraint (e.g., the Supabase schema may have had different valid statuses), the row is silently dropped. The `imported` counter still increments (line 157) because it counts loop iterations, not successful inserts.
- **Impact:** The log says "Imported 50 sprint tasks from Supabase" but only 45 were actually inserted. The user has no way to know 5 tasks were lost.
- **Fix:** Check `result.changes` on each `insert.run()` call. Log a warning for each row that was silently ignored, including the task ID and status.

### Minor

**DL-UX-11: `createTask` prompt fallback chain is undocumented and surprising**

- **File:** `src/main/data/sprint-queries.ts:163`
- **Evidence:**
  ```typescript
  input.prompt ?? input.spec ?? input.title,
  ```
  If no `prompt` is provided, it falls back to `spec`, then to `title`. This means creating a task with `{ title: 'Fix login', spec: '## Requirements\n...' }` results in `prompt` being set to the full spec text.
- **Impact:** The prompt field ends up containing the full spec, which is then used as the agent prompt. This may be intentional but it is undocumented and the `CreateTaskInput` interface gives no hint about the fallback.
- **Fix:** Add a JSDoc comment on `CreateTaskInput.prompt` explaining the fallback chain.

**DL-UX-12: `recordTaskChanges` always defaults `changedBy` to `'unknown'`**

- **File:** `src/main/data/task-changes.ts:23` and `src/main/data/sprint-queries.ts:219-223`
- **Evidence:** `recordTaskChanges` has `changedBy: string = 'unknown'`. The sole caller in `sprint-queries.ts` at line 219 does not pass a `changedBy` argument, so every audit trail entry says `changed_by = 'unknown'`.
- **Impact:** The audit trail records what changed but not who changed it (IPC handler? Queue API? Agent manager? PR poller?). The `changedBy` parameter exists but is never used by the primary codepath.
- **Fix:** Pass a meaningful `changedBy` string from each caller context (e.g., `'ipc'`, `'queue-api'`, `'agent-manager'`, `'pr-poller'`).

**DL-UX-13: `ISprintTaskRepository` interface is incomplete -- missing 10 of 20 sprint-queries functions**

- **File:** `src/main/data/sprint-task-repository.ts:9-17`
- **Evidence:** The interface exposes 7 methods: `getTask`, `updateTask`, `getQueuedTasks`, `getTasksWithDependencies`, `getOrphanedTasks`, `getActiveTaskCount`, `claimTask`. Missing: `createTask`, `deleteTask`, `listTasks`, `releaseTask`, `getQueueStats`, `getDoneTodayCount`, `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `listTasksWithOpenPrs`, `updateTaskMergeableState`, `clearSprintTaskFk`, `getHealthCheckTasks`, `getQueuedTasks`, `getAllTaskIds`.
- **Impact:** Any consumer wanting to use the repository pattern for a function not in the interface must fall back to importing sprint-queries directly, defeating the abstraction.
- **Fix:** Either expand the interface to cover all query functions, or document which functions are intentionally excluded and why.

**DL-UX-14: `deleteTask` returns void -- caller cannot confirm deletion occurred**

- **File:** `src/main/data/sprint-queries.ts:235-241`
- **Evidence:**
  ```typescript
  export function deleteTask(id: string): void {
    try {
      getDb().prepare('DELETE FROM sprint_tasks WHERE id = ?').run(id)
    } catch (err) {
      logger.warn(`[sprint-queries] deleteTask failed for id=${id}: ${err}`)
    }
  }
  ```
  No return value. No indication of whether 0 or 1 rows were deleted. Errors are caught and logged.
- **Impact:** Deleting a non-existent task looks identical to deleting an existing one. The IPC handler has no way to return a 404.
- **Fix:** Return `boolean` (or the `changes` count) indicating whether a row was actually deleted.

**DL-UX-15: `updateAgentMeta` returns raw `AgentRunRow` while all other agent-queries functions return `AgentMeta`**

- **File:** `src/main/data/agent-queries.ts:120-143`
- **Evidence:** `updateAgentMeta` returns `AgentRunRow | null` (snake_case DB row). All other read functions (`getAgentMeta`, `listAgents`, `findAgentByPid`, `listAgentRunsByTaskId`) return `AgentMeta` (camelCase mapped). The comment says "Return the updated row for callers that need to write meta.json."
- **Impact:** Callers must handle two different shapes depending on which function they called. The test at `agent-queries.test.ts:82` accesses `row!.exit_code` (snake_case), while everywhere else it's `result!.exitCode`.
- **Fix:** Return `AgentMeta` from `updateAgentMeta` as well, or at minimum document the inconsistency.

**DL-UX-16: `cost-queries` hardcodes `NULL AS pr_url` -- vestigial from a removed JOIN**

- **File:** `src/main/data/cost-queries.ts:83` and `cost-queries.ts:170`
- **Evidence:**
  ```sql
  ar.task AS title, NULL AS pr_url, ar.repo
  ```
  Both `getAgentHistory` and `getRecentAgentRunsWithCost` select `NULL AS pr_url`. The `AgentCostRecord` and `AgentRunCostRow` types include `pr_url` / `prUrl` fields, but they are always null.
- **Impact:** Consumers of cost data see a `prUrl` field and may try to display it, only to find it is always null. This is dead data from a removed sprint_tasks JOIN.
- **Fix:** Remove the `pr_url` column from the SQL and the return types, or restore the JOIN if the data is needed.

**DL-UX-17: `task-changes.ts` uses hybrid DI with optional `db?` parameter and fallback to `getDb()`**

- **File:** `src/main/data/task-changes.ts:24-25`
- **Evidence:**
  ```typescript
  export function recordTaskChanges(
    taskId: string, oldTask: ..., newPatch: ...,
    changedBy: string = 'unknown',
    db?: Database.Database
  ): void {
    const conn = db ?? getDb()
  ```
  The `db` parameter is the 5th positional argument after `changedBy`. The primary caller (`sprint-queries.ts:219`) passes 3 arguments (omitting both `changedBy` and `db`), relying on both defaults.
- **Impact:** If a caller wants to pass `db` but not `changedBy`, they must explicitly pass `'unknown'` as the 4th argument. The positional API is awkward.
- **Fix:** Use an options object: `recordTaskChanges(taskId, oldTask, newPatch, { changedBy?, db? })`.

---

## Summary Table

| ID       | Severity    | File                                          | Issue                                                                              |
| -------- | ----------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| DL-UX-1  | Significant | `db.ts:389`, `types.ts:46`                    | `pr_status` CHECK constraint missing `branch_only` -- schema/type mismatch         |
| DL-UX-2  | Significant | `sprint-queries.ts`                           | Inconsistent error patterns: null vs [] vs Infinity vs throw                       |
| DL-UX-3  | Significant | `sprint-queries.ts`                           | 5+ write functions bypass audit trail (`recordTaskChanges`)                        |
| DL-UX-4  | Significant | `db.ts:38-40`                                 | `backupDatabase()` swallows errors, no caller feedback                             |
| DL-UX-5  | Moderate    | `settings-queries.ts:26-34`                   | `getSettingJson` returns null for both missing and corrupt JSON                    |
| DL-UX-6  | Moderate    | `settings-queries.ts:14`                      | `setSetting` type coercion creates get/getJson divergence                          |
| DL-UX-7  | Moderate    | `agent-queries.ts` vs `sprint-queries.ts`     | Incompatible DI patterns across query modules                                      |
| DL-UX-8  | Moderate    | `sprint-queries.ts:184-185`                   | `updateTask` returns null for empty patch (same as not-found)                      |
| DL-UX-9  | Moderate    | `db.ts:440-447`                               | `runMigrations` has no error context on failure                                    |
| DL-UX-10 | Moderate    | `supabase-import.ts:100-158`                  | `INSERT OR IGNORE` silently drops rows; counter inflated                           |
| DL-UX-11 | Minor       | `sprint-queries.ts:163`                       | Undocumented prompt fallback chain (prompt -> spec -> title)                       |
| DL-UX-12 | Minor       | `task-changes.ts:23`, `sprint-queries.ts:219` | `changedBy` always `'unknown'` in audit trail                                      |
| DL-UX-13 | Minor       | `sprint-task-repository.ts:9-17`              | `ISprintTaskRepository` covers only 7 of 20 query functions                        |
| DL-UX-14 | Minor       | `sprint-queries.ts:235-241`                   | `deleteTask` returns void, caller can't confirm deletion                           |
| DL-UX-15 | Minor       | `agent-queries.ts:120-143`                    | `updateAgentMeta` returns raw row (snake_case) while peers return mapped AgentMeta |
| DL-UX-16 | Minor       | `cost-queries.ts:83,170`                      | `pr_url` always NULL -- vestigial column from removed JOIN                         |
| DL-UX-17 | Minor       | `task-changes.ts:24-25`                       | Hybrid DI with awkward positional `db?` as 5th parameter                           |

---

## Recommended Priority

1. **DL-UX-1** (schema mismatch) -- data integrity risk, quick migration fix
2. **DL-UX-3** (audit gaps) -- undermines the audit trail feature entirely
3. **DL-UX-12** (changedBy unknown) -- easy fix, high value for debugging
4. **DL-UX-2** (error patterns) -- larger refactor, but foundational
5. **DL-UX-4** (backup errors) -- silent failure on a safety-critical operation
6. **DL-UX-9** (migration errors) -- affects startup reliability
7. **DL-UX-5** (corrupt JSON) -- moderate risk, simple logging fix
8. Everything else in severity order
