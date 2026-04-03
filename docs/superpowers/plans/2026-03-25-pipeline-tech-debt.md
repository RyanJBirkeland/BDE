# Pipeline Tech Debt Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reliability issues, eliminate duplication, and decompose oversized functions in the AgentManager pipeline.

**Architecture:** Three sequential phases — Phase 1 fixes error handling and logging (reliability), Phase 2 extracts shared utilities and decomposes large functions (DRY), Phase 3 cleans up constants and imports (polish). Each phase produces a working, passing test suite.

**Tech Stack:** TypeScript, Vitest, Supabase client, Node.js child_process

**Spec:** `docs/superpowers/specs/2026-03-25-pipeline-tech-debt-design.md`

**Worktree:** Create at `~/worktrees/BDE/<branch-name>`

**Run tests:** `npx vitest run --config src/main/vitest.main.config.ts`

---

## File Structure

| File                                           | Action     | Phase | Responsibility                                                      |
| ---------------------------------------------- | ---------- | ----- | ------------------------------------------------------------------- |
| `src/main/data/sprint-queries.ts`              | Modify     | 1     | Standardize error handling, add logger, add executor guard          |
| `src/main/agent-manager/worktree.ts`           | Modify     | 1     | Add logging to all silent catch blocks                              |
| `src/main/agent-manager/index.ts`              | Modify     | 1, 2  | Update callers for new sprint-queries contract; decompose drainLoop |
| `src/main/agent-manager/orphan-recovery.ts`    | Modify     | 1     | Simplify after sprint-queries change                                |
| `src/main/agent-manager/dependency-helpers.ts` | **Create** | 2     | Shared auto-block formatting + dependency check helper              |
| `src/main/agent-manager/completion.ts`         | Modify     | 2     | Decompose resolveSuccess into focused functions                     |
| `src/main/queue-api/task-handlers.ts`          | Modify     | 2     | Use shared dep helpers, convert async imports to top-level          |
| `src/main/handlers/sprint-local.ts`            | Modify     | 2     | Use shared dep helpers                                              |
| `src/main/agent-manager/resolve-dependents.ts` | Modify     | 2     | Use shared stripBlockedNote                                         |
| `src/main/agent-manager/sdk-adapter.ts`        | Modify     | 2     | Remove dead preloadOAuthToken                                       |
| `src/main/agent-manager/types.ts`              | Modify     | 3     | Add magic number constants                                          |

---

## Phase 1: Reliability Fixes

### Task 1: sprint-queries.ts — Add Logger Injection

**Files:**

- Modify: `src/main/data/sprint-queries.ts:1-10`
- Test: `src/main/data/__tests__/sprint-queries.test.ts`

- [ ] **Step 1: Add module-level logger with setter**

At the top of `sprint-queries.ts`, after imports, add:

```typescript
import type { Logger } from '../agent-manager/types'

// Module-level logger — defaults to console, injectable for testing/structured logging
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m)
}

export function setSprintQueriesLogger(l: Logger): void {
  logger = l
}
```

- [ ] **Step 2: Replace all `console.warn` calls with `logger.warn`**

Find-and-replace in sprint-queries.ts:

- `console.warn(` → `logger.warn(`

There are ~10 instances. Each `console.warn('[sprint-queries] ...')` becomes `logger.warn('[sprint-queries] ...')`.

- [ ] **Step 3: Run tests to verify no breakage**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/sprint-queries.test.ts`
Expected: PASS (console.warn still works as default)

- [ ] **Step 4: Commit**

```bash
git add src/main/data/sprint-queries.ts
git commit -m "refactor: inject logger into sprint-queries (defaults to console)"
```

---

### Task 2: sprint-queries.ts — Convert Throwing Functions to Return Pattern

**Files:**

- Modify: `src/main/data/sprint-queries.ts:109-135, 351-368, 399-412`
- Test: `src/main/data/__tests__/sprint-queries.test.ts`

Four functions currently throw on Supabase error. Convert each to return `null`/`[]` and log.

- [ ] **Step 1: Write failing tests for new return behavior**

Add tests asserting that `createTask`, `getQueuedTasks`, `getOrphanedTasks`, and `getTasksWithDependencies` return fallback values (not throw) when Supabase errors.

```typescript
it('createTask returns null and logs on Supabase error', async () => {
  mockSupabase.from.mockReturnValue({
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({ data: null, error: { message: 'DB down' } })
      })
    })
  })
  const result = await createTask({ title: 'Test', repo: 'myrepo' })
  expect(result).toBeNull()
})

it('getQueuedTasks returns [] on Supabase error', async () => {
  // Mock Supabase to return error
  const result = await getQueuedTasks(5)
  expect(result).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/sprint-queries.test.ts`
Expected: FAIL (functions still throw)

- [ ] **Step 3: Convert `createTask` (line 131-133)**

```typescript
// Before:
if (error) {
  throw new Error(`[sprint-queries] createTask failed: ${error.message}`)
}
return sanitizeTask(data)

// After:
if (error) {
  logger.warn(`[sprint-queries] createTask failed: ${error.message}`)
  return null
}
return data ? sanitizeTask(data) : null
```

**Return type changes from `Promise<SprintTask>` to `Promise<SprintTask | null>`.**

- [ ] **Step 4: Convert `getQueuedTasks` (line 358)**

```typescript
// Before:
if (error) throw error

// After:
if (error) {
  logger.warn(`[sprint-queries] getQueuedTasks failed: ${error.message}`)
  return []
}
```

- [ ] **Step 5: Convert `getOrphanedTasks` (line 366)**

```typescript
// Before:
if (error) throw error

// After:
if (error) {
  logger.warn(`[sprint-queries] getOrphanedTasks failed: ${error.message}`)
  return []
}
```

- [ ] **Step 6: Convert `getTasksWithDependencies` (line 406)**

```typescript
// Before:
if (error) throw error

// After:
if (error) {
  logger.warn(`[sprint-queries] getTasksWithDependencies failed: ${error.message}`)
  return []
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/sprint-queries.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/data/sprint-queries.ts src/main/data/__tests__/sprint-queries.test.ts
git commit -m "fix: convert throwing sprint-queries functions to return null/[] on error"
```

---

### Task 3: Update Callers That Expected Throws

**Files:**

- Modify: `src/main/agent-manager/index.ts`
- Modify: `src/main/agent-manager/orphan-recovery.ts`

- [ ] **Step 1: Update `fetchQueuedTasks` wrapper in index.ts**

The wrapper at lines 31-38 uses `Promise.race` to catch hangs AND thrown errors. After the change, `getQueuedTasks` returns `[]` on error instead of throwing. The timeout race still catches hangs, but the error path changes.

```typescript
// Current (line 31-38):
async function fetchQueuedTasks(limit: number): Promise<Array<Record<string, unknown>>> {
  const result = await Promise.race([
    _getQueuedTasks(limit),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('getQueuedTasks timeout')), QUEUE_TIMEOUT_MS)
    )
  ])
  return result as unknown as Array<Record<string, unknown>>
}

// Keep as-is — the Promise.race still guards against hangs.
// The only change: getQueuedTasks no longer throws on Supabase error (returns []).
// Timeout still throws, which is caught by the drain loop's outer try/catch.
// No code change needed here.
```

- [ ] **Step 2: Update `start()` dep index builder in index.ts**

Lines 356-361 use `.then().catch()` because `getTasksWithDependencies` used to throw. It still works with empty array return — `.then()` receives `[]`, rebuild is a no-op.

```typescript
// No code change needed — .then([]) is fine, depIndex.rebuild([]) is safe.
```

- [ ] **Step 3: Update `drainLoop` dep index refresh in index.ts**

Lines 153-159 also use try/catch for `getTasksWithDependencies`. After change, no throw occurs — but the try/catch is harmless. Keep it for the timeout case.

```typescript
// No code change needed — try/catch still guards against timeout.
```

- [ ] **Step 4: Simplify `orphan-recovery.ts`**

`recoverOrphans` calls `getOrphanedTasks` which used to throw. The caller already handles this in the outer `recoverOrphans` function's try/catch (in index.ts orphanLoop). After the change, `getOrphanedTasks` returns `[]` on error, so `recoverOrphans` just processes an empty list — no crash.

```typescript
// No code change needed in orphan-recovery.ts — empty array is safe.
```

- [ ] **Step 5: Update `createTask` caller in sprint-local.ts**

`sprint:create` handler calls `_createTask(task)` and expects a SprintTask back. After change, it can return `null`. The handler should check:

In `src/main/handlers/sprint-local.ts:133`:

```typescript
// Before:
const row = await _createTask(task)

// After:
const row = await _createTask(task)
if (!row) throw new Error('Failed to create task')
```

This preserves the IPC error behavior (safeHandle catches and returns error to renderer).

- [ ] **Step 6: Update `createTask` caller in task-handlers.ts**

In `src/main/queue-api/task-handlers.ts:230`:

```typescript
// Before:
const task = await createTask(createInput as unknown as Parameters<typeof createTask>[0])

// After:
const task = await createTask(createInput as unknown as Parameters<typeof createTask>[0])
if (!task) {
  res.writeHead(500, CORS_JSON)
  res.end(JSON.stringify({ error: 'Failed to create task' }))
  return
}
```

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run --config src/main/vitest.main.config.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/handlers/sprint-local.ts src/main/queue-api/task-handlers.ts
git commit -m "fix: update createTask callers to handle null return"
```

---

### Task 4: worktree.ts — Add Logging to Silent Catch Blocks

**Files:**

- Modify: `src/main/agent-manager/worktree.ts`
- Test: `src/main/agent-manager/__tests__/worktree.test.ts`

- [ ] **Step 1: Grep for all empty catch blocks**

```bash
grep -n 'catch {' src/main/agent-manager/worktree.ts
grep -n 'catch (' src/main/agent-manager/worktree.ts | head -20
```

- [ ] **Step 2: Add logging to each empty catch block**

For every `catch { /* ... */ }` or `catch { }` in worktree.ts, change to:

```typescript
// Pattern — adapt the message to describe the specific operation:
} catch (err) {
  ;(logger ?? console).warn(`[worktree] Failed to <operation>: ${err}`)
}
```

Key locations and their messages:

- `releaseLock` rmSync: `"Failed to remove lock file"`
- Stale worktree force-remove fallback: `"Failed to rm stale worktree path"`
- Worktree list fallback: `"Failed to list worktrees for stale branch cleanup"`
- Worktree path removal fallback: `"Failed to remove existing worktree path"`
- Rev-list count: `"Failed to check unpushed commits (branch may not exist yet)"`
- Push before delete: `"Failed to push stale branch before delete"`
- Branch delete first attempt: `"Failed to delete branch (will prune and retry)"`
- Retry cleanup: `"Failed to cleanup worktree path after retry failure"`
- Non-branch-exists cleanup: `"Failed to remove worktree after non-branch error"`
- pruneStaleWorktrees rmSync: `"Failed to remove stale worktree directory"`
- readdirSync catch: `"Failed to read repo directory during prune"`

Note: `cleanupWorktree` uses callback-style execFile — those callbacks already have a fire-and-forget pattern. No change needed there.

- [ ] **Step 3: Run worktree tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/worktree.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/worktree.ts
git commit -m "fix: add logging to all silent catch blocks in worktree.ts"
```

---

### Task 5: releaseTask — Add Executor Guard

**Files:**

- Modify: `src/main/data/sprint-queries.ts:195-208`
- Modify: `src/main/handlers/sprint-local.ts:65-66`
- Modify: `src/main/queue-api/task-handlers.ts:429`
- Test: `src/main/data/__tests__/sprint-queries.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
it('releaseTask only releases when claimed_by matches', async () => {
  // Mock Supabase to verify .eq('claimed_by', executorId) is called
  // This requires checking the query chain
})
```

- [ ] **Step 2: Update `releaseTask` signature and add guard**

```typescript
// Before:
export async function releaseTask(id: string): Promise<SprintTask | null> {
  const { data, error } = await getSupabaseClient()
    .from('sprint_tasks')
    .update({ status: 'queued', claimed_by: null, started_at: null, agent_run_id: null })
    .eq('id', id)
    .eq('status', 'active')

// After:
export async function releaseTask(id: string, claimedBy: string): Promise<SprintTask | null> {
  const { data, error } = await getSupabaseClient()
    .from('sprint_tasks')
    .update({ status: 'queued', claimed_by: null, started_at: null, agent_run_id: null })
    .eq('id', id)
    .eq('status', 'active')
    .eq('claimed_by', claimedBy)  // Only release if we own the claim
```

- [ ] **Step 3: Update callers**

In `src/main/handlers/sprint-local.ts:65-66`:

```typescript
// Before:
export async function releaseTask(id: string): Promise<SprintTask | null> {
  const result = await _releaseTask(id)

// After:
export async function releaseTask(id: string, claimedBy: string): Promise<SprintTask | null> {
  const result = await _releaseTask(id, claimedBy)
```

In `src/main/queue-api/task-handlers.ts:429`:

```typescript
// Before:
const released = await releaseTask(id)

// After — parse claimedBy from request body or use EXECUTOR_ID:
const claimedBy = (body as Record<string, unknown>).claimed_by as string
if (!claimedBy) {
  res.writeHead(400, CORS_JSON)
  res.end(JSON.stringify({ error: 'claimed_by is required for release' }))
  return
}
const released = await releaseTask(id, claimedBy)
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run --config src/main/vitest.main.config.ts`
Expected: Some tests may fail if they call releaseTask without the new parameter. Fix mock setups.

- [ ] **Step 5: Fix any test failures from signature change**

Update test mocks that call `releaseTask` to include the claimedBy parameter.

- [ ] **Step 6: Commit**

```bash
git add src/main/data/sprint-queries.ts src/main/handlers/sprint-local.ts src/main/queue-api/task-handlers.ts src/main/data/__tests__/sprint-queries.test.ts
git commit -m "fix: add executor guard to releaseTask — require claimed_by match"
```

---

## Phase 2: DRY / Decomposition

### Task 6: Create dependency-helpers.ts — Shared Auto-Block Utilities

**Files:**

- Create: `src/main/agent-manager/dependency-helpers.ts`
- Create: `src/main/agent-manager/__tests__/dependency-helpers.test.ts`

- [ ] **Step 1: Write tests for formatBlockedNote and stripBlockedNote**

```typescript
import { describe, it, expect } from 'vitest'
import { formatBlockedNote, stripBlockedNote } from '../dependency-helpers'

describe('formatBlockedNote', () => {
  it('formats blocked-by list with prefix', () => {
    expect(formatBlockedNote(['task-1', 'task-2'])).toBe('[auto-block] Blocked by: task-1, task-2')
  })
})

describe('stripBlockedNote', () => {
  it('removes auto-block prefix from notes', () => {
    expect(stripBlockedNote('[auto-block] Blocked by: task-1\nUser notes here')).toBe(
      'User notes here'
    )
  })
  it('returns empty string for null', () => {
    expect(stripBlockedNote(null)).toBe('')
  })
  it('returns original when no prefix', () => {
    expect(stripBlockedNote('Just user notes')).toBe('Just user notes')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/dependency-helpers.test.ts`
Expected: FAIL (module doesn't exist)

- [ ] **Step 3: Implement dependency-helpers.ts**

```typescript
/**
 * Shared utilities for task dependency management.
 * Used by index.ts drain loop, task-handlers.ts, sprint-local.ts, and resolve-dependents.ts.
 */

const BLOCK_PREFIX = '[auto-block] '

export function formatBlockedNote(blockedBy: string[]): string {
  return `${BLOCK_PREFIX}Blocked by: ${blockedBy.join(', ')}`
}

export function stripBlockedNote(notes: string | null): string {
  if (!notes) return ''
  return notes.replace(/^\[auto-block\] .*\n?/, '').trim()
}

export function buildBlockedNotes(blockedBy: string[], existingNotes?: string | null): string {
  const blockNote = formatBlockedNote(blockedBy)
  const userNotes = stripBlockedNote(existingNotes)
  return userNotes ? `${blockNote}\n${userNotes}` : blockNote
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/dependency-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/dependency-helpers.ts src/main/agent-manager/__tests__/dependency-helpers.test.ts
git commit -m "feat: add shared dependency-helpers — formatBlockedNote, stripBlockedNote, buildBlockedNotes"
```

---

### Task 7: Replace Inline Auto-Block Formatting with Shared Helpers

**Files:**

- Modify: `src/main/agent-manager/index.ts:268`
- Modify: `src/main/queue-api/task-handlers.ts:219-221`
- Modify: `src/main/handlers/sprint-local.ts:129, 183-188`
- Modify: `src/main/agent-manager/resolve-dependents.ts:55-59`

- [ ] **Step 1: Update index.ts drain loop**

```typescript
// Before (line 268):
notes: `[auto-block] Blocked by: ${blockedBy.join(', ')}`,

// After:
import { formatBlockedNote } from './dependency-helpers'
// ...
notes: formatBlockedNote(blockedBy),
```

- [ ] **Step 2: Update task-handlers.ts**

```typescript
// Before (line 219-221):
createInput.status = 'blocked'
const existingNotes = createInput.notes ? `\n${createInput.notes}` : ''
createInput.notes = `[auto-block] Blocked by: ${blockedBy.join(', ')}${existingNotes}`

// After:
import { buildBlockedNotes } from '../agent-manager/dependency-helpers'
// ...
createInput.status = 'blocked'
createInput.notes = buildBlockedNotes(blockedBy, createInput.notes as string | null)
```

- [ ] **Step 3: Update sprint-local.ts (both locations)**

```typescript
// sprint:create (line 128-129):
// Before:
notes: `[auto-block] Blocked by: ${blockedBy.join(', ')}${task.notes ? `\n${task.notes}` : ''}`

// After:
import { buildBlockedNotes } from '../agent-manager/dependency-helpers'
// ...
notes: buildBlockedNotes(blockedBy, task.notes)

// sprint:update (lines 183-188):
// Before:
const existingNotes = (task.notes || '').replace(/^\[auto-block\] .*\n?/, '').trim()
const blockNote = `[auto-block] Blocked by: ${blockedBy.join(', ')}`
// ...
notes: existingNotes ? `${blockNote}\n${existingNotes}` : blockNote

// After:
notes: buildBlockedNotes(blockedBy, task.notes)
```

- [ ] **Step 4: Update resolve-dependents.ts**

```typescript
// Before (lines 55-59):
const BLOCK_PREFIX = '[auto-block] '
// ...
const userNotes = existingNotes.replace(/^\[auto-block\] .*\n?/, '').trim()

// After:
import { stripBlockedNote } from './dependency-helpers'
// ...
const userNotes = stripBlockedNote(existingNotes)
```

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --config src/main/vitest.main.config.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/queue-api/task-handlers.ts src/main/handlers/sprint-local.ts src/main/agent-manager/resolve-dependents.ts
git commit -m "refactor: use shared dependency-helpers for auto-block formatting"
```

---

### Task 8: Extract Shared Dependency Check Helper

**Files:**

- Modify: `src/main/agent-manager/dependency-helpers.ts`
- Modify: `src/main/agent-manager/__tests__/dependency-helpers.test.ts`

- [ ] **Step 1: Write test for checkTaskDependencies**

```typescript
describe('checkTaskDependencies', () => {
  it('returns shouldBlock=false when no deps', async () => {
    const result = await checkTaskDependencies('task-1', null, makeLogger())
    expect(result).toEqual({ shouldBlock: false, blockedBy: [] })
  })

  it('returns shouldBlock=true with blockedBy when deps unsatisfied', async () => {
    // Mock listTasks to return tasks with known statuses
    // Provide deps that reference a non-done task
  })
})
```

- [ ] **Step 2: Implement checkTaskDependencies**

Add to `dependency-helpers.ts`:

```typescript
import { createDependencyIndex } from './dependency-index'
import { listTasks } from '../data/sprint-queries'
import type { Logger } from './types'

export async function checkTaskDependencies(
  taskId: string,
  rawDeps: unknown,
  logger: Logger
): Promise<{ shouldBlock: boolean; blockedBy: string[] }> {
  if (!rawDeps) return { shouldBlock: false, blockedBy: [] }
  try {
    const deps = typeof rawDeps === 'string' ? JSON.parse(rawDeps) : rawDeps
    if (!Array.isArray(deps) || deps.length === 0) return { shouldBlock: false, blockedBy: [] }

    const idx = createDependencyIndex()
    const allTasks = await listTasks()
    const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))
    idx.rebuild(allTasks.map((t) => ({ id: t.id, depends_on: t.depends_on, status: t.status })))

    const { satisfied, blockedBy } = idx.areDependenciesSatisfied(taskId, deps, (depId: string) =>
      statusMap.get(depId)
    )
    return { shouldBlock: !satisfied && blockedBy.length > 0, blockedBy }
  } catch (err) {
    logger.warn(`[dependency-helpers] checkTaskDependencies failed for ${taskId}: ${err}`)
    return { shouldBlock: false, blockedBy: [] }
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/dependency-helpers.test.ts`
Expected: PASS

- [ ] **Step 4: Replace inline dep checks in callers**

Update `sprint-local.ts` (2 locations) and `task-handlers.ts` (1 location) to use `checkTaskDependencies`.

Example for sprint-local.ts sprint:create (lines 114-132):

```typescript
// Before: 10 lines of inline dep index creation + check
// After:
import { checkTaskDependencies, buildBlockedNotes } from '../agent-manager/dependency-helpers'
// ...
if (task.depends_on && task.depends_on.length > 0 && (task.status === 'queued' || !task.status)) {
  const { shouldBlock, blockedBy } = await checkTaskDependencies(
    'new-task',
    task.depends_on,
    logger
  )
  if (shouldBlock) {
    task = { ...task, status: 'blocked', notes: buildBlockedNotes(blockedBy, task.notes) }
  }
}
```

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --config src/main/vitest.main.config.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/dependency-helpers.ts src/main/agent-manager/__tests__/dependency-helpers.test.ts src/main/handlers/sprint-local.ts src/main/queue-api/task-handlers.ts
git commit -m "refactor: extract shared checkTaskDependencies helper — dedup 3 inline copies"
```

---

### Task 9: Decompose drainLoop — Extract processQueuedTask

**Files:**

- Modify: `src/main/agent-manager/index.ts`

- [ ] **Step 1: Extract the inner for-loop body to a separate function**

Extract lines ~246-320 (the per-task processing inside `for (const raw of queued)`) into:

```typescript
async function processQueuedTask(
  raw: Record<string, unknown>,
  taskStatusMap: Map<string, string>
): Promise<void> {
  // ... existing per-task logic: map fields, check deps, resolve repo, claim, setup worktree, spawn
}
```

Keep it as a closure inside `createAgentManager` (it needs access to `config`, `depIndex`, `runAgentDeps`, etc.).

- [ ] **Step 2: Replace inline body with function call**

```typescript
for (const raw of queued) {
  if (shuttingDown) break
  await processQueuedTask(raw, taskStatusMap)
}
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run --config src/main/vitest.main.config.ts`
Expected: PASS (behavioral equivalence)

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/index.ts
git commit -m "refactor: extract processQueuedTask from drainLoop — reduce nesting"
```

---

### Task 10: Decompose resolveSuccess — Extract Focused Functions

**Files:**

- Modify: `src/main/agent-manager/completion.ts`
- Test: `src/main/agent-manager/__tests__/completion.test.ts`

- [ ] **Step 1: Extract `detectBranch`**

```typescript
async function detectBranch(worktreePath: string): Promise<string> {
  const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktreePath,
    env: buildAgentEnv()
  })
  return stdout.trim()
}
```

- [ ] **Step 2: Extract `autoCommitIfDirty`**

```typescript
async function autoCommitIfDirty(
  worktreePath: string,
  title: string,
  logger: Logger
): Promise<void> {
  const { stdout: statusOut } = await execFile('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    env: buildAgentEnv()
  })
  if (statusOut.trim()) {
    logger.info(`[completion] Auto-committing uncommitted changes`)
    await execFile('git', ['add', '-A'], { cwd: worktreePath, env: buildAgentEnv() })
    await execFile('git', ['commit', '-m', `${title}\n\nAutomated commit by BDE agent manager`], {
      cwd: worktreePath,
      env: buildAgentEnv()
    })
  }
}
```

- [ ] **Step 3: Extract `findOrCreatePR`**

```typescript
async function findOrCreatePR(
  worktreePath: string,
  branch: string,
  title: string,
  ghRepo: string,
  logger: Logger
): Promise<{ prUrl: string | null; prNumber: number | null }> {
  // ... existing PR check + create logic from resolveSuccess lines 158-220
}
```

- [ ] **Step 4: Rewrite resolveSuccess as orchestrator**

```typescript
export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  const { taskId, worktreePath, title, ghRepo, onTaskTerminal, agentSummary, retryCount } = opts

  if (!existsSync(worktreePath)) {
    // ... worktree eviction guard (unchanged)
    return
  }

  let branch: string
  try {
    branch = await detectBranch(worktreePath)
  } catch (err) {
    // ... branch detection error (unchanged)
    return
  }
  if (!branch) {
    /* ... */ return
  }

  try {
    await autoCommitIfDirty(worktreePath, title, logger)
  } catch (err) {
    logger.warn(`[completion] Auto-commit failed for task ${taskId}: ${err}`)
  }

  // Check commits, push, create PR...
  // (remaining orchestration logic)
}
```

- [ ] **Step 5: Run tests to verify behavioral equivalence**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/completion.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/completion.ts
git commit -m "refactor: decompose resolveSuccess into detectBranch, autoCommitIfDirty, findOrCreatePR"
```

---

### Task 11: Remove Deprecated preloadOAuthToken

**Files:**

- Modify: `src/main/agent-manager/sdk-adapter.ts:7-9`
- Modify: `src/main/index.ts:30,118` (caller)
- Modify: `src/main/agent-manager/__tests__/sdk-adapter-sdk-path.test.ts`

- [ ] **Step 1: Replace caller in src/main/index.ts**

`preloadOAuthToken()` is called at app startup (line 118) and imported at line 30. Replace with a direct `getOAuthToken()` call:

```typescript
// Before (line 30):
import { preloadOAuthToken } from './agent-manager/sdk-adapter'
// After:
import { getOAuthToken } from './env-utils'

// Before (line 118):
preloadOAuthToken()
// After:
getOAuthToken()
```

Note: `getOAuthToken` may already be imported in index.ts — check first and avoid duplicate imports.

- [ ] **Step 2: Remove preloadOAuthToken from sdk-adapter.ts**

Delete lines 7-9:

```typescript
/** @deprecated Use getOAuthToken() from env-utils instead. Kept for API compat. */
export function preloadOAuthToken(): void {
  getOAuthToken()
}
```

- [ ] **Step 3: Remove test for preloadOAuthToken from sdk-adapter-sdk-path.test.ts**

Delete the `describe('preloadOAuthToken', ...)` block and its import.

- [ ] **Step 4: Grep to confirm no remaining references**

```bash
grep -r 'preloadOAuthToken' src/
```

Expected: No matches

- [ ] **Step 5: Run tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/sdk-adapter.ts src/main/index.ts src/main/agent-manager/__tests__/sdk-adapter-sdk-path.test.ts
git commit -m "chore: remove deprecated preloadOAuthToken — replace with direct getOAuthToken call"
```

---

## Phase 3: Polish

### Task 12: Extract Magic Numbers to Constants

**Files:**

- Modify: `src/main/agent-manager/types.ts`
- Modify: `src/main/agent-manager/worktree.ts`
- Modify: `src/main/agent-manager/run-agent.ts`
- Modify: `src/main/agent-manager/completion.ts`

- [ ] **Step 1: Add constants to types.ts**

```typescript
export const BRANCH_SLUG_MAX_LENGTH = 40
export const LAST_OUTPUT_MAX_LENGTH = 500
export const AGENT_SUMMARY_MAX_LENGTH = 300
export const NOTES_MAX_LENGTH = 500
```

- [ ] **Step 2: Replace hardcoded values**

In `worktree.ts:15`:

```typescript
// Before: .slice(0, 40)
// After:
import { BRANCH_SLUG_MAX_LENGTH } from './types'
// ...
.slice(0, BRANCH_SLUG_MAX_LENGTH)
```

In `run-agent.ts:262`:

```typescript
// Before: .slice(-500)
// After:
import { LAST_OUTPUT_MAX_LENGTH } from './types'
// ...
.slice(-LAST_OUTPUT_MAX_LENGTH)
```

In `completion.ts` (agent summary slice and notes slice):

```typescript
import { AGENT_SUMMARY_MAX_LENGTH, NOTES_MAX_LENGTH } from './types'
// ...
agentSummary
  .slice(0, AGENT_SUMMARY_MAX_LENGTH)
  // ...
  .slice(0, NOTES_MAX_LENGTH)
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/types.ts src/main/agent-manager/worktree.ts src/main/agent-manager/run-agent.ts src/main/agent-manager/completion.ts
git commit -m "chore: extract magic numbers to named constants in types.ts"
```

---

### Task 13: Convert Async Imports to Top-Level in task-handlers.ts

**Files:**

- Modify: `src/main/queue-api/task-handlers.ts`

Note: After Task 8, the `await import('../agent-manager/dependency-index')` and `await import('../data/sprint-queries')` calls in task-handlers.ts may already be removed (replaced by `checkTaskDependencies`). Check first — skip this task if the imports are already gone.

- [ ] **Step 1: Check if async imports still exist**

```bash
grep -n 'await import' src/main/queue-api/task-handlers.ts
```

- [ ] **Step 2: Convert remaining async imports to top-level**

Move any remaining `await import(...)` to static imports at the top of the file.

- [ ] **Step 3: Run tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/queue-api/task-handlers.ts
git commit -m "chore: convert async imports to top-level in task-handlers.ts"
```

---

### Task 14: Push Branch and Create PR

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run --config src/main/vitest.main.config.ts
```

- [ ] **Step 2: Push branch**

```bash
git push origin <branch-name>
```

- [ ] **Step 3: Create PR**

```bash
gh pr create \
  --title "refactor: pipeline tech debt — error handling, dedup, decomposition" \
  --body "$(cat <<'EOF'
## Summary
- **Phase 1 (Reliability):** Standardize sprint-queries error handling (never throw, always log), add logging to worktree silent catches, add executor guard to releaseTask
- **Phase 2 (DRY):** Extract shared auto-block + dependency check helpers, decompose drainLoop and resolveSuccess, remove dead exports
- **Phase 3 (Polish):** Extract magic numbers to constants, convert async imports to top-level

## Test plan
- [ ] `npm run test:main` passes
- [ ] No behavior changes — all existing tests pass as-is or with minor mock updates

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
