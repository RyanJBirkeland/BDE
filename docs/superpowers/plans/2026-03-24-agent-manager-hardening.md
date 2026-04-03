# Agent Manager Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 infrastructure bugs in the BDE agent manager that cause silent task failures, stale state, and wasted compute.

**Architecture:** All changes are in the main process agent manager subsystem (`src/main/agent-manager/`), the data layer (`src/main/data/`), and env utilities (`src/main/env-utils.ts`). Changes are isolated — each task can be merged independently without breaking the others.

**Tech Stack:** TypeScript, Node.js, Electron main process, Supabase, better-sqlite3

---

## File Map

| File                                                  | Responsibility                         | Tasks   |
| ----------------------------------------------------- | -------------------------------------- | ------- |
| `src/main/env-utils.ts`                               | OAuth token cache                      | 1       |
| `src/main/agent-manager/index.ts`                     | Drain loop, orchestration, error paths | 2, 3, 4 |
| `src/main/agent-manager/completion.ts`                | Post-agent success/failure resolution  | 5       |
| `src/main/agent-manager/worktree.ts`                  | Branch naming, worktree lifecycle      | 6       |
| `src/main/agent-manager/run-agent.ts`                 | Agent record creation, execution       | 7       |
| `src/main/agent-manager/types.ts`                     | Shared constants                       | 1       |
| `src/main/__tests__/env-utils.test.ts`                | Tests for token cache                  | 1       |
| `src/main/agent-manager/__tests__/index.test.ts`      | Tests for drain loop                   | 2, 3, 4 |
| `src/main/agent-manager/__tests__/completion.test.ts` | Tests for completion handler           | 5       |
| `src/main/agent-manager/__tests__/worktree.test.ts`   | Tests for worktree cleanup             | 6       |

---

### Task 1: Invalidate OAuth token cache on auth failure

**Problem:** `getOAuthToken()` in `env-utils.ts` caches the token for 30 minutes. If the token expires or is refreshed on disk, agents silently fail with "Invalid API key" in a fast-fail loop until the cache TTL expires.

**Files:**

- Modify: `src/main/env-utils.ts:24-44`
- Modify: `src/main/agent-manager/run-agent.ts:147-149`
- Modify: `src/main/agent-manager/types.ts` (add constant)
- Test: `src/main/__tests__/env-utils.test.ts` (create or modify)

- [ ] **Step 1: Write failing test for cache invalidation**

Create or update `src/main/__tests__/env-utils.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must mock before import
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return { ...actual, readFileSync: vi.fn(), existsSync: vi.fn() }
})

import { getOAuthToken, invalidateOAuthToken } from '../env-utils'
import { readFileSync, existsSync } from 'node:fs'

describe('OAuth token cache', () => {
  beforeEach(() => {
    invalidateOAuthToken() // clear cache between tests
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('invalidateOAuthToken forces next call to re-read from disk', () => {
    vi.mocked(readFileSync).mockReturnValue('token-v1')
    const t1 = getOAuthToken()
    expect(t1).toBe('token-v1')

    // Token file changed on disk
    vi.mocked(readFileSync).mockReturnValue('token-v2')

    // Without invalidation, cache returns stale value
    expect(getOAuthToken()).toBe('token-v1')

    // After invalidation, re-reads from disk
    invalidateOAuthToken()
    expect(getOAuthToken()).toBe('token-v2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.node.config.ts src/main/__tests__/env-utils.test.ts`
Expected: FAIL — `invalidateOAuthToken` is not exported

- [ ] **Step 3: Add `invalidateOAuthToken()` export to env-utils.ts**

Note: `_resetEnvCache()` already exists in env-utils.ts for test cleanup. We're adding a semantically named alias for production use — auth failure recovery is a distinct concern from test teardown.

In `src/main/env-utils.ts`, after the `getOAuthToken()` function (after line 44), add:

```typescript
/** Force next getOAuthToken() call to re-read from disk. */
export function invalidateOAuthToken(): void {
  _tokenLoadedAt = 0
  _cachedOAuthToken = null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.node.config.ts src/main/__tests__/env-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Wire invalidation into auth failure detection**

In `src/main/agent-manager/run-agent.ts`, in the message consumption catch block (around line 147-149), add auth failure detection:

```typescript
} catch (err) {
  logger.error(`[agent-manager] Error consuming messages for task ${task.id}: ${err}`)
  // Invalidate cached OAuth token on auth errors so next agent gets a fresh token
  const errMsg = err instanceof Error ? err.message : String(err)
  if (errMsg.includes('Invalid API key') || errMsg.includes('invalid_api_key') || errMsg.includes('authentication')) {
    const { invalidateOAuthToken } = await import('../env-utils')
    invalidateOAuthToken()
    logger.warn(`[agent-manager] Auth failure detected — OAuth token cache invalidated`)
  }
}
```

- [ ] **Step 6: Run full test suites**

Run: `npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/env-utils.ts src/main/agent-manager/run-agent.ts src/main/__tests__/env-utils.test.ts
git commit -m "fix: invalidate OAuth token cache on auth failure

Adds invalidateOAuthToken() to env-utils and calls it when agents
fail with auth errors, preventing a 30-minute fast-fail loop."
```

---

### Task 2: Write error details to task notes on all failure paths

**Problem:** When `setupWorktree` fails in the drain loop (`index.ts:208`), the task is marked `error` but the error message is NOT written to `notes`. Users see tasks fail with no explanation.

**Files:**

- Modify: `src/main/agent-manager/index.ts:206-210`
- Test: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Write failing test**

In `src/main/agent-manager/__tests__/index.test.ts`, find or add a test in the `drain loop` describe block:

```typescript
it('writes error details to task notes when setupWorktree fails', async () => {
  const setupError = new Error('Worktree lock held by PID 12345 for repo /path')
  vi.mocked(setupWorktree).mockRejectedValueOnce(setupError)
  vi.mocked(getQueuedTasks).mockResolvedValueOnce([mockTask])
  vi.mocked(claimTask).mockResolvedValueOnce(mockTask)

  const mgr = createAgentManager(baseConfig, logger)
  mgr.start()
  await vi.advanceTimersByTimeAsync(INITIAL_DRAIN_DEFER_MS + 100)

  expect(updateTask).toHaveBeenCalledWith(
    mockTask.id,
    expect.objectContaining({
      status: 'error',
      notes: expect.stringContaining('Worktree lock held by PID 12345')
    })
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.node.config.ts src/main/agent-manager/__tests__/index.test.ts -t "writes error details"`
Expected: FAIL — notes not included in updateTask call

- [ ] **Step 3: Fix the setupWorktree error handler**

In `src/main/agent-manager/index.ts`, change lines 207-209 from:

```typescript
logger.error(`[agent-manager] setupWorktree failed for task ${task.id}: ${err}`)
await updateTask(task.id, { status: 'error', completed_at: new Date().toISOString() })
```

To:

```typescript
const errMsg = err instanceof Error ? err.message : String(err)
logger.error(`[agent-manager] setupWorktree failed for task ${task.id}: ${errMsg}`)
await updateTask(task.id, {
  status: 'error',
  completed_at: new Date().toISOString(),
  notes: `Worktree setup failed: ${errMsg}`.slice(0, 500),
  claimed_by: null
})
```

Note: also clears `claimed_by` (see Task 3).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.node.config.ts src/main/agent-manager/__tests__/index.test.ts -t "writes error details"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/__tests__/index.test.ts
git commit -m "fix: write error details to task notes on setupWorktree failure

Previously the error message was only logged to the agent-manager.log file,
making failures invisible in the Sprint Center UI."
```

---

### Task 3: Clear `claimed_by` on all terminal status transitions

**Problem:** When a task transitions to `error` or `failed`, `claimed_by` stays set to `"bde-embedded"`. If the task is externally reset to `queued`, the drain loop's `claimTask` call skips it because the Supabase conditional update requires `status = 'queued'` AND the row must not be claimed.

**Files:**

- Modify: `src/main/agent-manager/index.ts:206-210` (already partially done in Task 2)
- Modify: `src/main/agent-manager/run-agent.ts:64,83,185`
- Modify: `src/main/agent-manager/completion.ts:74,83,117,230`
- Test: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Audit all `updateTask` calls that set terminal status**

Search for every `updateTask` call that sets `status: 'error'` or `status: 'failed'` and verify `claimed_by: null` is included. The affected locations are:

1. `index.ts:208` — setupWorktree failure (already fixed in Task 2)
2. `run-agent.ts:64` — empty prompt
3. `run-agent.ts:83` — spawn failure
4. `run-agent.ts:185` — fast-fail exhausted
5. `completion.ts:74` — branch detection failure
6. `completion.ts:83` — empty branch name
7. `completion.ts:117` — no commits to push
8. `completion.ts:230` — retry exhausted (sets `status: 'failed'`)

- [ ] **Step 2: Write failing test**

In `src/main/agent-manager/__tests__/completion.test.ts`, add:

```typescript
it('clears claimed_by when marking task as error for no commits', async () => {
  // ... setup mocks for no-commits path
  await resolveSuccess(opts, logger)
  expect(updateTask).toHaveBeenCalledWith(
    taskId,
    expect.objectContaining({
      status: 'error',
      claimed_by: null
    })
  )
})
```

- [ ] **Step 3: Add `claimed_by: null` to all terminal updateTask calls**

For each location in the audit (Step 1), add `claimed_by: null` to the `updateTask` patch object. For example, in `completion.ts:117`:

```typescript
await updateTask(taskId, {
  status: 'error',
  completed_at: new Date().toISOString(),
  notes: 'Agent produced no commits',
  claimed_by: null
})
```

Repeat for all 8 locations. In `run-agent.ts:83` (spawn failure):

```typescript
await updateTask(task.id, {
  status: 'error',
  completed_at: new Date().toISOString(),
  notes: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
  claimed_by: null
})
```

- [ ] **Step 4: Run tests**

Run: `npm run test:main`
Expected: PASS (some existing test expectations may need updating for the new `claimed_by: null` field)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/run-agent.ts src/main/agent-manager/completion.ts src/main/agent-manager/__tests__/
git commit -m "fix: clear claimed_by on all terminal status transitions

Prevents tasks from becoming permanently stuck when externally reset
from error→queued, because the drain loop's claimTask conditional
update skips rows that are still claimed."
```

---

### Task 4: Prevent duplicate drain loop execution

**Problem:** While `drainInFlight` correctly prevents concurrent drains in a single-threaded JS context, the real issue is that multiple Electron windows each create their own agent manager, producing truly concurrent drain loops that race for the same worktree lock. Adding a synchronous boolean guard is a defense-in-depth measure, and logging makes it easier to diagnose when multiple instances are running.

**Files:**

- Modify: `src/main/agent-manager/index.ts:140-145,312-324`
- Test: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Write failing test for concurrent drain prevention**

```typescript
it('prevents initial drain from overlapping with interval drain', async () => {
  let drainCallCount = 0
  // Spy on the internal drain to count concurrent runs
  vi.mocked(getQueuedTasks).mockImplementation(async () => {
    drainCallCount++
    await new Promise((r) => setTimeout(r, 100)) // simulate slow fetch
    return []
  })

  const mgr = createAgentManager({ ...baseConfig, pollIntervalMs: 50 }, logger)
  mgr.start()

  // Both deferred drain and first interval fire close together
  await vi.advanceTimersByTimeAsync(INITIAL_DRAIN_DEFER_MS + 200)

  // fetchQueuedTasks should NOT have been called concurrently
  // (each call increments, if concurrent we'd see extra calls)
  expect(drainCallCount).toBeLessThanOrEqual(2) // sequential, not parallel
})
```

- [ ] **Step 2: Add a synchronous guard to drainLoop**

In `src/main/agent-manager/index.ts`, add a `drainRunning` boolean guard at the top of `drainLoop()`:

Change the drain loop (line 140) from:

```typescript
async function drainLoop(): Promise<void> {
  logger.info(`[agent-manager] Drain loop starting (shuttingDown=${shuttingDown}, slots=${availableSlots(concurrency, activeAgents.size)})`)
  if (shuttingDown) return
```

To:

```typescript
let drainRunning = false // Add near line 112 with other state variables

async function drainLoop(): Promise<void> {
  if (drainRunning) {
    logger.info('[agent-manager] Drain loop already running — skipping')
    return
  }
  drainRunning = true
  try {
    logger.info(
      `[agent-manager] Drain loop starting (shuttingDown=${shuttingDown}, slots=${availableSlots(concurrency, activeAgents.size)})`
    )
    if (shuttingDown) return
    // ... rest of function unchanged
  } finally {
    drainRunning = false
  }
}
```

This is simpler and more reliable than the `drainInFlight` promise guard which has a race window between the check and the assignment.

- [ ] **Step 3: Run tests**

Run: `npm run test:main`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/__tests__/index.test.ts
git commit -m "fix: prevent concurrent drain loop execution with synchronous guard

The drainInFlight promise guard had a race window between check and
assignment. A synchronous boolean flag prevents any overlap between
the deferred initial drain and interval-triggered drains."
```

---

### Task 5: Don't block drain loop during orphan recovery

**Problem:** `orphanRecoveryRunning` flag causes `Skipping drain loop - orphan recovery in progress` on alternating 30s cycles, halving agent pickup throughput.

**Files:**

- Modify: `src/main/agent-manager/index.ts:144-148,262-278`
- Test: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Analyze the actual conflict**

The orphan recovery and drain loop both call `updateTask()` on the same tasks. The guard exists to prevent both from modifying the same task simultaneously. However, the drain loop only touches `queued` tasks (via `claimTask` which has a conditional `eq('status', 'queued')`) while orphan recovery only touches `active` tasks claimed by the same executor. They operate on disjoint sets.

- [ ] **Step 2: Remove the orphan recovery guard from drainLoop**

In `src/main/agent-manager/index.ts`, remove lines 144-148:

```typescript
// DELETE these lines:
if (orphanRecoveryRunning) {
  logger.info('[agent-manager] Skipping drain loop - orphan recovery in progress')
  return
}
```

The `claimTask()` function uses a conditional Supabase update (`eq('status', 'queued')`) that naturally prevents conflicts — orphan recovery changes tasks to `queued`, and the drain loop only claims tasks that ARE `queued`. There's no actual race condition.

- [ ] **Step 3: Run tests**

Run: `npm run test:main`
Expected: PASS (update any tests that assert the skip behavior)

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/__tests__/index.test.ts
git commit -m "fix: remove orphan recovery guard from drain loop

The drain loop and orphan recovery operate on disjoint task sets
(queued vs active), so the guard was unnecessary. It was halving
effective drain throughput by skipping every other cycle."
```

---

### Task 6: Use task ID in branch names to prevent collisions

**Problem:** `branchNameForTask(title)` generates branch names from the task title slug. Two tasks with the same title (e.g., retries) create the same branch name, causing `git worktree add` failures. Stale branches from previous runs also block new runs.

**Files:**

- Modify: `src/main/agent-manager/worktree.ts:10-17,77-94`
- Test: `src/main/agent-manager/__tests__/worktree.test.ts` (create if needed)

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { branchNameForTask } from '../worktree'

describe('branchNameForTask', () => {
  it('includes task ID to prevent collisions', () => {
    const branch = branchNameForTask('Fix auth bugs', 'abc123')
    expect(branch).toContain('abc123')
    expect(branch).toMatch(/^agent\//)
  })

  it('generates different branches for same title with different IDs', () => {
    const b1 = branchNameForTask('Fix auth bugs', 'id-1')
    const b2 = branchNameForTask('Fix auth bugs', 'id-2')
    expect(b1).not.toBe(b2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.node.config.ts src/main/agent-manager/__tests__/worktree.test.ts`
Expected: FAIL — `branchNameForTask` doesn't accept a second argument

- [ ] **Step 3: Update `branchNameForTask` to include task ID**

In `src/main/agent-manager/worktree.ts`, change `branchNameForTask` (lines 10-17):

```typescript
export function branchNameForTask(title: string, taskId?: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const suffix = taskId ? `-${taskId.slice(0, 8)}` : ''
  return `agent/${slug}${suffix}`
}
```

The task ID's first 8 chars are appended, making each branch unique. Title slug shortened to 40 to keep total branch name reasonable.

- [ ] **Step 4: Update callers to pass task ID**

In `src/main/agent-manager/worktree.ts` `setupWorktree()` (line 79):

```typescript
const branch = branchNameForTask(title, taskId)
```

The `taskId` is already available in `SetupWorktreeOpts`.

- [ ] **Step 5: Run tests**

Run: `npm run typecheck && npm run test:main`
Expected: PASS (some existing tests may need updating for the new branch name format)

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/worktree.ts src/main/agent-manager/__tests__/worktree.test.ts
git commit -m "fix: include task ID in agent branch names to prevent collisions

Two tasks with the same title no longer create the same branch name.
Stale branches from previous runs of different tasks don't block new runs."
```

---

### Task 7: Store agent output summary in task notes on completion

**Problem:** "Agent produced no commits" covers 4+ distinct scenarios with no way to distinguish them in the UI. Agents that run successfully but decide no changes are needed look identical to agents that crashed.

**Files:**

- Modify: `src/main/agent-manager/run-agent.ts:130-149`
- Modify: `src/main/agent-manager/completion.ts:115-122`
- Create: `src/main/agent-manager/__tests__/run-agent-summary.test.ts`

- [ ] **Step 1: Track agent's last text output in ActiveAgent**

In `src/main/agent-manager/run-agent.ts`, add a `lastOutput` field to the agent object (after line 101):

```typescript
const agent: ActiveAgent & { lastOutput?: string } = {
  // ... existing fields
}
```

Then in the message loop (around line 133-146), capture the last text message:

```typescript
for await (const msg of handle.messages) {
  agent.lastOutputAt = Date.now()

  // Capture last assistant text for diagnostics
  if (typeof msg === 'object' && msg !== null) {
    const m = msg as Record<string, unknown>
    if (m.type === 'assistant' && typeof m.text === 'string') {
      agent.lastOutput = (m.text as string).slice(-500)
    }
  }

  // ... existing rate limit / cost tracking
}
```

- [ ] **Step 2: Pass last output through to completion handler**

After the message loop completes and before calling `resolveSuccess`, store the last output so the completion handler can use it. Add to the `resolveSuccess` opts or write it to notes directly.

In `run-agent.ts`, after line 165 (`activeAgents.delete(task.id)`), add:

```typescript
// Store agent's last output for diagnostics if completion needs it
const agentSummary = (agent as { lastOutput?: string }).lastOutput ?? null
```

Then in the normal-exit path (around line 196-212), if `resolveSuccess` would mark the task as "no commits", update notes to include what the agent said:

Pass `agentSummary` as part of opts:

```typescript
await resolveSuccess(
  {
    taskId: task.id,
    worktreePath: worktree.worktreePath,
    title: task.title,
    ghRepo,
    onTaskTerminal,
    agentSummary
  },
  logger
)
```

- [ ] **Step 3: Use agent summary in completion "no commits" path**

In `completion.ts`, update the `ResolveSuccessOpts` interface:

```typescript
export interface ResolveSuccessOpts {
  taskId: string
  worktreePath: string
  title: string
  ghRepo: string
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  agentSummary?: string | null
}
```

Then in the "no commits" error (line 117):

```typescript
const summaryNote = opts.agentSummary
  ? `Agent produced no commits. Last output: ${opts.agentSummary.slice(0, 300)}`
  : 'Agent produced no commits (no output captured)'
await updateTask(taskId, {
  status: 'error',
  completed_at: new Date().toISOString(),
  notes: summaryNote,
  claimed_by: null
})
```

- [ ] **Step 4: Run tests**

Run: `npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/run-agent.ts src/main/agent-manager/completion.ts src/main/agent-manager/__tests__/
git commit -m "fix: include agent's last output in 'no commits' error notes

When an agent produces no commits, the task notes now include the
agent's last text output, making it possible to distinguish between
agents that decided no changes were needed vs agents that failed."
```

---

### Task 8: Clean up stale agent_runs records

**Problem:** Agent records are created with `pid: null` (SDK agents don't expose a PID). The watchdog checks `process.kill(pid, 0)` which can't work on null PIDs. Records accumulate as `running` indefinitely.

**Files:**

- Modify: `src/main/agent-manager/run-agent.ts:108-127`
- Modify: `src/main/agent-history.ts` (add cleanup function)
- Test: `src/main/agent-manager/__tests__/run-agent.test.ts`

- [ ] **Step 1: Store agentRunId on ActiveAgent for watchdog access**

The `agentRunId` is already on `ActiveAgent` (types.ts line 42). The watchdog can use it. The real fix is: when the watchdog kills an agent (or detects it's dead), it should also finalize the `agent_runs` record.

- [ ] **Step 2: Add a `finalizeStaleAgentRuns` function**

In `src/main/agent-history.ts`, add (using `getDb()` which is the established access pattern):

```typescript
import { getDb } from './db'

/** Mark all agent_runs stuck in 'running' older than maxAgeMs as 'failed'. */
export function finalizeStaleAgentRuns(maxAgeMs: number = 2 * 60 * 60 * 1000): number {
  const db = getDb()
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  const stmt = db.prepare(
    `UPDATE agent_runs SET status = 'failed', finished_at = datetime('now')
     WHERE status = 'running' AND started_at < ?`
  )
  const result = stmt.run(cutoff)
  return result.changes
}
```

- [ ] **Step 3: Call it during orphan recovery**

In `src/main/agent-manager/orphan-recovery.ts`, just before the `return recovered` statement in `recoverOrphans()`:

```typescript
// Also clean up stale agent_runs records (SDK agents have pid=null)
try {
  const { finalizeStaleAgentRuns } = await import('../agent-history')
  const cleaned = finalizeStaleAgentRuns()
  if (cleaned > 0) logger.info(`[agent-manager] Finalized ${cleaned} stale agent_runs records`)
} catch {
  /* best-effort */
}
```

- [ ] **Step 4: Run tests**

Run: `npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-history.ts src/main/agent-manager/orphan-recovery.ts src/main/agent-manager/__tests__/
git commit -m "fix: clean up stale agent_runs records with null PIDs

SDK-spawned agents don't expose a PID, so the watchdog can't detect
them as dead via process.kill. Now orphan recovery also finalizes
agent_runs stuck in 'running' for >2 hours."
```

---

## Execution Order

Tasks are independent and can be parallelized, but if executing sequentially, this order minimizes conflicts:

1. **Task 1** (token cache) — standalone, no dependencies
2. **Task 2** (error notes) + **Task 3** (claimed_by) — overlap in same file, do together
3. **Task 4** (drain guard) — modifies drain loop
4. **Task 5** (orphan guard removal) — also modifies drain loop, do after Task 4
5. **Task 6** (branch naming) — standalone
6. **Task 7** (agent summary) — modifies run-agent + completion
7. **Task 8** (stale records) — standalone

**Recommended parallel groupings:**

- Group A: Tasks 1, 6, 8 (completely independent files)
- Group B: Tasks 2+3 (same error path in index.ts)
- Group C: Tasks 4+5 (drain loop in index.ts)
- Group D: Task 7 (run-agent + completion)
