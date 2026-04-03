# BDE Code Quality Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all HIGH and MEDIUM severity issues found in the post-session code review — stale dependency index, swallowed errors, missing logger usage, type safety gaps, hardcoded paths, IPC naming inconsistencies, dead code, and test gaps.

**Architecture:** Changes are scoped to `src/main/agent-manager/`, `src/main/handlers/`, `src/main/index.ts`, `src/shared/ipc-channels.ts`, and `src/renderer/src/components/sprint/TaskCard.tsx`. Each task is independent and can be committed separately. No new files except one global type declaration file and one new constant.

**Tech Stack:** TypeScript, Electron, Vitest, Zustand, Supabase

---

## File Structure

| Action | File                                                          | Responsibility                                                                                   |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Create | `src/main/globals.d.ts`                                       | Declare `__agentManager` on `globalThis`                                                         |
| Modify | `src/main/agent-manager/types.ts`                             | Add missing timeout constants (`SPAWN_TIMEOUT_MS`, `QUEUE_TIMEOUT_MS`, `INITIAL_DRAIN_DEFER_MS`) |
| Modify | `src/main/agent-manager/index.ts`                             | Wire dep index updates, fix swallowed errors, use named constants, pass logger to sub-modules    |
| Modify | `src/main/agent-manager/completion.ts`                        | Accept logger param, replace console.\*, fix PR status on failure                                |
| Modify | `src/main/agent-manager/worktree.ts`                          | Accept logger param, replace console.\*                                                          |
| Modify | `src/main/agent-manager/resolve-dependents.ts`                | Accept logger param, replace console.warn                                                        |
| Modify | `src/main/agent-manager/sdk-adapter.ts`                       | Remove dead code, replace console.warn, add stdin error handling                                 |
| Modify | `src/main/index.ts`                                           | Use proper import for fs, use LOG_PATH from paths, use typed global                              |
| Modify | `src/main/paths.ts`                                           | Add `BDE_AGENT_LOG_PATH` constant                                                                |
| Modify | `src/main/handlers/workbench.ts`                              | Remove unused import, use typed global                                                           |
| Modify | `src/shared/ipc-channels.ts`                                  | Rename kebab-case channels to camelCase                                                          |
| Modify | `src/main/handlers/sprint-local.ts`                           | Update channel references                                                                        |
| Modify | `src/preload/index.ts`                                        | Update channel references                                                                        |
| Modify | `src/renderer/src/components/sprint/TaskCard.tsx`             | Add error handling to unblockTask                                                                |
| Modify | `src/main/agent-manager/__tests__/resolve-dependents.test.ts` | Add edge case tests                                                                              |
| Modify | `src/main/handlers/__tests__/workbench.test.ts`               | Remove duplicate mock                                                                            |
| Modify | `src/main/agent-manager/__tests__/index.test.ts`              | Add error-path tests                                                                             |

---

### Task 1: Add Missing Constants to `types.ts`

**Files:**

- Modify: `src/main/agent-manager/types.ts:22-28`
- Test: Existing tests reference these; no new test needed.

- [ ] **Step 1: Add timeout constants**

In `src/main/agent-manager/types.ts`, add after line 28:

```typescript
export const SPAWN_TIMEOUT_MS = 60_000
export const QUEUE_TIMEOUT_MS = 10_000
export const INITIAL_DRAIN_DEFER_MS = 5_000
```

- [ ] **Step 2: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS (no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/main/agent-manager/types.ts
git commit -m "chore: extract hardcoded timeouts into named constants"
```

---

### Task 2: Create Global Type Declaration for `__agentManager`

**Files:**

- Create: `src/main/globals.d.ts`

- [ ] **Step 1: Create the declaration file**

```typescript
import type { AgentManager } from './agent-manager/index'

declare global {
  // eslint-disable-next-line no-var
  var __agentManager: AgentManager | undefined
}
```

- [ ] **Step 2: Update `src/main/index.ts:125` — replace `(global as any)` with typed global**

Change:

```typescript
;(global as any).__agentManager = am
```

To:

```typescript
globalThis.__agentManager = am
```

- [ ] **Step 3: Update `src/main/handlers/workbench.ts:94` — replace `(global as any)` with typed global**

Change:

```typescript
const am = (global as any).__agentManager
```

To:

```typescript
const am = globalThis.__agentManager
```

- [ ] **Step 4: Remove unused import in `workbench.ts:5`**

Remove: `import { checkAuthStatus } from '../auth-guard'`

- [ ] **Step 5: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/globals.d.ts src/main/index.ts src/main/handlers/workbench.ts
git commit -m "fix: type-safe global for __agentManager, remove unused import"
```

---

### Task 3: Fix Hardcoded `/tmp` Log Path in `main/index.ts`

**Files:**

- Modify: `src/main/paths.ts:9`
- Modify: `src/main/index.ts:111-121`

- [ ] **Step 1: Add log path constant to `paths.ts`**

In `src/main/paths.ts`, add after line 9:

```typescript
export const BDE_AGENT_LOG_PATH = join(BDE_DIR, 'agent-manager.log')
```

- [ ] **Step 2: Remove debug logging from `index.ts`**

The `appendFileSync` calls at lines 111-112, 118, 121 are debug logging added during development. They duplicate what the agent manager's own logger already does. **Delete all three `fs.appendFileSync` calls and the `const fs = require(...)` line.**

Remove lines 111-112, 118, 121 (the `require` and all three `appendFileSync` calls).

Also update `src/main/agent-manager/index.ts:61` — change:

```typescript
const LOG_PATH = '/tmp/bde-agent-manager.log'
```

To:

```typescript
import { BDE_AGENT_LOG_PATH } from '../paths'
const LOG_PATH = BDE_AGENT_LOG_PATH
```

- [ ] **Step 3: Run typecheck and tests**

Run: `cd ~/projects/BDE && npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/paths.ts src/main/index.ts src/main/agent-manager/index.ts
git commit -m "fix: use ~/.bde/ for agent-manager log, remove debug logging from main"
```

---

### Task 4: Fix Swallowed Errors — Add Logging to All `.catch(() => {})`

This is the highest-impact fix. Every `.catch(() => {})` becomes `.catch((err) => logger.warn(...))`.

**Files:**

- Modify: `src/main/agent-manager/index.ts:183, 387, 391, 394, 451, 459`

- [ ] **Step 1: Write a failing test for error visibility**

In `src/main/agent-manager/__tests__/index.test.ts`, add a test that verifies the watchdog logs errors:

```typescript
it('logs warning when watchdog updateTask fails', async () => {
  const logger = makeLogger()
  vi.mocked(updateTask).mockRejectedValueOnce(new Error('DB down'))
  // ... setup agent that triggers watchdog kill for max-runtime ...
  // Verify logger.warn was called with the error
  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('DB down'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/index.test.ts --reporter=verbose`
Expected: FAIL — error is currently swallowed

- [ ] **Step 3: Fix all swallowed catches in `index.ts`**

**Line 183** — spawn failure updateTask catch:

```typescript
// Before:
.catch(() => {})
// After:
.catch((err) => logger.warn(`[agent-manager] Failed to update task ${task.id} after spawn failure: ${err}`))
```

**Lines 385-387** — watchdog max-runtime:

```typescript
// Before:
.catch(() => {})
// After:
.catch((err) => logger.warn(`[agent-manager] Failed to update task ${agent.taskId} after max-runtime kill: ${err}`))
```

**Lines 389-391** — watchdog idle:

```typescript
// Before:
.catch(() => {})
// After:
.catch((err) => logger.warn(`[agent-manager] Failed to update task ${agent.taskId} after idle kill: ${err}`))
```

**Line 394** — watchdog rate-limit requeue:

```typescript
// Before:
.catch(() => {})
// After:
.catch((err) => logger.warn(`[agent-manager] Failed to requeue rate-limited task ${agent.taskId}: ${err}`))
```

**Line 451** — drain loop catch:

```typescript
// Before:
drainInFlight = drainLoop().catch(() => {}).finally(...)
// After:
drainInFlight = drainLoop().catch((err) => logger.warn(`[agent-manager] Drain loop error: ${err}`)).finally(...)
```

**Line 459** — initial drain catch:

```typescript
// Before:
drainInFlight = drainLoop().catch(() => {}).finally(...)
// After:
drainInFlight = drainLoop().catch((err) => logger.warn(`[agent-manager] Initial drain error: ${err}`)).finally(...)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/index.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/__tests__/index.test.ts
git commit -m "fix: log errors instead of silently swallowing in agent-manager"
```

---

### Task 5: Replace Hardcoded Timeouts with Named Constants

**Files:**

- Modify: `src/main/agent-manager/index.ts:37, 45, 179, 460`

- [ ] **Step 1: Add imports for new constants**

At the top of `index.ts`, add to the existing import from `./types`:

```typescript
import {
  EXECUTOR_ID,
  MAX_RETRIES,
  WATCHDOG_INTERVAL_MS,
  ORPHAN_CHECK_INTERVAL_MS,
  WORKTREE_PRUNE_INTERVAL_MS,
  SPAWN_TIMEOUT_MS,
  QUEUE_TIMEOUT_MS,
  INITIAL_DRAIN_DEFER_MS
} from './types'
```

- [ ] **Step 2: Replace magic numbers**

**Line 37**: `10_000` → `QUEUE_TIMEOUT_MS`
**Line 45**: `10_000` → `QUEUE_TIMEOUT_MS`
**Line 179**: `60_000` → `SPAWN_TIMEOUT_MS`
**Line 460**: `5_000` → `INITIAL_DRAIN_DEFER_MS`

- [ ] **Step 3: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/index.ts
git commit -m "chore: replace magic timeout numbers with named constants"
```

---

### Task 6: Wire Dependency Index Updates Into Task Mutations

This is the critical bug fix — the dependency index becomes stale because it's only built at startup.

**Files:**

- Modify: `src/main/agent-manager/index.ts:122-130, 436-441`
- Modify: `src/main/agent-manager/dependency-index.ts` (no changes needed — `update()` and `remove()` already exist)

- [ ] **Step 1: Write failing test — index should refresh during drain loop**

In `src/main/agent-manager/__tests__/index.test.ts`, add:

```typescript
it('refreshes dependency index during drain loop, not just at startup', async () => {
  const logger = makeLogger()
  const mgr = createAgentManager({ ...baseConfig, pollIntervalMs: 100 }, logger)
  mgr.start()
  await flush()

  // Called once at startup
  expect(vi.mocked(getTasksWithDependencies)).toHaveBeenCalledTimes(1)

  // Trigger a drain loop (initial drain fires after INITIAL_DRAIN_DEFER_MS)
  await vi.advanceTimersByTimeAsync(6_000)
  await flush()

  // Should be called a second time inside the drain loop
  expect(vi.mocked(getTasksWithDependencies)).toHaveBeenCalledTimes(2)
  await mgr.stop()
})
```

- [ ] **Step 2: Run test to verify behavior**

Run: `cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/index.test.ts --reporter=verbose`

- [ ] **Step 3: Add index refresh to the drain loop**

The simplest correct fix: rebuild the index at the top of each drain loop iteration. The dependency index rebuild is cheap (iterates an array, builds a Map) and the drain loop runs every 30s. This avoids the complexity of hooking every mutation path.

In `index.ts`, inside `drainLoop()`, after the `if (shuttingDown) return` check (line 290), add:

```typescript
// Refresh dependency index each drain cycle to pick up tasks created
// since startup or since the last drain. Rebuild is O(n) and cheap.
try {
  const allTasks = await getTasksWithDependencies()
  depIndex.rebuild(allTasks)
} catch (err) {
  logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
}
```

- [ ] **Step 4: Run tests**

Run: `cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/index.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/__tests__/index.test.ts
git commit -m "fix: refresh dependency index each drain cycle to prevent stale blocked tasks"
```

---

### Task 7: Thread Logger Through Sub-Modules (completion, worktree, resolve-dependents, sdk-adapter)

Replace all direct `console.*` calls with the Logger interface.

**Files:**

- Modify: `src/main/agent-manager/completion.ts:43, 61`
- Modify: `src/main/agent-manager/worktree.ts:53`
- Modify: `src/main/agent-manager/resolve-dependents.ts:52`
- Modify: `src/main/agent-manager/sdk-adapter.ts:97`
- Modify: `src/main/agent-manager/index.ts` (pass logger to call sites)

- [ ] **Step 1: Export Logger type from `index.ts`**

Move the `Logger` interface from `index.ts` to `types.ts` so sub-modules can import it:

In `types.ts`, add:

```typescript
export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}
```

Remove the duplicate `interface Logger` from `index.ts` and import from `./types`.

- [ ] **Step 2: Add logger param to `completion.ts`**

Change `resolveSuccess` and `resolveFailure` signatures to accept `logger: Logger`:

```typescript
import type { Logger } from './types'

export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
```

Replace line 43: `console.log(...)` → `logger.info(...)`
Replace line 61: `console.error(...)` → `logger.warn(...)`

- [ ] **Step 3: Add logger param to `worktree.ts`**

Add to `acquireLock`:

```typescript
function acquireLock(worktreeBase: string, repoPath: string, logger?: Logger): void {
```

Replace line 53: `console.warn(...)` → `logger?.warn(...) ?? console.warn(...)`

Actually, simpler approach — only `setupWorktree` is called from `index.ts`. Thread logger through the public API:

```typescript
export async function setupWorktree(opts: SetupWorktreeOpts & { logger?: Logger }): Promise<SetupWorktreeResult> {
```

Replace line 53: `console.warn(...)` → `(opts.logger ?? console).warn(...)`

- [ ] **Step 4: Add logger param to `resolve-dependents.ts`**

```typescript
export async function resolveDependents(
  completedTaskId: string,
  completedStatus: string,
  index: DependencyIndex,
  getTask: (...) => ...,
  updateTask: (...) => ...,
  logger?: Logger,
): Promise<void> {
```

Replace line 52: `console.warn(...)` → `(logger ?? console).warn(...)`

- [ ] **Step 5: Add logger param to `sdk-adapter.ts`**

In `spawnAgent`, accept optional logger:

```typescript
export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
  logger?: Logger
}): Promise<AgentHandle> {
```

Pass through to `spawnViaSdk`. Replace line 97: `console.warn(...)` → `(opts.logger ?? console).warn(...)`

- [ ] **Step 6: Update all call sites in `index.ts`**

Pass `logger` to:

- `resolveSuccess(opts, logger)` (line 261)
- `resolveFailure(opts)` — no logger needed (only calls updateTask)
- `resolveDependents(taskId, status, depIndex, getTask, updateTask, logger)` (line 126)
- `spawnAgent({ ...opts, logger })` (line 174)
- `setupWorktree({ ...opts, logger })` (line 338)

- [ ] **Step 7: Run typecheck and tests**

Run: `cd ~/projects/BDE && npm run typecheck && npm run test:main`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/main/agent-manager/types.ts src/main/agent-manager/index.ts \
  src/main/agent-manager/completion.ts src/main/agent-manager/worktree.ts \
  src/main/agent-manager/resolve-dependents.ts src/main/agent-manager/sdk-adapter.ts
git commit -m "fix: thread logger through agent-manager sub-modules, remove console.* calls"
```

---

### Task 8: Clean Up `sdk-adapter.ts` — Dead Code and stdin Handling

**Files:**

- Modify: `src/main/agent-manager/sdk-adapter.ts:102, 162-163`

- [ ] **Step 1: Remove dead `void message` line**

Delete line 102: `void message`

The `steer()` in SDK mode already logs a warning and calls `interrupt()`. The `void message` is dead code.

- [ ] **Step 2: Add stdin error handling for CLI mode**

In `spawnViaCli`, after spawning (line 128), add stderr drain:

```typescript
// Drain stderr to prevent pipe buffer backpressure
child.stderr.resume()
```

In the `steer()` function (line 165), add a guard:

```typescript
async steer(message: string) {
  if (!child.stdin.writable) return
  child.stdin.write(
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: message },
      parent_tool_use_id: null,
      session_id: sessionId,
    }) + '\n',
  )
},
```

- [ ] **Step 3: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/sdk-adapter.ts
git commit -m "fix: remove dead code in sdk-adapter, add stdin/stderr guards"
```

---

### Task 9: Fix IPC Channel Naming Inconsistency

**Files:**

- Modify: `src/shared/ipc-channels.ts:242-249`
- Modify: `src/main/handlers/sprint-local.ts` (channel registration)
- Modify: `src/preload/index.ts` (channel references)
- Modify: `src/preload/index.d.ts` (type references to channel names)

- [ ] **Step 1: Rename channels in `ipc-channels.ts`**

```typescript
// Before:
'sprint:validate-dependencies': { ... }
'sprint:unblock-task': { ... }

// After:
'sprint:validateDependencies': { ... }
'sprint:unblockTask': { ... }
```

- [ ] **Step 2: Update handler registration in `sprint-local.ts`**

Search for `'sprint:validate-dependencies'` and `'sprint:unblock-task'` and rename to camelCase.

- [ ] **Step 3: Update preload bridge in `preload/index.ts`**

Search for `'sprint:validate-dependencies'` and `'sprint:unblock-task'` and rename to camelCase.

- [ ] **Step 4: Update type declarations in `preload/index.d.ts`**

Search for `'sprint:validate-dependencies'` and `'sprint:unblock-task'` and rename to camelCase.

- [ ] **Step 5: Search for any other references**

Run: `grep -r "validate-dependencies\|unblock-task" src/`
Update any remaining references.

- [ ] **Step 6: Run typecheck and tests**

Run: `cd ~/projects/BDE && npm run typecheck && npm test`
Expected: PASS — TypeScript will catch any missed references since IPC channels are typed.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/handlers/sprint-local.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "chore: standardize IPC channel names to camelCase"
```

---

### Task 10: Add Error Handling to `unblockTask` in TaskCard

**Files:**

- Modify: `src/renderer/src/components/sprint/TaskCard.tsx:164-166`

- [ ] **Step 1: Add error handling**

Replace (around line 164):

```tsx
onClick={() => {
  window.api?.sprint?.unblockTask?.(task.id)
}}
```

With:

```tsx
onClick={() => {
  window.api?.sprint?.unblockTask?.(task.id).catch((err: unknown) => {
    console.error('[TaskCard] unblockTask failed:', err)
  })
}}
```

- [ ] **Step 2: Run typecheck**

Run: `cd ~/projects/BDE && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/sprint/TaskCard.tsx
git commit -m "fix: add error handling to unblockTask call in TaskCard"
```

---

### Task 11: Fix Test Quality — Remove Duplicate Mock in workbench.test.ts

**Files:**

- Modify: `src/main/handlers/__tests__/workbench.test.ts`

- [ ] **Step 1: Remove the duplicate mock declaration**

Find and remove the second `vi.mock('../../ipc-utils', ...)` call (around line 66-68) — the first declaration (around line 8) is sufficient.

- [ ] **Step 2: Run test**

Run: `cd ~/projects/BDE && npx vitest run src/main/handlers/__tests__/workbench.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/handlers/__tests__/workbench.test.ts
git commit -m "fix: remove duplicate mock declaration in workbench test"
```

---

### Task 12: Add Missing Edge Case Tests for resolve-dependents

**Files:**

- Modify: `src/main/agent-manager/__tests__/resolve-dependents.test.ts`

- [ ] **Step 1: Add test for dependent already in terminal state (should skip)**

```typescript
it('skips dependents that are not in blocked status', async () => {
  const index = createDependencyIndex()
  index.rebuild([{ id: 'A', depends_on: [{ id: 'B', type: 'hard' }] }])
  const getTask = vi
    .fn()
    .mockResolvedValue({ id: 'A', status: 'done', depends_on: [{ id: 'B', type: 'hard' }] })
  const update = vi.fn()

  await resolveDependents('B', 'done', index, getTask, update)
  expect(update).not.toHaveBeenCalled() // A is 'done', not 'blocked'
})
```

- [ ] **Step 2: Add test for getTask throwing**

```typescript
it('handles getTask throwing without crashing', async () => {
  const index = createDependencyIndex()
  index.rebuild([{ id: 'A', depends_on: [{ id: 'B', type: 'hard' }] }])
  const getTask = vi.fn().mockRejectedValue(new Error('DB error'))
  const update = vi.fn()

  // Should not throw
  await resolveDependents('B', 'done', index, getTask, update)
  expect(update).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Add test for updateTask throwing during unblock**

```typescript
it('handles updateTask throwing during unblock without crashing', async () => {
  const index = createDependencyIndex()
  index.rebuild([
    { id: 'A', depends_on: [{ id: 'B', type: 'hard' }] },
    { id: 'C', depends_on: [{ id: 'B', type: 'soft' }] }
  ])
  const getTask = vi
    .fn()
    .mockResolvedValueOnce({ id: 'A', status: 'blocked', depends_on: [{ id: 'B', type: 'hard' }] })
    .mockResolvedValueOnce({ id: 'B', status: 'done', depends_on: null }) // for status cache
    .mockResolvedValueOnce({ id: 'C', status: 'blocked', depends_on: [{ id: 'B', type: 'soft' }] })
    .mockResolvedValueOnce({ id: 'B', status: 'done', depends_on: null }) // for status cache
  const update = vi
    .fn()
    .mockRejectedValueOnce(new Error('DB error')) // A fails
    .mockResolvedValueOnce(null) // C succeeds

  await resolveDependents('B', 'done', index, getTask, update)
  // C should still be unblocked even though A's update failed
  expect(update).toHaveBeenCalledTimes(2)
})
```

- [ ] **Step 4: Add test for orphaned dependency (task no longer exists)**

```typescript
it('treats deleted dependency as satisfied', async () => {
  const index = createDependencyIndex()
  index.rebuild([
    {
      id: 'A',
      depends_on: [
        { id: 'B', type: 'hard' },
        { id: 'DELETED', type: 'hard' }
      ]
    }
  ])
  const getTask = vi.fn().mockImplementation((id: string) => {
    if (id === 'A')
      return Promise.resolve({
        id: 'A',
        status: 'blocked',
        depends_on: [
          { id: 'B', type: 'hard' },
          { id: 'DELETED', type: 'hard' }
        ]
      })
    if (id === 'B') return Promise.resolve({ id: 'B', status: 'done', depends_on: null })
    return Promise.resolve(null) // DELETED task doesn't exist
  })
  const update = vi.fn()

  await resolveDependents('B', 'done', index, getTask, update)
  // DELETED dep returns null → status undefined → treated as satisfied
  // B dep is done → satisfied
  // All satisfied → A should be unblocked
  expect(update).toHaveBeenCalledWith('A', { status: 'queued' })
})
```

- [ ] **Step 5: Run tests**

Run: `cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/resolve-dependents.test.ts --reporter=verbose`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/__tests__/resolve-dependents.test.ts
git commit -m "test: add edge case coverage for resolve-dependents"
```

---

### Task 13: Add Error-Path Tests for Agent Manager

**Files:**

- Modify: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Add test for drain loop DB failure**

```typescript
it('logs error when fetchQueuedTasks fails', async () => {
  const logger = makeLogger()
  vi.mocked(getQueuedTasks).mockRejectedValueOnce(new Error('Supabase down'))
  const mgr = createAgentManager({ ...baseConfig, pollIntervalMs: 50 }, logger)
  mgr.start()
  // Wait for initial drain (deferred by INITIAL_DRAIN_DEFER_MS)
  await vi.advanceTimersByTimeAsync(6_000)
  await flush()
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Supabase down'))
  await mgr.stop()
})
```

- [ ] **Step 2: Add test for spawn failure error logging**

```typescript
it('logs error and marks task as error when spawn fails', async () => {
  const logger = makeLogger()
  vi.mocked(getQueuedTasks).mockResolvedValueOnce([makeTask()])
  vi.mocked(claimTask).mockResolvedValueOnce({} as any)
  vi.mocked(spawnAgent).mockRejectedValueOnce(new Error('SDK crash'))
  const mgr = createAgentManager(baseConfig, logger)
  mgr.start()
  await vi.advanceTimersByTimeAsync(6_000)
  await flush()
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('spawnAgent failed'))
  expect(vi.mocked(updateTask)).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ status: 'error' })
  )
  await mgr.stop()
})
```

- [ ] **Step 3: Run tests**

Run: `cd ~/projects/BDE && npx vitest run src/main/agent-manager/__tests__/index.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/__tests__/index.test.ts
git commit -m "test: add error-path coverage for agent manager drain and spawn"
```

---

### Task 14: Fix PR Status Set Incorrectly on Failure in completion.ts

**Files:**

- Modify: `src/main/agent-manager/completion.ts:60-69`

- [ ] **Step 1: Write failing test**

In `src/main/agent-manager/__tests__/completion.test.ts`, verify that when `gh pr create` fails, `pr_status` is NOT set to `'open'`:

```typescript
it('does not set pr_status to open when gh pr create fails', async () => {
  mockExecFileSequence([
    { stdout: 'agent/my-branch\n', stderr: '' }, // git rev-parse
    { stdout: 'push ok\n', stderr: '' } // git push
  ])
  // gh pr create throws
  vi.mocked(execFileMock).mockRejectedValueOnce(new Error('gh auth failed'))

  await resolveSuccess({ taskId: 't1', worktreePath: '/tmp/wt', title: 'Test', ghRepo: 'o/r' })

  expect(updateTaskMock).toHaveBeenCalledWith(
    't1',
    expect.not.objectContaining({ pr_status: 'open' })
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — currently `pr_status: 'open'` is always set.

- [ ] **Step 3: Fix the logic in `completion.ts`**

Replace lines 65-69:

```typescript
// Before:
const patch: Record<string, unknown> = { pr_status: 'open' }
if (prUrl !== null) patch.pr_url = prUrl
if (prNumber !== null) patch.pr_number = prNumber
await updateTask(taskId, patch)

// After:
const patch: Record<string, unknown> = {}
if (prUrl !== null) {
  patch.pr_status = 'open'
  patch.pr_url = prUrl
  patch.pr_number = prNumber
} else {
  // Push succeeded but PR creation failed — mark as pushed, not open
  patch.pr_status = 'push_failed_pr'
}
await updateTask(taskId, patch)
```

Wait — check if `pr_status` has an allowlist. The simpler approach: only set `pr_status: 'open'` if PR was actually created:

```typescript
if (prUrl !== null && prNumber !== null) {
  await updateTask(taskId, { pr_status: 'open', pr_url: prUrl, pr_number: prNumber })
} else {
  // Push succeeded but PR creation failed — record branch name so user can create PR manually
  await updateTask(taskId, { notes: `Branch ${branch} pushed but PR creation failed` })
}
```

This way, if PR creation fails but push succeeded, the task gets a note explaining the situation instead of a misleading `pr_status: 'open'`. The user can create the PR manually from the pushed branch.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/completion.ts src/main/agent-manager/__tests__/completion.test.ts
git commit -m "fix: don't mark task pr_status=open when PR creation fails"
```

---

## Summary

| Task                        | Issue #         | Severity | Est.   |
| --------------------------- | --------------- | -------- | ------ |
| 1. Named constants          | #13             | Medium   | 2 min  |
| 2. Typed global             | #4              | Medium   | 5 min  |
| 3. Fix /tmp log path        | #7              | Medium   | 5 min  |
| 4. Fix swallowed errors     | #2              | HIGH     | 10 min |
| 5. Replace magic numbers    | #13             | Medium   | 3 min  |
| 6. Wire dep index refresh   | #1              | HIGH     | 10 min |
| 7. Thread logger            | #6              | Medium   | 15 min |
| 8. Clean sdk-adapter        | #14             | Low      | 5 min  |
| 9. IPC naming               | #9              | Medium   | 5 min  |
| 10. TaskCard error handling | #10             | Medium   | 2 min  |
| 11. Fix duplicate mock      | T3              | Low      | 2 min  |
| 12. Dep resolver edge cases | T2              | Medium   | 10 min |
| 13. Error-path tests        | T1              | Medium   | 10 min |
| 14. Fix PR status bug       | #3 (completion) | Medium   | 10 min |
