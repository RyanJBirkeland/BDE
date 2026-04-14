# Data Access Layer Audit — 2026-04-13

## Summary

The BDE data access layer demonstrates **solid architecture foundations** with a well-defined ISprintTaskRepository abstraction, comprehensive transaction handling around critical operations, and systematic audit trail recording. However, **task-group-queries.ts** has fallen behind the logging pattern established in sprint-queries.ts—it uses raw console.error instead of injectable loggers. Additionally, settings-queries.ts has similar console.warn calls that lack injection points. The migration system is robust and correct, but a few edge cases in transaction atomicity warrant attention.

## Findings

## F-t1-datalay-1: Console logging in task-group-queries without injectable logger

**Severity:** Medium
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/data/task-group-queries.ts:82, 100, 117, 157, 172, 189, 204, 223, 242, 270, 298, 322` (12 occurrences)
**Evidence:**
```typescript
// Line 82
console.error(`[task-group-queries] createGroup failed: ${msg}`)

// Line 100
console.error(`[task-group-queries] listGroups failed: ${msg}`)

// Line 117
console.error(`[task-group-queries] getGroup failed for id=${id}: ${msg}`)
// ... and 9 more raw console.error calls
```

**Impact:** While sprint-queries.ts has `setSprintQueriesLogger()` for injectable structured logging, task-group-queries.ts logs directly to console.error. This breaks the ability to:
- Route group-related errors through structured logging pipelines
- Test error scenarios without console noise
- Differentiate error severity in production logs
When the app scales, these hardcoded console calls become noise in stdout that can't be filtered or redirected.

**Recommendation:** 
1. Add module-level `let logger: Logger` with default console implementation
2. Export `setTaskGroupQueriesLogger(l: Logger)` function
3. Replace all `console.error(...)` with `logger.error(...)`
4. Call `setTaskGroupQueriesLogger(myLogger)` during bootstrap alongside `setSprintQueriesLogger()`

**Effort:** S
**Confidence:** High

---

## F-t1-datalay-2: Console logging in settings-queries without injectable logger

**Severity:** Medium
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/data/settings-queries.ts:38, 44-45`
**Evidence:**
```typescript
// Line 38
console.warn(`[settings-queries] Validation failed for setting "${key}"`)

// Lines 44-45
console.warn(
  `[settings-queries] Failed to parse JSON for setting "${key}": ${getErrorMessage(err)}`
)
```

**Impact:** Same as F-t1-datalay-1—settings are configuration-critical, and validation/parse failures are important signals. When a setting fails to deserialize, callers can't tell if the logger ignored it or if they simply didn't instrument properly. Tests also get polluted by console output.

**Recommendation:**
1. Add module-level `let logger: Logger` with console defaults
2. Export `setSettingsQueriesLogger(l: Logger)`
3. Replace both console.warn calls with logger.warn
4. Call `setSettingsQueriesLogger(myLogger)` during bootstrap

**Effort:** S
**Confidence:** High

---

## F-t1-datalay-3: resolve-dependents logs to raw console.warn instead of injectable logger

**Severity:** Low
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/resolve-dependents.ts:109`
**Evidence:**
```typescript
;(logger ?? console).warn(`[resolve-dependents] Error resolving dependent ${depId}: ${err}`)
```

**Impact:** This is a fallback pattern (`logger ?? console`), which is better than hardcoded console, but it's still inconsistent with the injectable logger pattern used elsewhere. The function accepts a `logger` parameter but defaults to console when undefined. This is particularly problematic in dependency resolution—if a dependent can't be unblocked, the error can silently disappear if no logger is provided.

**Recommendation:** Make logger a required parameter in the function signature, or add a Module-level default logger like sprint-queries.ts. Callers should always provide a logger so dependency failures are visible.

**Effort:** S
**Confidence:** Medium

---

## F-t1-datalay-4: Potential non-atomic dependent resolution when resolve-dependents fails

**Severity:** High
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/agent-manager/resolve-dependents.ts:48-111` (especially lines 79-90, 102-106)
**Evidence:**
```typescript
for (const depId of dependents) {
  try {
    const task = getTask(depId)
    if (!task || task.status !== 'blocked') continue

    // ... status cache built ...
    
    if (shouldCascadeCancel && hasHardDepOnFailed) {
      updateTask(depId, { status: 'cancelled', notes: cancelNote })
      // RECURSIVE CALL without transaction context — each call is independent
      resolveDependents(depId, 'cancelled', index, getTask, updateTask, logger, ...)
      continue
    }

    if (satisfied) {
      // Also no transaction context
      updateTask(depId, { status: 'queued' })
    }
  } catch (err) {
    (logger ?? console).warn(`[resolve-dependents] Error resolving dependent ${depId}: ${err}`)
  }
}
```

**Impact:** If a cascading cancel triggers 10 dependent tasks, and the 5th one throws an exception:
1. Tasks 0-4 are cancelled (committed)
2. Task 5 throws, caught silently, loop continues
3. Tasks 6-9 are left in 'blocked' state instead of being cancelled
4. There's no rollback or recovery—the system is left in an inconsistent state with partial cancellation

Similarly, when unblocking dependents after a task completes, if unblocking task A succeeds but unblocking task B fails mid-way, task B remains blocked while others proceed, causing confusion.

**Recommendation:**
1. Wrap the entire dependent resolution in a single database transaction
2. If any updateTask fails, roll back all cascading changes
3. Either: (a) batch updates and apply in one transaction, or (b) collect all updates and apply atomically at the end
4. Do not recurse into `resolveDependents` without inheriting the transaction scope

**Effort:** M
**Confidence:** High

---

## F-t1-datalay-5: Task group operations bypass audit trail when reordering

**Severity:** Medium
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/data/task-group-queries.ts:251-273`
**Evidence:**
```typescript
export function reorderGroupTasks(
  groupId: string,
  orderedTaskIds: string[],
  db?: Database.Database
): boolean {
  try {
    const conn = db ?? getDb()
    const updateStmt = conn.prepare('UPDATE sprint_tasks SET sort_order = ? WHERE id = ?')

    const transaction = conn.transaction(() => {
      orderedTaskIds.forEach((taskId, index) => {
        updateStmt.run(index, taskId)  // <-- No audit trail recorded
      })
    })

    transaction()
    return true
  } catch (err) { ... }
}
```

**Impact:** When tasks are reordered within a group, the sort_order field changes but no entry is added to task_changes audit table. This is inconsistent with other task mutations (createTask, updateTask, deleteTask) which all record changes. If an admin later asks "who changed the task order?", there's no record. Also makes it harder to debug unexpected reorderings.

**Recommendation:**
1. Add audit trail recording to reorderGroupTasks—iterate through tasks, capture old sort_order, new sort_order
2. Call recordTaskChangesBulk with sort_order changes for each affected task
3. See `markTaskDoneByPrNumber()` in sprint-queries.ts (lines 742-756) for the pattern: fetch task state, record changes, then update

**Effort:** M
**Confidence:** High

---

## F-t1-datalay-6: Missing index for task_groups → sprint_tasks foreign key lookups

**Severity:** Medium
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/data/task-group-queries.ts:212-225` (getGroupTasks query)
**Evidence:**
```typescript
export function getGroupTasks(groupId: string, db?: Database.Database): SprintTask[] {
  // Queries: SELECT * FROM sprint_tasks WHERE group_id = ? ORDER BY sort_order...
  // This is called frequently when rendering group UI
}
```

Migration v027 creates the task_groups table and adds group_id to sprint_tasks, but the corresponding index is missing. Checking migrations:
- v039: Creates `idx_sprint_tasks_status_claimed_by` (partial)
- v040: Creates `idx_sprint_tasks_status_created_at` (composite)
- v041: Creates `idx_task_changes_task_id_changed_at` (composite)
- v043: Creates `idx_agent_events_agent_id_timestamp` (covering)

But **no index on sprint_tasks(group_id)** exists, so every call to getGroupTasks, queueAllGroupTasks, or deleteGroup (which updates group_id to NULL for children) will table-scan sprint_tasks.

**Impact:** As the task count grows (hundreds → thousands), getGroupTasks becomes a full table scan. In the UI, this blocks the render thread. In bulk operations (deleteGroup updating all children), multiple scans compound the cost.

**Recommendation:**
1. Create migration v049: `CREATE INDEX idx_sprint_tasks_group_id ON sprint_tasks(group_id)`
2. Consider composite: `idx_sprint_tasks_group_id_sort_order` if sort_order queries are common

**Effort:** S
**Confidence:** High

---

## F-t1-datalay-7: Missing defensive-in-depth check in task-group-queries update allowlist

**Severity:** Low
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/data/task-group-queries.ts:132`
**Evidence:**
```typescript
export function updateGroup(
  id: string,
  patch: UpdateGroupInput,
  db?: Database.Database
): TaskGroup | null {
  try {
    const conn = db ?? getDb()
    const allowed = new Set(['name', 'icon', 'accent_color', 'goal', 'status', 'depends_on'])
    const fields = Object.keys(patch).filter((k) => allowed.has(k))
    // ... dynamic SQL construction ...
    const setClauses = fields.map((f) => `${f} = ?`)
    const values = fields.map((f) => { ... })
    const stmt = conn.prepare(`UPDATE task_groups SET ${setClauses.join(', ')} WHERE id = ?`)
```

Compare to sprint-queries.ts (line 135-142):
```typescript
// Defense-in-depth: Whitelist Map replaces regex
export const COLUMN_MAP = new Map<string, string>(
  Array.from(UPDATE_ALLOWLIST).map((col) => [col, col])
)
if (COLUMN_MAP.size !== UPDATE_ALLOWLIST.size) {
  throw new Error('COLUMN_MAP/UPDATE_ALLOWLIST mismatch')
}
```

And later (line 402-405):
```typescript
const colName = COLUMN_MAP.get(key)
if (!colName) {
  throw new Error(`Invalid column name: ${key}`)
}
setClauses.push(`${colName} = ?`)
```

task-group-queries uses a Set filter but doesn't do the second lookup—it directly interpolates the filtered field names into the SQL. If someone accidentally adds a field to the patch that passes the Set check but shouldn't be in the SQL, there's no second validation gate.

**Impact:** Low risk (the allowed Set is small and static), but inconsistent with sprint-queries' two-level validation. If a future refactor adds many more fields, this becomes riskier.

**Recommendation:**
1. Add const TASK_GROUP_COLUMN_MAP similar to COLUMN_MAP in sprint-queries
2. Validate each field against the map before interpolation
3. Throw if any field is invalid

**Effort:** S
**Confidence:** Medium

---

## F-t1-datalay-8: Circular transaction handling in deleteGroup and addGroupDependency/removeGroupDependency

**Severity:** Low
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/data/task-group-queries.ts:165-175, 278-300, 306-325`
**Evidence:**
```typescript
// deleteGroup – no transaction wrapping
export function deleteGroup(id: string, db?: Database.Database): void {
  try {
    const conn = db ?? getDb()
    conn.prepare('UPDATE sprint_tasks SET group_id = NULL WHERE group_id = ?').run(id)
    conn.prepare('DELETE FROM task_groups WHERE id = ?').run(id)
  } catch (err) {
    console.error(...)
    throw err
  }
}

// addGroupDependency – calls updateGroup which constructs SQL but doesn't wrap transaction
export function addGroupDependency(
  groupId: string,
  dep: EpicDependency,
  db?: Database.Database
): TaskGroup | null {
  try {
    const conn = db ?? getDb()
    const group = getGroup(groupId, conn)
    if (!group) throw new Error(...)

    const currentDeps = group.depends_on ?? []
    if (currentDeps.some((d) => d.id === dep.id)) {
      throw new Error(...)
    }

    const newDeps = [...currentDeps, dep]
    return updateGroup(groupId, { depends_on: newDeps }, conn)
  } catch (err) {
    console.error(...)
    throw err
  }
}
```

If deleteGroup is interrupted between the UPDATE and DELETE, the group record is orphaned with no tasks pointing to it. Similarly, if addGroupDependency's getGroup + updateGroup race with concurrent operations, the dependency list could be corrupted (last-write-wins without ACID).

**Impact:** Low in practice because these are admin operations on epics (not high-frequency), but they're still cross-table mutations that should be atomic. If two admins click "Add Dependency" simultaneously on the same group, one dependency could silently disappear.

**Recommendation:**
1. Wrap deleteGroup in a transaction: `db.transaction(() => { ... })()`
2. Wrap addGroupDependency and removeGroupDependency similarly
3. This prevents interleaved reads and writes during concurrent operations

**Effort:** S
**Confidence:** Medium

---

## F-t1-datalay-9: Reporting-queries logger setup mirrors sprint-queries but lacks setReportingQueriesLogger call in bootstrap

**Severity:** Low
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/data/reporting-queries.ts:12-21` vs `/Users/ryan/projects/BDE/src/main/index.ts:25`
**Evidence:**
```typescript
// reporting-queries.ts sets up logger pattern correctly
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
  debug: (m) => console.debug(m)
}

export function setReportingQueriesLogger(l: Logger): void {
  logger = l
}
```

But in index.ts bootstrap, only sprint-queries logger is injected:
```typescript
setSprintQueriesLogger(createLogger('sprint-queries'))
// Missing: setReportingQueriesLogger(createLogger('reporting-queries'))
```

**Impact:** Reporting query errors (getDoneTodayCount failures, getFailureReasonBreakdown errors) are logged to console instead of the structured logger. Low severity because reporting is not critical path, but it's inconsistent and leaks into stdout.

**Recommendation:** In index.ts after `setSprintQueriesLogger()`, add `setReportingQueriesLogger(createLogger('reporting-queries'))`.

**Effort:** S
**Confidence:** High

---

## F-t1-datalay-10: No indexes on commonly-filtered agent_run columns despite high query volume

**Severity:** Medium
**Category:** Data Access Layer
**Location:** `/Users/ryan/projects/BDE/src/main/migrations/v048-add-composite-index-on-agent-runs-status-started-at.ts` and agent-manager usage
**Evidence:**
Migration v048 adds `idx_agent_runs_status_started_at` for queries filtered by status and ordered by started_at (recent runs). However:
- Queries filtering on `agent_id` alone (e.g., "all runs for this agent") lack an index
- Queries on `created_at` without status lack an index
- The agent-manager requests recent runs very frequently but may not use status filter

Grep through agent-manager code shows multiple calls to getDb().prepare(...).all() without clear indexes.

**Impact:** Agent manager runs often hit unindexed scans on the agent_runs table. As the historical runs table grows (thousands of runs per session), these queries slow down and can block the event loop.

**Recommendation:**
1. Audit agent-manager query patterns: which WHERE clauses are actually used?
2. Create v049 migrations for missing indexes:
   - `CREATE INDEX idx_agent_runs_agent_id ON agent_runs(agent_id)` (for single-agent filtering)
   - `CREATE INDEX idx_agent_runs_created_at ON agent_runs(created_at DESC)` (for time-based queries)
3. Optionally composite: `idx_agent_runs_agent_id_created_at` if agent + time queries are common

**Effort:** M
**Confidence:** Medium

---

## Summary of Recommendations

| Priority | Finding | Action |
|----------|---------|--------|
| HIGH | F-t1-datalay-4: Non-atomic cascade cancellation | Wrap resolve-dependents in transaction; prevent partial failures |
| HIGH | F-t1-datalay-6: Missing index on sprint_tasks(group_id) | Add migration v049 |
| HIGH | F-t1-datalay-1: task-group-queries raw console | Add injectable logger with setTaskGroupQueriesLogger |
| HIGH | F-t1-datalay-2: settings-queries raw console | Add injectable logger with setSettingsQueriesLogger |
| MEDIUM | F-t1-datalay-5: No audit trail on reorderGroupTasks | Record sort_order changes in task_changes |
| MEDIUM | F-t1-datalay-8: Untrapped transactions in group ops | Wrap deleteGroup, addGroupDependency in transactions |
| MEDIUM | F-t1-datalay-10: Missing agent_runs indexes | Audit and create v049-v050 for agent_id, created_at |
| LOW | F-t1-datalay-3: resolve-dependents logger default | Make logger required parameter |
| LOW | F-t1-datalay-7: updateGroup lacks COLUMN_MAP | Add TASK_GROUP_COLUMN_MAP for consistency |
| LOW | F-t1-datalay-9: Missing setReportingQueriesLogger in bootstrap | Inject reporting logger during index.ts initialization |

