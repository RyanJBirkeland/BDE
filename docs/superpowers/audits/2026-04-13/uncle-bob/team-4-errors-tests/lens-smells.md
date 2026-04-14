# Clean Code Smell Audit: 2026-04-13

## Scope
Examined ~48k lines across `src/main/`, `src/renderer/src/stores/`, and `src/shared/` for Martin Fowler / Uncle Bob code smells, focusing on DRY violations, feature envy, data clumps, primitive obsession, and shotgun surgery patterns.

---

## F-t4-smells-1: Error Handling Pattern Repetition in Data Layer
**Severity:** High
**Category:** DRY
**Location:** `src/main/data/sprint-task-crud.ts`, `src/main/data/sprint-agent-queries.ts`, `src/main/data/sprint-pr-ops.ts`, `src/main/data/task-group-queries.ts` (and 13 more files across `/data`)
**Evidence:** 
Every query function repeats the same try/catch + logger pattern:
```typescript
// Found in 17+ files
try {
  const rows = db.prepare(QUERY).all()
  return mapRowsToTasks(rows)
} catch (err) {
  const msg = getErrorMessage(err)
  getSprintQueriesLogger().warn(`[sprint-queries] funcName failed: ${msg}`)
  return []
}
```
This pattern appears 82+ times in the codebase with zero variation.

**Impact:** 
- Every bug fix to error handling requires changes in 17+ files
- Inconsistent error recovery strategies (some return `[]`, some return `null`, some throw)
- Logging format changes require mass refactoring

**Recommendation:** 
Extract a wrapper function:
```typescript
function withDataLayerErrorHandling<T>(
  operation: () => T,
  operationName: string,
  fallback: T
): T {
  try {
    return operation()
  } catch (err) {
    getSprintQueriesLogger().warn(`[sprint-queries] ${operationName} failed: ${getErrorMessage(err)}`)
    return fallback
  }
}
```
Then refactor all data layer functions to use it, enabling single-point error policy changes.

**Effort:** M
**Confidence:** High

---

## F-t4-smells-2: Duplicated Task Status Transition Logic
**Severity:** High
**Category:** DRY
**Location:** `src/main/data/sprint-pr-ops.ts:15-98` (transitionTasksToDone, transitionTasksToCancelled)
**Evidence:**
Lines 15-54 and 60-98 in sprint-pr-ops.ts implement near-identical patterns:
```typescript
function transitionTasksToDone(prNumber, changedBy, db) {
  const affected = db.prepare(`SELECT ... WHERE pr_number = ? AND status = ?`).all(prNumber, 'active')
  const affectedIds = affected.map(r => r.id)
  if (affectedIds.length > 0) {
    recordTaskChangesBulk([...], changedBy, db)
    db.prepare('UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE ...').run('done', completedAt, prNumber, 'active')
  }
  return affectedIds
}

function transitionTasksToCancelled(prNumber, changedBy, db) {
  const affected = db.prepare(`SELECT ... WHERE pr_number = ? AND status = ?`).all(prNumber, 'active')
  const affectedIds = affected.map(r => r.id)
  if (affectedIds.length > 0) {
    recordTaskChangesBulk([...], changedBy, db)  // IDENTICAL
    db.prepare('UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE ...').run('cancelled', completedAt, prNumber, 'active')  // Only 'done' vs 'cancelled' differs
  }
  return affectedIds
}
```
The two functions differ only in the target status string.

**Impact:**
- Bug fixes require changes in two places
- Maintenance burden increases with each new status type added (e.g., 'error', 'failed')
- Audit trail logic is tightly coupled to transition type

**Recommendation:**
```typescript
function transitionTasksByPrNumber(
  prNumber: number,
  targetStatus: 'done' | 'cancelled' | 'error',
  changedBy: string,
  db: Database.Database
): string[] {
  const affected = db.prepare(
    `SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE pr_number = ? AND status = 'active'`
  ).all(prNumber) as Array<Record<string, unknown>>
  
  const affectedIds = affected.map(r => r.id as string)
  if (affectedIds.length > 0) {
    const completedAt = nowIso()
    recordTaskChangesBulk(
      affected.map(oldTask => ({
        taskId: oldTask.id as string,
        oldTask,
        newPatch: { status: targetStatus, completed_at: completedAt }
      })),
      changedBy,
      db
    )
    db.prepare('UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?')
      .run(targetStatus, completedAt, prNumber, 'active')
  }
  return affectedIds
}
```

**Effort:** M
**Confidence:** High

---

## F-t4-smells-3: IPC Handler Result Type Inconsistency
**Severity:** Medium
**Category:** Primitive Obsession + Divergent Change
**Location:** `src/main/handlers/dashboard-handlers.ts`, `src/main/handlers/cost-handlers.ts`, `src/main/handlers/agent-handlers.ts` (40+ handler files)
**Evidence:**
Each handler defines its own return type pattern with no consistency:
```typescript
// dashboard-handlers.ts: Returns raw data
safeHandle('agent:completionsPerHour', async () => getCompletionsPerHour())

// agent-handlers.ts: Returns {ok, taskId, error}
safeHandle('agents:promoteToReview', async (_e, agentId) => {
  if (!agent) return { ok: false, error: '...' }
  return { ok: true, taskId: '...' }
})

// review.ts: Returns {success, error, conflicts}
safeHandle('review:getDiff', async (_e, payload) => {
  // ...
  return { files }  // OR throws on error
})
```

No unified error shape: some handlers return `{ok, error}`, some return `{success, error}`, some throw, some return data directly.

**Impact:**
- Renderer code must handle 3+ error response shapes
- Adding a new error field requires updating handlers + renderer store + tests
- Inconsistent null/undefined/error semantics (one handler returns empty array on error, another returns null)

**Recommendation:**
Create a standard envelope type:
```typescript
export type HandlerResult<T> = 
  | { status: 'success'; data: T }
  | { status: 'error'; code: string; message: string; details?: unknown }

// All handlers return this shape
safeHandle('agent:completionsPerHour', async () => ({
  status: 'success' as const,
  data: await getCompletionsPerHour()
}))
```

**Effort:** L (requires renderer + handler updates)
**Confidence:** High

---

## F-t4-smells-4: Store Polling Subscription Duplication
**Severity:** Medium
**Category:** DRY
**Location:** `src/renderer/src/stores/dashboardData.ts`, `src/renderer/src/stores/costData.ts`, `src/renderer/src/stores/agentHistory.ts`
**Evidence:**
All renderer stores implement the same fetch-on-mount pattern independently:
```typescript
// dashboardData.ts
fetchAll: async () => {
  const errors: Record<string, string> = {}
  let data1 = []
  try {
    data1 = await window.api.dashboard.completionsPerHour()
  } catch {
    errors.key1 = 'Failed to load X'
  }
  let data2 = []
  try {
    data2 = await window.api.dashboard.recentEvents()
  } catch {
    errors.key2 = 'Failed to load Y'
  }
  // ... repeat for 4+ more API calls
  set({ data1, data2, ..., cardErrors: errors, loading: false })
}

// costData.ts (identical structure, different API calls)
fetchLocalAgents: async () => {
  if (get().isFetching) return
  set({ isFetching: true })
  try {
    const agents = await window.api.cost.getAgentHistory()
    set({ localAgents: agents })
  } catch (err) {
    console.error('[costData] error:', err)
  } finally {
    set({ isFetching: false })
  }
}
```

**Impact:**
- Inconsistent error handling: dashboardData uses `cardErrors` map, costData logs to console
- Inconsistent loading state: some use `loading`, some use `isFetching`
- Future refactor to add retry logic must touch 10+ stores

**Recommendation:**
Create a reusable fetch helper:
```typescript
export function useParallelFetch<T>(
  fetchers: Record<string, () => Promise<T>>,
  onError?: (key: string, error: unknown) => void
): { data: Record<string, T | null>, errors: Record<string, string>, loading: boolean } {
  // Shared logic for parallel error accumulation
}
```

**Effort:** M
**Confidence:** High

---

## F-t4-smells-5: Data Clump - Review Action Parameters
**Severity:** Medium
**Category:** Data Clump + Long Parameters
**Location:** `src/main/services/review-orchestration-service.ts:54-74`
**Evidence:**
Multiple functions accept the same cluster of parameters:
```typescript
async function runPlan(
  taskId: string,
  input: Parameters<typeof classifyReviewAction>[0],  // {action, taskId, task, repoConfig, ...}
  env: NodeJS.ProcessEnv,
  onTerminal: (taskId: string, status: string) => void | Promise<void>
)

export async function mergeLocally(i: MergeLocallyInput) {
  // Unpacks i to: taskId, strategy, env, onStatusTerminal
  await runPlan(i.taskId, {...}, i.env, i.onStatusTerminal)
}

export async function createPr(i: CreatePrInput) {
  // Unpacks i to: taskId, title, body, env, onStatusTerminal
  await runPlan(i.taskId, {...}, i.env, i.onStatusTerminal)
}
```

The cluster `{taskId, env, onStatusTerminal}` appears in every review operation. These three always travel together but are never grouped.

**Impact:**
- Adding a new context parameter (e.g., logger, config) requires updating 5+ function signatures
- Renderer code must manually construct this cluster for each review action
- Tight coupling to injected dependencies

**Recommendation:**
```typescript
export interface ReviewOperationContext {
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
  logger: Logger
}

// Then:
async function runPlan(
  taskId: string,
  input: ReviewActionInput,
  context: ReviewOperationContext
)
```

**Effort:** M
**Confidence:** High

---

## F-t4-smells-6: Feature Envy - TaskStateService Accessing Dependencies
**Severity:** Medium
**Category:** Feature Envy
**Location:** `src/main/services/task-state-service.ts:50-81`
**Evidence:**
`prepareQueueTransition` accepts a task and config, then immediately delegates most work to another module:
```typescript
export async function prepareQueueTransition(
  taskId: string,
  incomingPatch: Record<string, unknown>,
  deps: QueueTransitionDeps
): Promise<QueueTransitionResult> {
  const task = getTask(taskId)  // Uses service layer
  
  // Rule 1: Calls validateTaskSpec (service/spec-quality)
  await validateTaskSpec({...})
  
  // Rule 2: Calls computeBlockState + buildBlockedNotes (dependency-service)
  const { shouldBlock, blockedBy } = computeBlockState(task, {...})
  
  // Rule 3: Returns patch — owns none of the logic
  return { patch: {...}, wasBlocked: true }
}
```

The function is a thin orchestrator that knows too much about internal rules but doesn't own them. It's also called from `sprint-local.ts` handlers, creating a chain: handler → task-state-service → dependency-service → task-state-machine. Each layer is a thin wrapper.

**Impact:**
- Hard to test task-state-service in isolation (must mock computeBlockState, validateTaskSpec)
- Changes to queuing rules scatter across 3+ files
- Unclear where each rule is "owned"

**Recommendation:**
Consolidate rule execution into a single "QueingEngine" class that owns all three rules and handles caching/optimization of dependency checks. Have handlers call this directly instead of delegating through task-state-service.

**Effort:** M
**Confidence:** Medium

---

## F-t4-smells-7: Shotgun Surgery - Task Status Constants
**Severity:** High
**Category:** Shotgun Surgery + Primitive Obsession
**Location:** 
- `src/shared/constants.ts` (TASK_STATUS object)
- `src/shared/task-state-machine.ts` (TASK_STATUSES, TERMINAL_STATUSES, VALID_TRANSITIONS)
- `src/renderer/src/lib/task-status-ui.ts` (STATUS_METADATA map)
- `src/main/data/sprint-task-types.ts` (QueueStats interface with hardcoded status keys)

**Evidence:**
Status values are scattered across 4+ files with no single source:
```typescript
// src/shared/constants.ts
export const TASK_STATUS = {
  BACKLOG: 'backlog',
  QUEUED: 'queued',
  // ...
}

// src/shared/task-state-machine.ts (independently lists all statuses)
export const TASK_STATUSES = ['backlog', 'queued', 'blocked', ...]

// src/renderer/src/lib/task-status-ui.ts (independent metadata map)
export const STATUS_METADATA = {
  backlog: { label: '...', bucketKey: '...', colorToken: '...', ... },
  queued: { ... },
  // ...
}

// src/main/data/sprint-task-types.ts
export interface QueueStats {
  backlog: number
  queued: number
  // ... hardcoded keys
}
```

Adding a new status (e.g., 'paused') requires edits to 4+ files. Removing a status requires hunting through 10+ files to find all references.

**Impact:**
- Status misspellings in new code discovered only at runtime (e.g., `'QUED'` vs `'QUEUED'`)
- Type safety is incomplete: `QueueStats` interface has hardcoded keys instead of deriving from TASK_STATUSES
- Tests must manually enumerate all status combinations

**Recommendation:**
Create a single source of truth file (`src/shared/task-statuses.ts`):
```typescript
export const ALL_TASK_STATUSES = ['backlog', 'queued', 'blocked', 'active', 'review', 'done', 'cancelled', 'failed', 'error'] as const
export type TaskStatus = typeof ALL_TASK_STATUSES[number]

// Derive other constants from this:
export const TASK_STATUSES = ALL_TASK_STATUSES
export const TERMINAL_STATUSES = new Set(['done', 'cancelled', 'failed', 'error'])

// QueueStats derives its keys:
export type QueueStats = Record<TaskStatus, number>
```

This eliminates the multi-file status duplication and makes TypeScript enforce consistency.

**Effort:** M
**Confidence:** High

---

## F-t4-smells-8: Middle Man - Sprint Mutations Service
**Severity:** Medium
**Category:** Middle Man
**Location:** `src/main/services/sprint-mutations.ts` (appears to be thin wrapper), `src/main/services/sprint-service.ts` (getTask, updateTask, deleteTask functions)
**Evidence:**
Looking at typical usage:
```typescript
// Handlers call service layer
const result = updateTask(id, patch)

// Service layer immediately delegates to data layer
export function updateTask(id: string, patch: Record<string, unknown>) {
  const updated = effectiveRepo.updateTask(id, patch)
  if (updated) {
    notifySprintMutation('updated', updated)
  }
  return updated
}

// Repository does the actual work
export function updateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const db = getDb()
  // ... SQL execution
  return result
}
```

The service layer adds only a single concern (broadcasting mutations) but doesn't encapsulate any business logic. It's just a pass-through to the repository + a side effect.

**Impact:**
- Confusion about where to put new logic (service vs repository)
- Handlers must import both the service AND the repository in some cases
- Adding a new mutation listener requires touching the service

**Recommendation:**
Either (1) move the broadcast responsibility into the repository's transaction context, or (2) have handlers directly use the repository and explicitly call broadcast. The current middle layer provides no value.

**Effort:** S
**Confidence:** Medium

---

## F-t4-smells-9: Inappropriate Intimacy - Review Executor Knowing Task Details
**Severity:** Medium
**Category:** Inappropriate Intimacy
**Location:** `src/main/services/review-action-executor.ts:36-42`
**Evidence:**
The review executor's dependency interface exposes task repository access:
```typescript
export interface ReviewActionDeps {
  repo: Pick<ISprintTaskRepository, 'getTask' | 'updateTask'>
  broadcast: (event: string, payload: unknown) => void
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
  env: NodeJS.ProcessEnv
  logger: Logger
}
```

Inside the executor, it directly calls `deps.repo.getTask(taskId)` and `deps.repo.updateTask()`. The executor knows about task structure (worktree_path, agent_run_id, status) and must construct patches with the correct field names. Any schema change (rename field, add validation) requires updating the executor.

**Impact:**
- Repository schema changes leak into executor (tight coupling)
- Hard to test without a real repository mock
- Changes to task state machine might require executor changes

**Recommendation:**
Create a `ReviewFacade` that wraps repository operations and exposes only review-relevant operations:
```typescript
export interface ReviewFacade {
  getTaskForReview(taskId: string): ReviewTaskSnapshot
  updateReviewStatus(taskId: string, status: 'shipped' | 'revision_requested' | 'discarded'): void
}

// Executor only knows about ReviewTaskSnapshot, not SprintTask internals
```

**Effort:** M
**Confidence:** Medium

---

## F-t4-smells-10: Speculative Generality - Update Allowlist Defense-in-Depth
**Severity:** Low
**Category:** Speculative Generality
**Location:** `src/main/data/sprint-task-types.ts:43-51`
**Evidence:**
```typescript
export const UPDATE_ALLOWLIST = new Set([...40 fields...])

// F-t3-datalyr-7: Whitelist Map for defense-in-depth column validation
export const COLUMN_MAP = new Map<string, string>(
  Array.from(UPDATE_ALLOWLIST).map((col) => [col, col])
)

// Module-load assertion: COLUMN_MAP must match UPDATE_ALLOWLIST exactly
if (COLUMN_MAP.size !== UPDATE_ALLOWLIST.size) {
  throw new Error('COLUMN_MAP/UPDATE_ALLOWLIST mismatch')
}
```

The COLUMN_MAP is a Map where keys equal values (`{col: col}`). It adds no information beyond what UPDATE_ALLOWLIST provides. The comment says "defense-in-depth" but there's no actual depth—it's just the same data in a different structure.

**Impact:**
- Maintenance burden: every change to UPDATE_ALLOWLIST requires syncing COLUMN_MAP
- Module assertion adds runtime check cost with no safety benefit (the Map is created deterministically from the Set)
- Code complexity for unclear gain

**Recommendation:**
Remove COLUMN_MAP if it's not actively used by validation logic. If validation needs a Map, create it on-demand or use UPDATE_ALLOWLIST directly with `allowlist.has(field)` checks.

**Effort:** S
**Confidence:** Medium

---

## Summary

| # | Title | Severity | Category | Effort |
|---|-------|----------|----------|--------|
| 1 | Error Handling Pattern Repetition | High | DRY | M |
| 2 | Duplicated Task Status Transition | High | DRY | M |
| 3 | IPC Handler Result Type Inconsistency | Medium | Primitive Obsession | L |
| 4 | Store Polling Subscription Duplication | Medium | DRY | M |
| 5 | Data Clump - Review Action Parameters | Medium | Data Clump | M |
| 6 | Feature Envy - TaskStateService | Medium | Feature Envy | M |
| 7 | Shotgun Surgery - Status Constants | High | Shotgun Surgery | M |
| 8 | Middle Man - Sprint Mutations Service | Medium | Middle Man | S |
| 9 | Inappropriate Intimacy - Review Executor | Medium | Inappropriate Intimacy | M |
| 10 | Speculative Generality - COLUMN_MAP | Low | Speculative Generality | S |

**Total Refactoring Effort:** ~10 weeks of medium-effort work (high ROI items: #1, #2, #7)

**Highest Priority:** Start with #7 (status constants) as it blocks clean refactoring of #1 and #2.
