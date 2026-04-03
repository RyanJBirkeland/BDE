# AgentManager Pipeline Tech Debt Remediation — Design Spec

## Goal

Fix reliability issues, eliminate duplication, and decompose oversized functions in the AgentManager pipeline. Changes span `sprint-queries.ts`, `worktree.ts`, `index.ts`, `completion.ts`, and shared utilities.

## Motivation

The AgentManager pipeline has three classes of tech debt identified via audit:

1. **Reliability** — Silent error swallowing causes production flakiness. sprint-queries.ts has 3 inconsistent error patterns. worktree.ts has ~12 empty `catch {}` blocks. `releaseTask` can clobber another executor's claim.
2. **Duplication** — Auto-block note formatting and dependency index creation are duplicated 3x each across index.ts, task-handlers.ts, and sprint-local.ts.
3. **Complexity** — `drainLoop` (127 lines, 4 levels deep) and `resolveSuccess` (175 lines) do too many things. Magic numbers scattered across files.

## Non-Goals

- Changing the Supabase schema or RLS policies
- Refactoring the Queue API HTTP layer
- Changing the renderer / Zustand stores
- Adding new features

---

## Phase 1 — Reliability Fixes

### 1a. sprint-queries.ts: Standardize Error Handling

**Current state:** 3 patterns — return null (8 functions), throw (4 functions), silent fail (7 functions).

**Target state:** All functions return `null`/`[]` on error, never throw, always log via injected logger. Matches claude-task-runner's `supabase-task-repository.ts` pattern.

**Changes:**

1. Add optional `Logger` parameter to the module (or use a module-level `setLogger()` initializer):

```typescript
// Module-level logger, defaults to console
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m)
}

export function setSprintQueriesLogger(l: Logger): void {
  logger = l
}
```

2. Convert 4 throwing functions to return pattern:
   - `createTask()` — currently throws on error → return `null`, log error
   - `getQueuedTasks()` — currently throws raw error → return `[]`, log error
   - `getOrphanedTasks()` — currently throws → return `[]`, log error
   - `getTasksWithDependencies()` — currently throws → return `[]`, log error

3. Add logging to 7 silent-failure functions:
   - `deleteTask()`, `clearSprintTaskFk()`, `markTaskDoneViaPR()`, `markTaskCancelledViaPR()`, etc.
   - Pattern: `if (error) { logger.warn(\`[sprint-queries] ${fnName} failed: ${error.message}\`); return null }`

4. Update callers that expect throws:
   - `index.ts:fetchQueuedTasks()` — wraps `getQueuedTasks` with `Promise.race`. Currently catches timeout + thrown errors. After change: check for empty array instead of catching.
   - `index.ts:start()` — `getTasksWithDependencies().then(...).catch(...)` → check for empty array in `.then()`
   - `index.ts:drainLoop()` — same pattern for dep index refresh
   - `orphan-recovery.ts` — `getOrphanedTasks()` caller has try/catch → simplify

**Testing:** Write tests asserting each converted function returns `null`/`[]` on Supabase error (not throws). Verify callers handle the new return values.

### 1b. worktree.ts: Log Silent Catch Chains

**Current state:** ~12 `catch {}` or `catch { /* best-effort */ }` blocks with no logging.

**Target state:** All catch blocks log at `warn` level with context about what failed and why. No behavior change — just visibility. Scope: every empty `catch` in `worktree.ts` — grep for `catch {` and `catch (` with empty/comment-only bodies.

**Known locations (non-exhaustive — implementer should grep for all):**

- `releaseLock` rmSync failure
- `git worktree remove` fallback to `rmSync`
- worktree list fallback to prune
- worktree path removal fallback
- rev-list count failure (branch may not exist)
- branch delete first attempt
- retry failure cleanup
- non-branch-exists error cleanup
- `pruneStaleWorktrees` rmSync failure
- `cleanupWorktree` callback chain errors
- any additional empty catches found via grep

**Pattern:**

```typescript
// Before:
} catch { /* best-effort */ }

// After:
} catch (err) {
  logger.warn(`[worktree] Failed to ${action}: ${err}`)
}
```

**Testing:** Existing worktree tests already cover these paths. Verify tests still pass after adding logging.

### 1c. releaseTask: Add Executor Guard

**Current state:** `releaseTask` clears `claimed_by` and `agent_run_id` without verifying the caller owns the claim.

**Target state:** Add `.eq('claimed_by', executorId)` guard so only the owning executor can release.

**Change in sprint-queries.ts:**

```typescript
export async function releaseTask(taskId: string, executorId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('sprint_tasks')
    .update({ claimed_by: null, agent_run_id: null, status: 'queued' })
    .eq('id', taskId)
    .eq('claimed_by', executorId) // NEW: only release if we own it
  if (error) {
    logger.warn(`[sprint-queries] releaseTask failed for id=${taskId}: ${error.message}`)
  }
}
```

**Callers to update:** Grep for `releaseTask` — currently called from queue-api task handlers and potentially sprint-local.ts. All callers must pass executorId.

**Testing:** Test that releaseTask with wrong executorId doesn't clear claimed_by.

---

## Phase 2 — DRY / Decomposition

### 2a. Extract Shared Auto-Block Utility

**Current duplication:** 3 locations format the same `[auto-block] Blocked by: ...` string.

**New function** in `src/main/agent-manager/dependency-helpers.ts`:

```typescript
export function formatBlockedNote(blockedBy: string[]): string {
  return `[auto-block] Blocked by: ${blockedBy.join(', ')}`
}

export function stripBlockedNote(notes: string | null): string {
  if (!notes) return ''
  return notes.replace(/^\[auto-block\] .*\n?/, '').trim()
}
```

**Callers to update:**

- `index.ts:265` — drain loop auto-block
- `queue-api/task-handlers.ts:220` — createTask auto-block
- `handlers/sprint-local.ts:129, 184` — sprint:create and sprint:update
- `resolve-dependents.ts:59` — note stripping

### 2b. Shared Dependency Check Helper

**Current duplication:** 3 locations create a dependency index, rebuild from all tasks, and check satisfaction.

**New function** in `src/main/agent-manager/dependency-helpers.ts`:

```typescript
export async function checkTaskDependencies(
  taskId: string,
  rawDeps: unknown,
  logger: Logger
): Promise<{ shouldBlock: boolean; blockedBy: string[] }> {
  // Parse deps, create index, check satisfaction
  // Returns { shouldBlock: false, blockedBy: [] } if deps satisfied or unparseable
}
```

**Callers to update:**

- `index.ts:254-276` — drain loop dep check
- `queue-api/task-handlers.ts:205-227` — createTask dep check
- `handlers/sprint-local.ts:114-129, 170-184` — sprint handlers

### 2c. Decompose drainLoop

**Current:** 127 lines, 4 levels of nesting.

**Extract:** `processQueuedTask(raw, taskStatusMap, config, deps, logger)` — handles a single queued task (dep check → claim → worktree → spawn). ~60 lines moved out of drainLoop.

**Result:** drainLoop becomes: check OAuth → fetch tasks → for-each processQueuedTask → recover concurrency. ~40 lines.

### 2d. Decompose resolveSuccess

**Current:** 175 lines doing 7 things.

**Extract into completion.ts:**

- `detectBranch(worktreePath: string): Promise<string>` — git rev-parse
- `autoCommitIfDirty(worktreePath: string, title: string): Promise<void>` — git status + add + commit
- `pushBranch(worktreePath: string, branch: string): Promise<void>` — git push
- `findOrCreatePR(worktreePath: string, branch: string, title: string, ghRepo: string): Promise<{ prUrl: string | null; prNumber: number | null }>` — gh pr list/create

**Error handling contract:** These extracted functions may throw — `resolveSuccess` is the orchestrator that catches and handles errors. This differs from Phase 1a's "never throw" pattern which applies only to the Supabase query layer.

**Result:** resolveSuccess becomes orchestration calling 4 focused functions. Each can be tested independently.

### 2e. Remove Dead Export

Remove `preloadOAuthToken()` from `sdk-adapter.ts`. Deprecated, no callers.

---

## Phase 3 — Polish

### 3a. Extract Magic Numbers

Add to `types.ts`:

```typescript
export const BRANCH_SLUG_MAX_LENGTH = 40
export const LAST_OUTPUT_MAX_LENGTH = 500
export const AGENT_SUMMARY_MAX_LENGTH = 300
export const NOTES_MAX_LENGTH = 500
```

Replace hardcoded values in `worktree.ts:15`, `run-agent.ts:262`, `completion.ts:132,263`.

### 3b. Convert Async Imports to Top-Level

In `queue-api/task-handlers.ts:207-210`:

```typescript
// Before:
const { createDependencyIndex } = await import('../agent-manager/dependency-index')
const { listTasks } = await import('../data/sprint-queries')

// After (top-level):
import { createDependencyIndex } from '../agent-manager/dependency-index'
import { listTasks } from '../data/sprint-queries'
```

**Note:** If Phase 2b's `checkTaskDependencies` helper replaces these imports entirely, skip 3b for this file — the imports will already be gone.

---

## Testing Strategy

| Phase | Approach                                                                                                 |
| ----- | -------------------------------------------------------------------------------------------------------- |
| 1a    | TDD: Write tests asserting return-not-throw for converted functions. Update caller tests.                |
| 1b    | Existing tests pass. Add assertions that logger.warn is called on failure paths.                         |
| 1c    | New test: releaseTask with mismatched executorId is a no-op.                                             |
| 2a-2b | Unit tests for new helpers. Existing integration tests verify behavioral equivalence.                    |
| 2c-2d | Existing tests pass (behavioral equivalence). New unit tests for extracted functions.                    |
| 2e    | Remove preloadOAuthToken test from `sdk-adapter-sdk-path.test.ts` (surgical removal, not file deletion). |
| 3a-3b | No new tests. Existing tests validate.                                                                   |

## Files Changed

| File                                           | Phase      | Change                                              |
| ---------------------------------------------- | ---------- | --------------------------------------------------- |
| `src/main/data/sprint-queries.ts`              | 1a, 1c     | Error handling standardization, executor guard      |
| `src/main/agent-manager/worktree.ts`           | 1b         | Add logging to catch blocks                         |
| `src/main/agent-manager/index.ts`              | 1a, 2c     | Update callers, decompose drainLoop                 |
| `src/main/agent-manager/completion.ts`         | 2d         | Decompose resolveSuccess                            |
| `src/main/agent-manager/dependency-helpers.ts` | 2a, 2b     | **New file** — shared auto-block + dep check        |
| `src/main/queue-api/task-handlers.ts`          | 2a, 2b, 3b | Use shared helpers, fix imports                     |
| `src/main/handlers/sprint-local.ts`            | 2a, 2b     | Use shared helpers                                  |
| `src/main/agent-manager/resolve-dependents.ts` | 2a         | Use stripBlockedNote                                |
| `src/main/agent-manager/sdk-adapter.ts`        | 2e         | Remove preloadOAuthToken                            |
| `src/main/agent-manager/types.ts`              | 3a         | Add magic number constants                          |
| `src/main/agent-manager/orphan-recovery.ts`    | 1a         | Simplify error handling after sprint-queries change |
