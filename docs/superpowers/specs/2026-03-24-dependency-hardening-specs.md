# Dependency System Hardening — Implementation Specs

Six task specs for hardening the BDE dependency/blocking system. Each is self-contained and implementation-ready.

---

## Task 1 (P0): Sanitize depends_on in main process

### Problem

Supabase stores `depends_on` as JSONB. When retrieved, it can arrive as a raw JSON **string** (e.g., `"[{\"id\":\"abc\",\"type\":\"hard\"}]"`) instead of a parsed array. Any code calling `.map()`, `.length`, or iterating with `for...of` on this value will crash with `TypeError: task.depends_on.map is not a function`.

### Root cause

No sanitization layer exists between Supabase responses and consumption sites. The following files iterate `depends_on` unsafely:

- `/Users/ryan/projects/BDE/src/main/agent-manager/resolve-dependents.ts` line 30: `task.depends_on.length` and line 37: `for (const dep of task.depends_on)`
- `/Users/ryan/projects/BDE/src/main/handlers/sprint-local.ts` line 113: `taskDeps.length` and line 120: `idx.areDependenciesSatisfied(id, taskDeps, ...)`
- `/Users/ryan/projects/BDE/src/main/agent-manager/dependency-index.ts` line 21: `for (const dep of deps)` in `addEdges`

### Solution

1. **Create a shared utility** in `src/shared/parse-depends-on.ts`:

```typescript
import type { TaskDependency } from './types'

/**
 * Safely parse depends_on from Supabase JSONB.
 * Handles: null, undefined, valid array, JSON string, garbage.
 */
export function parseDependsOn(raw: unknown): TaskDependency[] | null {
  if (raw == null) return null
  if (Array.isArray(raw)) return raw as TaskDependency[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as TaskDependency[]
    } catch {
      // fall through
    }
  }
  return null
}
```

2. **Apply at the data layer** in `src/main/data/sprint-queries.ts` — add a row-level sanitizer applied after every query:

```typescript
import { parseDependsOn } from '../../shared/parse-depends-on'

function sanitizeTask(row: SprintTask): SprintTask {
  return { ...row, depends_on: parseDependsOn(row.depends_on) }
}
```

Apply `sanitizeTask` to the return values of `getTask()` (line 55), `listTasks()` (line 74), and `createTask()`.

3. **Add defensive guards** at consumption sites as a safety net — in `resolve-dependents.ts` line 30, wrap:

```typescript
const deps = Array.isArray(task.depends_on) ? task.depends_on : []
if (deps.length === 0) continue
```

### Files to modify

- `src/shared/parse-depends-on.ts` — **new file**, ~20 lines
- `src/main/data/sprint-queries.ts` — add import + `sanitizeTask()` wrapper on `getTask`, `listTasks`, `createTask` returns
- `src/main/agent-manager/resolve-dependents.ts` — defensive `Array.isArray` check on line 30
- `src/main/agent-manager/dependency-index.ts` — defensive check in `addEdges` (line 19-20)

### Test requirements

- Unit test `src/shared/__tests__/parse-depends-on.test.ts`: test null, valid array, JSON string, malformed string, number, nested object
- Update existing `resolve-dependents` tests to include a case where `depends_on` is a JSON string

### Edge cases

- `depends_on` could be an empty string `""` — should return `null`
- `depends_on` could be `"null"` (string literal) — `JSON.parse("null")` returns `null`, not an array; handle correctly
- Double-encoded JSON (string of a string) — treat as garbage, return `null`

### Verification

- Write a test that passes `'[{"id":"x","type":"hard"}]'` (string) to `parseDependsOn` and confirms it returns a valid array
- Run `npm test` — all existing tests pass
- Run `npm run typecheck` — no type errors

---

## Task 2 (P0): Add Blocked section to Sprint Center Kanban

### Problem

When a task's status is set to `blocked`, `partitionSprintTasks()` puts it into the `todo` bucket (line 41-42 of `partitionSprintTasks.ts`). The KanbanBoard's "To Do" column renders blocked tasks mixed in with queued tasks, with no visual distinction. Users cannot see which tasks are blocked or why.

### Root cause

`partitionSprintTasks.ts` line 41-42 lumps `blocked` into `todo`:

```typescript
case TASK_STATUS.BLOCKED:
  todo.push(task)
  break
```

The `KanbanBoard` component receives `todoTasks` as a flat array and has no blocked-specific rendering. The `SprintPartition` interface has no `blocked` field.

### Solution

1. **Add `blocked` bucket to `SprintPartition`** in `src/renderer/src/lib/partitionSprintTasks.ts`:

```typescript
export interface SprintPartition {
  backlog: SprintTask[]
  blocked: SprintTask[] // NEW
  todo: SprintTask[]
  inProgress: SprintTask[]
  awaitingReview: SprintTask[]
  done: SprintTask[]
  failed: SprintTask[]
}
```

Update the partition function:

```typescript
case TASK_STATUS.BLOCKED:
  blocked.push(task)  // was: todo.push(task)
  break
```

2. **Add `blockedTasks` prop to `KanbanBoard`** in `src/renderer/src/components/sprint/KanbanBoard.tsx`:

Add to the props type:

```typescript
blockedTasks: SprintTask[]
```

Add a new `KanbanColumn` between "To Do" and "In Progress":

```tsx
<KanbanColumn
  status="blocked"
  label="Blocked"
  tasks={blockedTasks}
  prMergedMap={prMergedMap}
  generatingIds={generatingIds}
  readOnly
  onPushToSprint={onPushToSprint}
  onLaunch={onLaunch}
  onViewSpec={onViewSpec}
  onViewOutput={onViewOutput}
  onMarkDone={onMarkDone}
  onStop={onStop}
/>
```

Mark it `readOnly` so users cannot drag tasks into/out of the blocked column (status is managed by the dependency system).

3. **Pass blocked tasks from SprintCenter** in `SprintCenter.tsx` line ~277:

```tsx
<KanbanBoard
  blockedTasks={partition.blocked}
  todoTasks={partition.todo}
  ...
```

4. **Show blocker info on TaskCard** — when `task.status === 'blocked'` and `task.depends_on` is non-empty, render a small line below the title showing blocked dependency IDs. This can be a simple `<span className="task-card__blocked-info">` with the dep IDs truncated.

### Files to modify

- `src/renderer/src/lib/partitionSprintTasks.ts` — add `blocked` bucket, change BLOCKED case
- `src/renderer/src/components/sprint/KanbanBoard.tsx` — add `blockedTasks` prop, render blocked column
- `src/renderer/src/components/sprint/SprintCenter.tsx` — pass `partition.blocked` to KanbanBoard
- `src/renderer/src/lib/__tests__/partitionSprintTasks.test.ts` — update expected partition shape

### Test requirements

- Update `partitionSprintTasks.test.ts`: blocked tasks land in `blocked` bucket, not `todo`
- Add test: blocked task with `depends_on` is in `blocked`, queued task without deps is in `todo`

### Edge cases

- Task is `blocked` but has empty `depends_on` (manually blocked) — still shows in Blocked column
- Blocked column should not be a drag target — `readOnly` prop handles this
- Column count changes from 3 to 4 — verify CSS grid/flex layout accommodates it

### Verification

- Manually create a task with `status: 'blocked'` — confirm it appears in the Blocked column, not To Do
- Confirm drag-and-drop still works for To Do and In Progress columns
- `npm test` passes with updated partition tests

---

## Task 3 (P1): Validate depends_on at Queue API creation

### Problem

`handleCreateTask` in `src/main/queue-api/task-handlers.ts` (line 58-87) accepts any `depends_on` array without validation. Callers can reference non-existent task IDs or create circular dependency chains. These invalid states cause silent failures when the drain loop tries to resolve dependencies.

### Root cause

`handleCreateTask` passes the body directly to `createTask()` on line 85:

```typescript
const task = await createTask(body as Parameters<typeof createTask>[0])
```

No existence check, no cycle detection. The IPC handler `sprint:validateDependencies` in `sprint-local.ts` (line 186-220) already does this validation, but the Queue API bypasses it entirely.

### Solution

1. **Extract validation into a shared function** in `src/main/agent-manager/validate-dependencies.ts`:

```typescript
import { detectCycle } from './dependency-index'
import type { TaskDependency } from '../../shared/types'
import type { SprintTask } from '../../shared/types'

export interface ValidateDepsResult {
  valid: boolean
  error?: string
  cycle?: string[]
}

export async function validateDependencies(
  taskId: string,
  proposedDeps: TaskDependency[],
  getTask: (id: string) => Promise<Pick<SprintTask, 'id' | 'depends_on'> | null>,
  listTasks: () => Promise<Pick<SprintTask, 'id' | 'depends_on'>[]>
): Promise<ValidateDepsResult> {
  // 1. Check all targets exist
  for (const dep of proposedDeps) {
    const target = await getTask(dep.id)
    if (!target) return { valid: false, error: `Task ${dep.id} not found` }
  }

  // 2. Check for cycles
  const allTasks = await listTasks()
  const depsMap = new Map(allTasks.map((t) => [t.id, t.depends_on]))
  const cycle = detectCycle(taskId, proposedDeps, (id) => depsMap.get(id) ?? null)
  if (cycle) return { valid: false, error: `Circular dependency detected`, cycle }

  return { valid: true }
}
```

2. **Use in `handleCreateTask`** — after body parsing, before `createTask()`:

```typescript
const { depends_on } = body as Record<string, unknown>
if (depends_on && Array.isArray(depends_on) && depends_on.length > 0) {
  // Generate a temporary ID for cycle detection (task doesn't exist yet)
  const tempId = crypto.randomUUID()
  const result = await validateDependencies(tempId, depends_on, getTask, listTasks)
  if (!result.valid) {
    sendJson(res, 400, { error: result.error, cycle: result.cycle })
    return
  }
}
```

3. **Also validate on PATCH** — add the same check to `handleUpdateTask` when `depends_on` is in the patch body.

4. **Refactor `sprint:validateDependencies` IPC handler** in `sprint-local.ts` to use the shared function.

### Files to modify

- `src/main/agent-manager/validate-dependencies.ts` — **new file**, shared validation logic
- `src/main/queue-api/task-handlers.ts` — add validation in `handleCreateTask` and `handleUpdateTask`
- `src/main/handlers/sprint-local.ts` — refactor `sprint:validateDependencies` to use shared function

### Test requirements

- Unit test `validate-dependencies.test.ts`: non-existent ID returns error, cycle returns error with path, valid deps return `{ valid: true }`
- Integration test for Queue API: POST with non-existent dep ID returns 400, POST with cycle returns 400 with cycle path

### Edge cases

- `depends_on` is present but empty array — skip validation, allow creation
- `depends_on` is `null` — skip validation
- Task depends on itself — `detectCycle` already catches this (line 62: `if (dep.id === taskId) return [taskId, taskId]`)
- For new tasks, cycle detection uses a temp ID — ensure the temp ID doesn't collide with existing tasks (UUID collision is astronomically unlikely)

### Verification

- `curl -X POST /queue/tasks` with `depends_on: [{id: "nonexistent", type: "hard"}]` returns 400
- `curl -X POST /queue/tasks` with valid deps succeeds with 201
- `npm run test:main` passes

---

## Task 4 (P1): Record blocked reason in task notes

### Problem

When the dependency system auto-blocks a task (in `sprint-local.ts` line 126: `patch = { ...patch, status: 'blocked' }`), no explanation is recorded. The user sees a task in `blocked` status with no indication of which dependencies are unsatisfied. The `notes` field remains unchanged.

### Root cause

The blocking logic in `sprint-local.ts` line 125-127 only overrides the status:

```typescript
if (!satisfied) {
  patch = { ...patch, status: 'blocked' }
}
```

No note is written. Similarly, when `resolveDependents` in `resolve-dependents.ts` unblocks a task (line 51), it only sets `status: 'queued'` — it doesn't clear any blocking note.

### Solution

1. **Record blocker info when blocking** in `sprint-local.ts`. The `areDependenciesSatisfied` call already returns `blockedBy` (line 120-123). Use it:

```typescript
const { satisfied, blockedBy } = idx.areDependenciesSatisfied(id, taskDeps, (depId) =>
  statusMap.get(depId)
)
if (!satisfied) {
  const blockerNote = `[auto-blocked] Waiting on: ${blockedBy.join(', ')}`
  patch = { ...patch, status: 'blocked', notes: blockerNote }
}
```

2. **Clear blocking note when unblocking** in `resolve-dependents.ts` line 51:

```typescript
if (satisfied) {
  await updateTask(depId, { status: 'queued', notes: null })
}
```

Note: setting `notes: null` clears the auto-blocked note. If the task had user-written notes before being blocked, those would be lost. To preserve them, prefix auto-block notes with `[auto-blocked]` and only clear notes that start with that prefix:

```typescript
if (satisfied) {
  const existingNotes = task.notes ?? '' // need to fetch notes in getTask
  const clearedNotes = existingNotes.startsWith('[auto-blocked]') ? null : existingNotes
  await updateTask(depId, { status: 'queued', notes: clearedNotes })
}
```

This requires the `getTask` signature in `resolveDependents` to also return `notes`. Update the type on line 17-19:

```typescript
getTask: (id: string) => Promise<(Pick<SprintTask, 'id' | 'status' | 'notes'> & {
  depends_on: TaskDependency[] | null
}) | null>,
```

3. **Also record blocker in drain loop blocking** — check if the drain loop in `agent-manager/index.ts` also blocks tasks, and apply the same note pattern there.

### Files to modify

- `src/main/handlers/sprint-local.ts` — add `notes: blockerNote` to blocked patch (around line 126)
- `src/main/agent-manager/resolve-dependents.ts` — clear auto-block notes on unblock, update `getTask` type to include `notes`
- `src/main/agent-manager/index.ts` — update `getTask` call if needed to include `notes` field

### Test requirements

- Test in `sprint-local` handler tests: when task is blocked, notes contain the blocker IDs
- Test in `resolve-dependents` tests: after unblocking, auto-blocked notes are cleared; user notes are preserved

### Edge cases

- Task has user-written notes AND gets auto-blocked — prepend `[auto-blocked]` line, preserve original notes on a new line
- Multiple blockers — list all IDs in the note
- Blocker IDs are UUIDs — long notes are acceptable, no truncation needed
- `notes` field size limit in Supabase — text type, no practical limit

### Verification

- Create task A (queued) and task B (depends on A, hard). B should have notes: `[auto-blocked] Waiting on: <A's ID>`
- Complete task A. B transitions to queued, notes are cleared
- `npm test` passes

---

## Task 5 (P2): Idempotent PR creation in completion handler

### Problem

`resolveSuccess()` in `src/main/agent-manager/completion.ts` (line 30-98) always runs `gh pr create` without checking if a PR already exists for the branch. If the agent process exits and the task is retried (or the completion handler runs twice due to race conditions), a duplicate PR is created or `gh pr create` fails with "a pull request already exists".

### Root cause

`resolveSuccess` at line 74-86 calls `gh pr create` unconditionally:

```typescript
const { stdout: prOut } = await execFile(
  'gh',
  [
    'pr',
    'create',
    '--title',
    title,
    '--body',
    'Automated by BDE',
    '--head',
    branch,
    '--repo',
    ghRepo
  ],
  { cwd: worktreePath, env: buildAgentEnv() }
)
```

No check for an existing PR on the branch. The `catch` on line 83 silently swallows the error, leaving the task without PR info even though a PR exists.

### Solution

1. **Check for existing PR before creating** — add a lookup step between push (line 62-69) and create (line 74):

```typescript
// 2.5. Check if PR already exists for this branch
let existingPrUrl: string | null = null
let existingPrNumber: number | null = null
try {
  const { stdout: viewOut } = await execFile(
    'gh',
    ['pr', 'view', branch, '--repo', ghRepo, '--json', 'url,number'],
    { cwd: worktreePath, env: buildAgentEnv() }
  )
  const parsed = JSON.parse(viewOut.trim())
  if (parsed.url && parsed.number) {
    existingPrUrl = parsed.url
    existingPrNumber = parsed.number
    logger.info(`[completion] PR already exists for branch ${branch}: ${existingPrUrl}`)
  }
} catch {
  // No existing PR — proceed to create
}

if (existingPrUrl && existingPrNumber) {
  // PR already exists — just update the task record
  await updateTask(taskId, {
    pr_status: 'open',
    pr_url: existingPrUrl,
    pr_number: existingPrNumber
  })
  return
}
```

2. **Update the task status in the catch block** — if `gh pr create` fails with "already exists", parse the error for the PR URL:

```typescript
} catch (err) {
  const errStr = String(err)
  // gh prints the existing PR URL in the error message
  const existingMatch = errStr.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/)
  if (existingMatch) {
    prUrl = existingMatch[0]
    prNumber = parseInt(existingMatch[1], 10)
    logger.info(`[completion] Used existing PR for task ${taskId}: ${prUrl}`)
  } else {
    logger.warn(`[completion] gh pr create failed for task ${taskId}: ${err}`)
  }
}
```

### Files to modify

- `src/main/agent-manager/completion.ts` — add `gh pr view` check before `gh pr create` (between lines 69 and 71)

### Test requirements

- Unit test: mock `execFile` to simulate `gh pr view` returning existing PR — verify `gh pr create` is NOT called
- Unit test: mock `gh pr view` throwing (no PR) — verify `gh pr create` IS called
- Unit test: mock `gh pr create` throwing with "already exists" message containing URL — verify PR info is extracted

### Edge cases

- Branch has PR in a different repo (fork) — `--repo ghRepo` scopes the lookup correctly
- PR was closed (not merged) — `gh pr view` still returns it; this is acceptable since the branch was just pushed with new commits
- Rate limiting on `gh` CLI — the additional API call is one extra per completion, negligible impact
- `gh pr view` output format changes — use `--json` flag for stable output

### Verification

- Run an agent task to completion, let it create a PR. Re-run the same task (or manually call `resolveSuccess` with the same branch). Verify no duplicate PR is created.
- Check task record has correct `pr_url` and `pr_number` in both first-run and re-run cases
- `npm run test:main` passes

---

## Task 6 (P2): resolveDependents after fast-fail exhaustion

### Problem

When a task's `fast_fail_count` reaches 3 (exhausted), `run-agent.ts` line 184-187 sets the task to `error` and calls `onTaskTerminal`:

```typescript
if (ffResult === 'fast-fail-exhausted') {
  await updateTask(task.id, { status: 'error', completed_at: now, notes: 'Fast-fail exhausted' })
    .catch(...)
  await onTaskTerminal(task.id, 'error')
}
```

This path correctly calls `onTaskTerminal(task.id, 'error')`. However, verify that:

1. The `error` status is properly handled by `areDependenciesSatisfied` — it should unblock `soft` deps (since `error` is in `TERMINAL_STATUSES`) but keep `hard` deps blocked (since `error` is NOT in `HARD_SATISFIED_STATUSES`).
2. The `.catch()` on the `updateTask` call (line 185-186) does not prevent `onTaskTerminal` from running. Currently these are sequential `await` calls, so if `updateTask` throws and is caught, execution continues to `onTaskTerminal`. But the `.catch()` on `updateTask` swallows the error — `onTaskTerminal` is called regardless. This is correct.

The real risk is in `resolveFailure` (completion.ts line 101-120). When `retryCount >= MAX_RETRIES`, the task is set to `failed`:

```typescript
await updateTask(taskId, {
  status: 'failed',
  completed_at: new Date().toISOString()
})
```

But **no `onTaskTerminal` is called from `resolveFailure`**. The caller in `run-agent.ts` line 207-210 does call it:

```typescript
await resolveFailure({ taskId: task.id, retryCount: task.retry_count ?? 0 }, logger)
if ((task.retry_count ?? 0) >= MAX_RETRIES) {
  await onTaskTerminal(task.id, 'failed')
}
```

However, this uses the **stale** `task.retry_count` from the task object at spawn time, while `resolveFailure` uses `retryCount` (same value). If `retry_count` was updated externally between spawn and completion, the condition could be wrong. This is an unlikely but real race.

### Root cause

The `onTaskTerminal` guard in `run-agent.ts` line 208 duplicates the retry exhaustion check from `resolveFailure` but uses a potentially stale value:

```typescript
if ((task.retry_count ?? 0) >= MAX_RETRIES) {
  await onTaskTerminal(task.id, 'failed')
}
```

### Solution

1. **Make `resolveFailure` return whether the task reached terminal status** so the caller doesn't need to re-check:

```typescript
export async function resolveFailure(opts: ResolveFailureOpts, logger?: Logger): Promise<boolean> {
  const { taskId, retryCount } = opts
  try {
    if (retryCount < MAX_RETRIES) {
      await updateTask(taskId, {
        status: 'queued',
        retry_count: retryCount + 1,
        claimed_by: null
      })
      return false // not terminal
    } else {
      await updateTask(taskId, {
        status: 'failed',
        completed_at: new Date().toISOString()
      })
      return true // terminal
    }
  } catch (err) {
    logger?.error(`[completion] Failed to update task ${taskId} during failure resolution: ${err}`)
    return false
  }
}
```

2. **Update caller in `run-agent.ts`** (line 206-210):

```typescript
const isTerminal = await resolveFailure(
  { taskId: task.id, retryCount: task.retry_count ?? 0 },
  logger
)
if (isTerminal) {
  await onTaskTerminal(task.id, 'failed')
}
```

This eliminates the duplicated check and ensures `onTaskTerminal` is called exactly when `resolveFailure` actually transitions to `failed`.

3. **Add test coverage** to confirm `onTaskTerminal` fires for all terminal paths:
   - fast-fail-exhausted (line 184-187) — already calls `onTaskTerminal`
   - resolveSuccess error with task set to `error` (line 44, 52) — does NOT call `onTaskTerminal`. **Fix**: add `await onTaskTerminal(task.id, 'error')` after the early returns in resolveSuccess that set status to `error`.

The lines in `completion.ts` that set `error` without triggering `onTaskTerminal`:

- Line 44: `await updateTask(taskId, { status: 'error', ... })` then `return` — dependents never notified
- Line 52: same pattern

**Fix in `run-agent.ts`** — the `resolveSuccess` call is wrapped in a try/catch (line 196-211). When `resolveSuccess` throws, `resolveFailure` is called. But when `resolveSuccess` sets `error` and returns normally (no throw), the caller doesn't know the task is terminal. Fix by having `resolveSuccess` return a result indicating terminal status, or by calling `onTaskTerminal` inside `resolveSuccess` (requires passing it as a dependency).

Simpler approach: **pass `onTaskTerminal` to `resolveSuccess`**:

```typescript
// In resolveSuccess, after setting status to 'error':
await onTaskTerminal(taskId, 'error')
return
```

Update `ResolveSuccessOpts`:

```typescript
export interface ResolveSuccessOpts {
  taskId: string
  worktreePath: string
  title: string
  ghRepo: string
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
}
```

### Files to modify

- `src/main/agent-manager/completion.ts` — change `resolveFailure` return type to `boolean`, add `onTaskTerminal` to `ResolveSuccessOpts`, call it on error early-returns
- `src/main/agent-manager/run-agent.ts` — use `resolveFailure` return value, pass `onTaskTerminal` to `resolveSuccess`

### Test requirements

- Test: task with `retry_count === MAX_RETRIES - 1` fails -> `resolveFailure` returns `true`, `onTaskTerminal` called with `'failed'`
- Test: task with `retry_count === 0` fails -> `resolveFailure` returns `false`, `onTaskTerminal` NOT called
- Test: `resolveSuccess` branch detection fails -> `onTaskTerminal` called with `'error'`
- Test: fast-fail exhausted -> `onTaskTerminal` called with `'error'` (existing behavior, add explicit test)

### Edge cases

- `resolveFailure` throws during `updateTask` — returns `false`, `onTaskTerminal` is not called; the task is stuck. This is acceptable because the DB write failed, so the status didn't actually change.
- `onTaskTerminal` itself throws — already wrapped in try/catch in `agent-manager/index.ts` line 117-123
- Multiple concurrent completions for the same task (race) — `activeAgents.delete` on line 165 prevents double-processing

### Verification

- Create task A (queued). Create task B (depends on A, soft dep). Force A to fast-fail 3 times. Verify B transitions from `blocked` to `queued`.
- Create the same scenario but with A failing via `resolveFailure` after MAX_RETRIES. Verify B unblocks.
- `npm run test:main` passes

---

## Task 7 (P0): Spec Quality Guardrails on All Task Creation and Queuing Paths

### Problem

BDE has three tiers of spec quality checks (structural, semantic, operational) built into the Task Workbench UI, but none of these guardrails are enforced at the data layer. This means:

1. **Queue API** (`POST /queue/tasks`) accepts tasks with empty specs, no markdown structure, and no title — the only validation is `title` and `repo` being non-empty strings. Automated callers (claude-task-runner, MCP tools, curl) can create low-quality tasks that waste agent compute.
2. **Sprint Center** ticket creation (`sprint:create` IPC) performs zero validation — any payload is passed directly to `_createTask()`.
3. **Status transitions to `queued`** happen in three places (`sprint:update` IPC, Queue API `PATCH /queue/tasks/:id/status`, and `handlePushToSprint` in the renderer) with no semantic quality gate. A task with a vague one-line spec can be queued and picked up by an agent immediately.

The structural checks exist in `useReadinessChecks.ts` as pure functions, and the semantic checks exist in `workbench.ts` as a `workbench:checkSpec` IPC handler, but both are UI-only — they inform the user but never block creation or queuing.

### Design

**Tier 1 (structural) — enforce at creation time, everywhere:**

- Title present and non-empty
- Repo present and non-empty
- Spec present and >= 50 characters
- Spec has >= 2 markdown sections (`## ` headings)

These are pure, synchronous checks. They run on every task creation path and reject with descriptive errors if any check fails.

**Tier 2 (semantic) — enforce at queue time (status transition to `queued`):**

- When any path sets `status='queued'`, run the existing AI-powered spec checks (clarity, scope, files_exist) via `claude -p`
- If any semantic check returns `'fail'`, reject the queue transition
- If semantic checks return `'warn'`, allow but include warnings in the response
- Queue API gets a `?skipValidation=true` escape hatch for automated systems

**Tier 3 (operational) — UI-only, no changes:**

- Auth, repo path, git clean, conflict, slots — these remain advisory in the Task Workbench

### Files to create

#### 1. `src/shared/spec-validation.ts` — Structural validation (pure functions)

```typescript
/**
 * Tier 1 structural validation for task specs.
 * Pure functions — no IPC, no side effects. Shared by renderer and main process.
 */

export interface StructuralCheckResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export const MIN_SPEC_LENGTH = 50
export const MIN_HEADING_COUNT = 2

export function validateStructural(input: {
  title?: string | null
  repo?: string | null
  spec?: string | null
  status?: string | null // if 'backlog', relax spec requirements
}): StructuralCheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Title present — always enforced
  if (!input.title || !input.title.trim()) {
    errors.push('title is required')
  }

  // Repo present — always enforced
  if (!input.repo || !input.repo.trim()) {
    errors.push('repo is required')
  }

  // Spec checks — only enforced when status !== 'backlog'
  if (input.status !== 'backlog') {
    const specLen = (input.spec ?? '').trim().length
    if (specLen === 0) {
      errors.push('spec is required')
    } else if (specLen < MIN_SPEC_LENGTH) {
      errors.push(
        `spec is too short (${specLen} chars, minimum ${MIN_SPEC_LENGTH}). Add problem context, solution approach, and files to modify.`
      )
    }

    if (specLen > 0) {
      const headingCount = ((input.spec ?? '').match(/^## /gm) ?? []).length
      if (headingCount < MIN_HEADING_COUNT) {
        errors.push(
          `spec needs at least ${MIN_HEADING_COUNT} markdown sections (## headings). Use ## Problem, ## Solution, ## Files structure.`
        )
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
```

Export constants `MIN_SPEC_LENGTH` and `MIN_HEADING_COUNT` so tests and the renderer's `useReadinessChecks` can share them rather than hardcoding `50` and `2`.

#### 2. `src/main/spec-semantic-check.ts` — Semantic validation (wraps Claude CLI)

```typescript
/**
 * Tier 2 semantic spec validation — AI-powered quality check.
 * Extracts the core logic from workbench.ts checkSpec handler
 * so it can be called from sprint-local.ts and queue-api handlers.
 */
import { spawn } from 'child_process'
import { buildAgentEnv } from './env-utils'

export interface SemanticCheckResult {
  clarity: { status: 'pass' | 'warn' | 'fail'; message: string }
  scope: { status: 'pass' | 'warn' | 'fail'; message: string }
  filesExist: { status: 'pass' | 'warn' | 'fail'; message: string }
}

export interface SemanticCheckSummary {
  passed: boolean
  hasFails: boolean
  hasWarns: boolean
  results: SemanticCheckResult
  failMessages: string[]
  warnMessages: string[]
}

function runClaudePrint(prompt: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'text'], {
      env: buildAgentEnv(),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Claude CLI timed out'))
    }, timeoutMs)

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `claude exited with code ${code}`))
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

export async function checkSpecSemantic(input: {
  title: string
  repo: string
  spec: string
}): Promise<SemanticCheckSummary> {
  const prompt = `You are reviewing a coding agent spec for quality. Return ONLY valid JSON (no markdown fencing).

Title: "${input.title}"
Repo: ${input.repo}
Spec:
${input.spec}

Assess the spec on three dimensions. For each, return status ("pass", "warn", or "fail") and a brief message.

1. clarity: Is the spec clear and actionable? Can an AI agent execute it without ambiguity?
2. scope: Is this achievable by one agent in one session? Or too broad?
3. filesExist: Are file paths specific and plausible? (You cannot verify they exist, so check if they look like real paths.)

Return JSON: {"clarity":{"status":"...","message":"..."},"scope":{"status":"...","message":"..."},"filesExist":{"status":"...","message":"..."}}`

  let results: SemanticCheckResult
  try {
    const raw = await runClaudePrint(prompt)
    const parsed = JSON.parse(raw)
    results = {
      clarity: parsed.clarity ?? { status: 'warn', message: 'Unable to assess' },
      scope: parsed.scope ?? { status: 'warn', message: 'Unable to assess' },
      filesExist: parsed.filesExist ?? { status: 'warn', message: 'Unable to assess' }
    }
  } catch {
    // If Claude CLI is unavailable, degrade to pass-through (don't block queuing)
    return {
      passed: true,
      hasFails: false,
      hasWarns: true,
      results: {
        clarity: { status: 'warn', message: 'AI check unavailable — skipped' },
        scope: { status: 'warn', message: 'AI check unavailable — skipped' },
        filesExist: { status: 'warn', message: 'AI check unavailable — skipped' }
      },
      failMessages: [],
      warnMessages: ['Semantic checks skipped — Claude CLI unavailable']
    }
  }

  const failMessages: string[] = []
  const warnMessages: string[] = []
  for (const [key, check] of Object.entries(results)) {
    if (check.status === 'fail') failMessages.push(`${key}: ${check.message}`)
    if (check.status === 'warn') warnMessages.push(`${key}: ${check.message}`)
  }

  return {
    passed: failMessages.length === 0,
    hasFails: failMessages.length > 0,
    hasWarns: warnMessages.length > 0,
    results,
    failMessages,
    warnMessages
  }
}
```

### Files to modify

#### 3. `src/main/queue-api/task-handlers.ts` — Add structural validation at creation, semantic validation at queue transitions

**In `handleCreateTask` (line 58-87):**

After the existing `title`/`repo` checks (line 75-83), add structural validation:

```typescript
import { validateStructural } from '../../shared/spec-validation'
import { checkSpecSemantic } from '../spec-semantic-check'

// ... inside handleCreateTask, after existing title/repo checks:

const { spec } = body as Record<string, unknown>
const structural = validateStructural({
  title: title as string,
  repo: repo as string,
  spec: typeof spec === 'string' ? spec : null
})
if (!structural.valid) {
  sendJson(res, 400, { error: 'Spec quality checks failed', details: structural.errors })
  return
}

// If creating with status=queued, also run semantic checks
const bodyObj = body as Record<string, unknown>
if (bodyObj.status === 'queued' && typeof spec === 'string') {
  const url = new URL(req.url ?? '', 'http://localhost')
  const skipValidation = url.searchParams.get('skipValidation') === 'true'
  if (!skipValidation) {
    const semantic = await checkSpecSemantic({
      title: title as string,
      repo: repo as string,
      spec: spec as string
    })
    if (!semantic.passed) {
      sendJson(res, 400, {
        error: 'Cannot create task with queued status — semantic checks failed',
        details: semantic.failMessages
      })
      return
    }
  }
}
```

**In `handleUpdateStatus` (line 136-185):**

After filtering to allowed fields (line 167), add semantic check when transitioning to `queued`:

```typescript
// If transitioning to queued, run semantic checks (unless skipValidation=true)
if (patch.status === 'queued') {
  const url = new URL(req.url ?? '', 'http://localhost')
  const skipValidation = url.searchParams.get('skipValidation') === 'true'

  if (!skipValidation) {
    // Fetch the task to get its spec
    const task = await getTask(id)
    if (!task) {
      sendJson(res, 404, { error: `Task ${id} not found` })
      return
    }

    // Run structural checks first (fast, synchronous)
    const structural = validateStructural({
      title: task.title,
      repo: task.repo,
      spec: task.spec
    })
    if (!structural.valid) {
      sendJson(res, 400, {
        error: 'Cannot queue task — spec quality checks failed',
        details: structural.errors
      })
      return
    }

    // Run semantic checks (async, calls Claude CLI)
    if (task.spec) {
      const semantic = await checkSpecSemantic({
        title: task.title,
        repo: task.repo,
        spec: task.spec
      })
      if (!semantic.passed) {
        sendJson(res, 400, {
          error: 'Cannot queue task — semantic spec checks failed',
          details: semantic.failMessages
        })
        return
      }
    }
  }
}
```

Note: `handleUpdateStatus` already has access to `req.url` via its `req: http.IncomingMessage` parameter, so `?skipValidation=true` can be parsed directly inside the handler.

#### 4. `src/main/handlers/sprint-local.ts` — Add validation to `sprint:create` and `sprint:update`

**In `sprint:create` handler (line 101-105):**

```typescript
import { validateStructural } from '../../shared/spec-validation'

safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
  // Structural validation — relaxed for backlog (only title + repo required)
  const structural = validateStructural({
    title: task.title,
    repo: task.repo,
    spec: task.spec ?? null,
    status: task.status ?? 'backlog'
  })
  if (!structural.valid) {
    throw new Error(`Spec quality checks failed: ${structural.errors.join('; ')}`)
  }
  const row = await _createTask(task)
  notifySprintMutation('created', row)
  return row
})
```

**In `sprint:update` handler (line 107-132):**

Refactor to hoist the `_getTask` call and add semantic validation. The existing dependency check block (line 109-129) already fetches the task — share that fetch:

```typescript
safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
  const task = patch.status === 'queued' ? await _getTask(id) : null

  // If transitioning to queued, run quality checks
  if (patch.status === 'queued' && task) {
    // Structural check
    const structural = validateStructural({
      title: task.title,
      repo: task.repo,
      spec: (patch.spec as string) ?? task.spec ?? null
    })
    if (!structural.valid) {
      throw new Error(
        `Cannot queue task — spec quality checks failed: ${structural.errors.join('; ')}`
      )
    }

    // Semantic check
    const specText = (patch.spec as string) ?? task.spec
    if (specText) {
      const { checkSpecSemantic } = await import('../spec-semantic-check')
      const semantic = await checkSpecSemantic({
        title: task.title,
        repo: task.repo,
        spec: specText
      })
      if (!semantic.passed) {
        throw new Error(
          `Cannot queue task — semantic checks failed: ${semantic.failMessages.join('; ')}`
        )
      }
    }

    // Dependency check (existing logic)
    const taskDeps = task.depends_on
    if (taskDeps && taskDeps.length > 0) {
      const { createDependencyIndex } = await import('../agent-manager/dependency-index')
      const idx = createDependencyIndex()
      const allTasks = await _listTasks()
      const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))
      const { satisfied } = idx.areDependenciesSatisfied(id, taskDeps, (depId) =>
        statusMap.get(depId)
      )
      if (!satisfied) {
        patch = { ...patch, status: 'blocked' }
      }
    }
  }

  return updateTask(id, patch)
})
```

#### 5. `src/renderer/src/hooks/useReadinessChecks.ts` — Use shared constants

Replace hardcoded values with imports from the shared module:

```typescript
import { MIN_SPEC_LENGTH, MIN_HEADING_COUNT } from '../../../shared/spec-validation'
```

Update the `computeStructuralChecks` function to use `MIN_SPEC_LENGTH` instead of `50` (line 41) and `MIN_HEADING_COUNT` instead of `2` (line 53). The behavior stays identical — this just eliminates the dual-maintenance risk.

#### 6. `src/main/handlers/workbench.ts` — Refactor `workbench:checkSpec` to use shared function

Replace the inline prompt + parsing logic (lines 274-305) with a call to `checkSpecSemantic`:

```typescript
import { checkSpecSemantic } from '../spec-semantic-check'

safeHandle(
  'workbench:checkSpec',
  async (_e, input: { title: string; repo: string; spec: string }) => {
    const summary = await checkSpecSemantic(input)
    return summary.results // Returns { clarity, scope, filesExist } — same shape as before
  }
)
```

This removes the duplicated prompt string and parsing logic. The `runClaudePrint` function in `workbench.ts` is still used by `workbench:chat` and `workbench:generateSpec`, so it stays.

### Wiring summary

| Path                                                    | Tier 1 (structural)                                                                     | Tier 2 (semantic)                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Queue API `POST /queue/tasks`                           | Validate in `handleCreateTask`                                                          | Only if `status: 'queued'` in body                       |
| Queue API `PATCH /queue/tasks/:id/status` (to `queued`) | Validate before queue                                                                   | Validate before queue (skip with `?skipValidation=true`) |
| `sprint:create` IPC                                     | Validate in handler (relaxed for backlog)                                               | N/A (creation into backlog)                              |
| `sprint:update` IPC (to `queued`)                       | Validate before queue                                                                   | Validate before queue                                    |
| `handlePushToSprint` (renderer)                         | Calls `sprint:update` with `status: 'queued'` — covered                                 | Covered by `sprint:update` handler                       |
| Task Workbench "Create & Queue"                         | Creates via `sprint:create` (title+repo), then updates via `sprint:update` (full check) | Covered by `sprint:update` handler                       |

### Test requirements

#### Unit tests for `src/shared/__tests__/spec-validation.test.ts`:

- `validateStructural` with empty title returns error containing `'title is required'`
- `validateStructural` with empty repo returns error containing `'repo is required'`
- `validateStructural` with null spec (no `status: 'backlog'`) returns error containing `'spec is required'`
- `validateStructural` with 30-char spec returns error about minimum length
- `validateStructural` with 100-char spec but no `##` headings returns error about sections
- `validateStructural` with 100-char spec and 1 heading returns error (need >= 2)
- `validateStructural` with 100-char spec and 2+ headings returns `{ valid: true, errors: [], warnings: [] }`
- `validateStructural` with `status: 'backlog'` and no spec returns `{ valid: true }` (relaxed mode)
- `validateStructural` with `status: 'backlog'` but no title still returns error (title always required)
- All error messages are descriptive (not just "invalid")

#### Unit tests for `src/main/__tests__/spec-semantic-check.test.ts`:

- Mock `spawn` to return valid JSON with all `pass` — verify `passed: true`, empty `failMessages`
- Mock `spawn` to return JSON with a `fail` status — verify `passed: false` and `failMessages` populated
- Mock `spawn` to return JSON with only `warn` statuses — verify `passed: true` and `warnMessages` populated
- Mock `spawn` to throw (CLI unavailable) — verify graceful degradation: `passed: true`, warnings present
- Mock `spawn` to return invalid JSON — verify graceful degradation, not a hard crash

#### Integration tests for Queue API (`src/main/queue-api/__tests__/queue-api.test.ts`):

- `POST /queue/tasks` with no spec returns 400 with `spec is required` in details
- `POST /queue/tasks` with 20-char spec returns 400 with minimum length error in details
- `POST /queue/tasks` with valid spec (50+ chars, 2+ headings) returns 201
- `PATCH /queue/tasks/:id/status` with `{ status: 'queued' }` on task with bad spec returns 400
- `PATCH /queue/tasks/:id/status?skipValidation=true` with `{ status: 'queued' }` on task with bad spec returns 200
- `PATCH /queue/tasks/:id/status` with `{ status: 'active' }` does NOT trigger semantic checks (only `queued` triggers)

#### Handler tests for sprint-local (`src/main/handlers/__tests__/sprint-local.test.ts`):

- `sprint:create` with empty spec and no `status` field succeeds (backlog relaxed mode)
- `sprint:create` with title and repo succeeds (backlog)
- `sprint:update` transitioning to `queued` on task with bad spec throws error
- `sprint:update` transitioning to `queued` on task with valid spec (and mocked semantic pass) succeeds
- `sprint:update` transitioning to `done` does NOT trigger any validation

### Edge cases

1. **Task created without spec, spec added later via PATCH, then queued.** The structural check at creation time is relaxed for `backlog` status — only title + repo required. Full spec validation kicks in when transitioning to `queued`. This supports the common workflow of creating a backlog item and fleshing it out later.

2. **Claude CLI unavailable during semantic check.** The `checkSpecSemantic` function degrades gracefully — returns `passed: true` with a warning. Queuing is not blocked by CLI downtime. The warning is surfaced in the API response or IPC error message.

3. **Semantic checks add latency to queue transitions.** `claude -p` takes 5-30 seconds. For the Queue API, the caller waits for the response. For the renderer (`handlePushToSprint`), the `sprint:update` IPC call blocks the UI briefly. The renderer already shows loading states during IPC calls. If latency becomes a problem, semantic checks could be made async (queue first, check later, revert if fail) — but that is out of scope.

4. **Spec has `##` headings inside fenced code blocks.** The regex `/^## /gm` counts headings inside code blocks. This is a known heuristic limitation. The semantic (AI) check covers this gap by assessing actual spec structure.

5. **`skipValidation=true` abuse.** The escape hatch is intentional for automated systems (claude-task-runner, MCP tools) that validate specs in their own pipeline. It is not exposed in any UI. It is only available on the Queue API, not on IPC handlers.

6. **Race condition: task spec modified between fetch and queue.** If the spec is updated via a concurrent PATCH while `handleUpdateStatus` is running semantic checks, the check runs against a stale spec. This is a TOCTOU race but is low-risk — the concurrent update would need to degrade the spec between the fetch and the status write.

7. **Queue API `POST /queue/tasks` with `status: 'queued'` in body.** The structural check always runs. If `status` is `queued` in the POST body, semantic checks also run (unless `?skipValidation=true`). This prevents creating-and-queuing a task with a bad spec in a single API call.

8. **Existing tasks with bad specs already in `queued` status.** This change is forward-looking — it does not retroactively validate existing tasks. Tasks already queued continue to run. Only new queue transitions are gated.

### Verification

1. `npm run typecheck` passes with new files
2. `npm test` passes — new tests + existing tests unaffected
3. `npm run test:main` passes
4. Manual test: `curl -X POST http://localhost:18790/queue/tasks -H "Authorization: Bearer $TOKEN" -d '{"title":"test","repo":"bde"}'` returns 400 with `spec is required` in `details`
5. Manual test: `curl -X POST` with valid spec (50+ chars, 2+ `##` headings) returns 201
6. Manual test: Push a backlog task to sprint in the UI with a one-line spec — see error toast from `sprint:update` rejection
7. Manual test: Task Workbench "Create & Queue" with a well-structured spec succeeds
8. Manual test: `curl -X PATCH .../status?skipValidation=true` with `{"status":"queued"}` bypasses checks
