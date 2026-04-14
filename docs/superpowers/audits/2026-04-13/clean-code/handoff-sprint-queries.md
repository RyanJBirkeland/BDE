# Handoff: `sprint-queries.ts` God File Decomposition

**File:** `src/main/data/sprint-queries.ts`
**Current size:** 972 lines
**Goal:** Split into focused modules with one reason to change each

---

## Current State

The file already had reporting queries extracted to `reporting-queries.ts` (re-exported via the shim at the top). That's the only decomposition done so far. The remaining 972 lines still own 6 distinct responsibilities.

### What's in the file now

| Responsibility | Functions | Lines (approx) |
|---|---|---|
| Data mapping / serialization | `mapRowToTask`, `mapRowsToTasks`, `serializeFieldForStorage` | ~60 |
| Constants and types | `UPDATE_ALLOWLIST`, `COLUMN_MAP`, `QueueStats`, `CreateTaskInput` | ~80 |
| Core CRUD | `getTask`, `listTasks`, `listTasksRecent`, `createTask`, `createReviewTaskFromAdhoc`, `updateTask`, `deleteTask` | ~300 |
| Queue / concurrency ops | `claimTask`, `releaseTask`, `getQueuedTasks`, `checkWipLimit`, `getActiveTaskCount` | ~120 |
| PR lifecycle ops | `markTaskDoneByPrNumber`, `markTaskCancelledByPrNumber`, `listTasksWithOpenPrs`, `updateTaskMergeableState`, `transitionTasksToDone`, `transitionTasksToCancelled`, `updatePrStatusBulk` | ~200 |
| Agent/health queries | `getOrphanedTasks`, `clearSprintTaskFk`, `getHealthCheckTasks`, `getAllTaskIds`, `getTasksWithDependencies` | ~80 |
| Maintenance | `pruneOldDiffSnapshots`, `DIFF_SNAPSHOT_RETENTION_DAYS` | ~25 |
| Stats | `getQueueStats` | ~30 |
| Logger/error infra | `setSprintQueriesLogger`, `withErrorLogging`, logger let | ~25 |

---

## Target File Structure

After decomposition, `sprint-queries.ts` becomes a thin barrel re-export. New files:

```
src/main/data/
├── sprint-queries.ts          ← barrel re-export only (keep for backward compat)
├── sprint-query-constants.ts  ← already exists (SPRINT_TASK_COLUMNS)
├── sprint-task-mapper.ts      ← NEW: mapRowToTask, mapRowsToTasks, serializeFieldForStorage
├── sprint-task-types.ts       ← NEW: QueueStats, CreateTaskInput, UPDATE_ALLOWLIST, COLUMN_MAP
├── sprint-task-crud.ts        ← NEW: getTask, listTasks, listTasksRecent, createTask,
│                                       createReviewTaskFromAdhoc, updateTask, deleteTask
├── sprint-queue-ops.ts        ← NEW: claimTask, releaseTask, getQueuedTasks, checkWipLimit,
│                                       getActiveTaskCount
├── sprint-pr-ops.ts           ← NEW: markTaskDoneByPrNumber, markTaskCancelledByPrNumber,
│                                       listTasksWithOpenPrs, updateTaskMergeableState,
│                                       transitionTasksToDone, transitionTasksToCancelled,
│                                       updatePrStatusBulk
├── sprint-agent-queries.ts    ← NEW: getOrphanedTasks, clearSprintTaskFk, getHealthCheckTasks,
│                                       getAllTaskIds, getTasksWithDependencies, getQueueStats
├── sprint-maintenance.ts      ← NEW: pruneOldDiffSnapshots, DIFF_SNAPSHOT_RETENTION_DAYS
├── sprint-query-logger.ts     ← NEW: logger let, setSprintQueriesLogger, withErrorLogging
└── reporting-queries.ts       ← already exists
```

---

## Decomposition Order (do in this order — each step is safe to commit)

### Step 1: Extract logger infrastructure → `sprint-query-logger.ts`

This is the safest first move — nothing depends on logger being in sprint-queries except the internal uses.

**New file `src/main/data/sprint-query-logger.ts`:**
```typescript
import type { Logger } from '../logger'

let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
  debug: (m) => console.debug(m)
}

export function setSprintQueriesLogger(l: Logger): void {
  logger = l
}

export function getSprintQueriesLogger(): Logger {
  return logger
}

export function withErrorLogging<T>(operation: () => T, fallback: T, operationName: string): T {
  try {
    return operation()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] ${operationName} failed: ${msg}`)
    return fallback
  }
}
```

In `sprint-queries.ts`: replace the logger block with `import { setSprintQueriesLogger, getSprintQueriesLogger, withErrorLogging } from './sprint-query-logger'`. Replace `logger.warn/info/error` throughout with `getSprintQueriesLogger().warn/info/error`.

**Re-export from `sprint-queries.ts`:** `export { setSprintQueriesLogger, withErrorLogging } from './sprint-query-logger'` (backward compat).

Commit: `chore: extract sprint-query logger infrastructure`

---

### Step 2: Extract data mapper → `sprint-task-mapper.ts`

**New file `src/main/data/sprint-task-mapper.ts`:**
Move these functions verbatim (they have zero side effects):
- `mapRowToTask(row)`
- `mapRowsToTasks(rows)`
- `serializeFieldForStorage(key, value)` — keep this unexported (internal only, used by crud)

Imports needed: `SprintTask`, `TaskDependency` from shared types, `sanitizeDependsOn`, `sanitizeTags`.

In `sprint-queries.ts`: `import { mapRowToTask, mapRowsToTasks, serializeFieldForStorage } from './sprint-task-mapper'`

**Re-export from `sprint-queries.ts`:** `export { mapRowToTask, mapRowsToTasks } from './sprint-task-mapper'`

Commit: `chore: extract sprint task row mapper`

---

### Step 3: Extract types and constants → `sprint-task-types.ts`

**New file `src/main/data/sprint-task-types.ts`:**
Move:
- `UPDATE_ALLOWLIST` (Set)
- `COLUMN_MAP` (Map + the assertion)
- `QueueStats` interface
- `CreateTaskInput` interface

In `sprint-queries.ts`: import all four from `./sprint-task-types`.
**Re-export from `sprint-queries.ts`** for backward compat.

Commit: `chore: extract sprint task types and allowlists`

---

### Step 4: Extract PR lifecycle ops → `sprint-pr-ops.ts`

**New file `src/main/data/sprint-pr-ops.ts`:**
Move these functions (they form a natural cluster — all revolve around `pr_number`):
- `transitionTasksToDone` (private → module-private via non-export)
- `transitionTasksToCancelled` (private → module-private)
- `updatePrStatusBulk` (private → module-private)
- `markTaskDoneByPrNumber` (exported)
- `markTaskCancelledByPrNumber` (exported)
- `listTasksWithOpenPrs` (exported)
- `updateTaskMergeableState` (exported)

Imports needed: `getDb`, `nowIso`, `SPRINT_TASK_COLUMNS`, `mapRowToTask`, `mapRowsToTasks`, `recordTaskChanges`, `recordTaskChangesBulk`, `getSprintQueriesLogger`.

**Re-export from `sprint-queries.ts`** the four public functions.

Commit: `chore: extract sprint PR lifecycle operations`

---

### Step 5: Extract queue operations → `sprint-queue-ops.ts`

**New file `src/main/data/sprint-queue-ops.ts`:**
Move:
- `checkWipLimit` (private → module-private)
- `claimTask` (exported)
- `releaseTask` (exported)
- `getQueuedTasks` (exported)
- `getActiveTaskCount` (exported)

**Re-export from `sprint-queries.ts`.**

Commit: `chore: extract sprint queue and concurrency operations`

---

### Step 6: Extract agent/health queries → `sprint-agent-queries.ts`

**New file `src/main/data/sprint-agent-queries.ts`:**
Move:
- `getOrphanedTasks`
- `clearSprintTaskFk`
- `getHealthCheckTasks`
- `getAllTaskIds`
- `getTasksWithDependencies`
- `getQueueStats`

**Re-export from `sprint-queries.ts`.**

Commit: `chore: extract sprint agent health and dependency queries`

---

### Step 7: Extract maintenance → `sprint-maintenance.ts`

Move:
- `DIFF_SNAPSHOT_RETENTION_DAYS`
- `pruneOldDiffSnapshots`

**Re-export from `sprint-queries.ts`.**

Commit: `chore: extract sprint snapshot maintenance`

---

### Step 8: Extract CRUD → `sprint-task-crud.ts`

This is the largest and most depended-upon step. Save it for last.

**New file `src/main/data/sprint-task-crud.ts`:**
Move:
- `getTask`
- `listTasks`
- `listTasksRecent`
- `createTask`
- `createReviewTaskFromAdhoc`
- `updateTask` — the most complex; keep its internal helpers inline
- `deleteTask`

Imports needed: `getDb`, `withRetry`, `nowIso`, `sanitizeDependsOn`, `sanitizeTags`, `SPRINT_TASK_COLUMNS`, `UPDATE_ALLOWLIST`, `COLUMN_MAP`, `mapRowToTask`, `mapRowsToTasks`, `serializeFieldForStorage`, `recordTaskChanges`, `recordTaskChangesBulk`, `validateTransition`, `getSprintQueriesLogger`, `getErrorMessage`.

**Re-export from `sprint-queries.ts`.**

Commit: `chore: extract sprint task CRUD operations`

---

### Step 9: Convert `sprint-queries.ts` to barrel

After all extractions, `sprint-queries.ts` should contain only re-exports:
```typescript
export * from './sprint-query-logger'
export * from './sprint-task-mapper'
export * from './sprint-task-types'
export * from './sprint-task-crud'
export * from './sprint-queue-ops'
export * from './sprint-pr-ops'
export * from './sprint-agent-queries'
export * from './sprint-maintenance'
// Already exists:
export { ... } from './reporting-queries'
```

Commit: `chore: convert sprint-queries to barrel re-export`

---

## Key Invariants to Preserve

1. **`sprint-task-repository.ts` interface** — `ISprintTaskRepository` delegates to these functions. None of its method signatures should change.
2. **`setSprintQueriesLogger` must remain importable from `sprint-queries`** — called in `src/main/index.ts` during setup.
3. **`withRetry` wrapping** — `updateTask` and `claimTask` both use `withRetry` for SQLITE_BUSY. Keep this per-function, not extracted.
4. **`validateTransition` call in `updateTask`** — this enforces the state machine at the data layer. Do NOT remove or move it.
5. **Transaction atomicity** — `updateTask`, `claimTask`, `releaseTask`, `deleteTask` all use `db.transaction()`. Preserve these exactly.
6. **Re-export everything from `sprint-queries.ts`** — dozens of files import from this module. The barrel approach means zero import-site changes needed.

---

## Testing

```bash
npm run typecheck   # Must pass after each step
npm test            # Must pass after each step
npm run test:main   # Must pass after each step
```

The test suite for sprint-queries is in `src/main/data/__tests__/sprint-queries.test.ts`. All existing tests must continue to pass unchanged — they import from `sprint-queries.ts`, which now re-exports everything, so no test changes are needed.

---

## Worktree Setup

```bash
git worktree add -b chore/sprint-queries-decomp ~/worktrees/BDE/Users-ryan-projects-BDE/sprint-queries-decomp main
```

Work entirely inside the worktree. Each step above is a safe commit boundary.
