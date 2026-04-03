# Sprint 1: Core Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken dependency resolution, agent kill bug, security holes, and crash vectors identified in the full codebase audit.

**Architecture:** Extract a unified `onStatusTerminal()` service that all terminal-status code paths call, ensuring dependency resolution always fires. Fix the agent kill path to use correct identifiers. Harden security defaults and add error boundaries to crash-prone startup code.

**Tech Stack:** TypeScript, Node.js, Vitest, better-sqlite3, Electron IPC

**Spec:** `docs/superpowers/specs/2026-03-27-codebase-audit-sprint-plan.md` (Sprint 1 section)

---

## File Structure

| Action     | File                                                        | Responsibility                                                              |
| ---------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Create** | `src/main/services/task-terminal-service.ts`                | Unified `onStatusTerminal()` — single entry point for dependency resolution |
| **Create** | `src/main/services/__tests__/task-terminal-service.test.ts` | Tests for the new service                                                   |
| **Modify** | `src/main/agent-manager/index.ts:235-241`                   | Replace inline `resolveDependents` call with `onStatusTerminal`             |
| **Modify** | `src/main/handlers/sprint-local.ts:147-199`                 | Call `onStatusTerminal` on terminal status transitions                      |
| **Modify** | `src/main/handlers/git-handlers.ts:99-113`                  | Call `onStatusTerminal` after PR merge/close marks                          |
| **Modify** | `src/main/queue-api/task-handlers.ts:402-415`               | Replace per-request DependencyIndex with shared service                     |
| **Modify** | `src/main/sprint-pr-poller.ts:75-101`                       | Remove legacy `setOnTaskTerminal` pattern                                   |
| **Modify** | `src/main/index.ts:104-147`                                 | Wire service into agent manager, PR poller, IPC handlers                    |
| **Modify** | `src/main/agent-manager/completion.ts:283-296`              | Call `resolveFailure` on push failure                                       |
| **Modify** | `src/renderer/src/hooks/useSprintTaskActions.ts:102-124`    | Fix kill to use correct IPC channel + task ID                               |
| **Modify** | `src/main/env-utils.ts:83`                                  | Set file permissions to `0o600`                                             |
| **Modify** | `src/main/queue-api/helpers.ts:11-19`                       | Auto-generate API key when none configured                                  |
| **Modify** | `src/main/queue-api/router.ts:18-27`                        | Add CORS headers to all responses                                           |
| **Modify** | `src/main/queue-api/helpers.ts:54-57`                       | Add CORS to `sendJson`                                                      |
| **Modify** | `src/main/sprint-pr-poller.ts:62-64`                        | Add `.catch()` to poll calls                                                |
| **Modify** | `src/main/pr-poller.ts:96-98`                               | Add `.catch()` to poll calls                                                |
| **Modify** | `src/main/queue-api/server.ts:40-42`                        | Add `server.on('error')` handler                                            |
| **Modify** | `src/renderer/src/stores/gitTree.ts:65-66`                  | Fix result access pattern                                                   |

---

### Task 1: Extract `onStatusTerminal` Service

The core fix. Create a single service function that wraps dependency resolution, called from all terminal-status paths.

**Files:**

- Create: `src/main/services/task-terminal-service.ts`
- Create: `src/main/services/__tests__/task-terminal-service.test.ts`
- Reference: `src/main/agent-manager/resolve-dependents.ts` (signature)
- Reference: `src/main/agent-manager/dependency-index.ts` (DependencyIndex interface)

- [ ] **Step 1: Create test file with first failing test**

```typescript
// src/main/services/__tests__/task-terminal-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTaskTerminalService } from '../task-terminal-service'
import type { TaskTerminalServiceDeps } from '../task-terminal-service'

function makeDeps(overrides: Partial<TaskTerminalServiceDeps> = {}): TaskTerminalServiceDeps {
  return {
    getTask: vi.fn().mockReturnValue({ id: 't1', status: 'done', depends_on: null, notes: null }),
    updateTask: vi.fn(),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides
  }
}

describe('createTaskTerminalService', () => {
  it('calls resolveDependents when task reaches terminal status', () => {
    const deps = makeDeps({
      getTasksWithDependencies: vi
        .fn()
        .mockReturnValue([{ id: 't2', depends_on: [{ id: 't1', type: 'hard' }] }]),
      getTask: vi.fn().mockImplementation((id: string) => {
        if (id === 't1') return { id: 't1', status: 'done', depends_on: null, notes: null }
        if (id === 't2')
          return {
            id: 't2',
            status: 'blocked',
            depends_on: [{ id: 't1', type: 'hard' }],
            notes: null
          }
        return null
      })
    })
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'done')
    // t2 should be unblocked -> queued
    expect(deps.updateTask).toHaveBeenCalledWith(
      't2',
      expect.objectContaining({ status: 'queued' })
    )
  })

  it('does nothing for non-terminal statuses', () => {
    const deps = makeDeps()
    const service = createTaskTerminalService(deps)
    service.onStatusTerminal('t1', 'active')
    expect(deps.getTasksWithDependencies).not.toHaveBeenCalled()
  })

  it('swallows errors and logs them', () => {
    const deps = makeDeps({
      getTasksWithDependencies: vi.fn().mockImplementation(() => {
        throw new Error('db boom')
      })
    })
    const service = createTaskTerminalService(deps)
    // Should not throw
    service.onStatusTerminal('t1', 'done')
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('db boom'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/__tests__/task-terminal-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the service**

```typescript
// src/main/services/task-terminal-service.ts
import { resolveDependents } from '../agent-manager/resolve-dependents'
import { createDependencyIndex } from '../agent-manager/dependency-index'
import type { DependencyIndex } from '../agent-manager/dependency-index'
import type { SprintTask, TaskDependency } from '../../shared/types'

const TERMINAL_STATUSES = new Set(['done', 'failed', 'error', 'cancelled'])

type TaskSlice = Pick<SprintTask, 'id' | 'status' | 'notes'> & {
  depends_on: TaskDependency[] | null
}

export interface TaskTerminalServiceDeps {
  getTask: (id: string) => TaskSlice | null
  updateTask: (id: string, patch: Record<string, unknown>) => unknown
  getTasksWithDependencies: () => Array<{ id: string; depends_on: TaskDependency[] | null }>
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }
}

export interface TaskTerminalService {
  onStatusTerminal: (taskId: string, status: string) => void
}

export function createTaskTerminalService(deps: TaskTerminalServiceDeps): TaskTerminalService {
  const depIndex: DependencyIndex = createDependencyIndex()

  function rebuildIndex(): void {
    const tasks = deps.getTasksWithDependencies()
    depIndex.rebuild(tasks)
  }

  function onStatusTerminal(taskId: string, status: string): void {
    if (!TERMINAL_STATUSES.has(status)) return
    try {
      rebuildIndex()
      resolveDependents(taskId, status, depIndex, deps.getTask, deps.updateTask, deps.logger)
    } catch (err) {
      deps.logger.error(`[task-terminal-service] resolveDependents failed for ${taskId}: ${err}`)
    }
  }

  return { onStatusTerminal }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/__tests__/task-terminal-service.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/services/task-terminal-service.ts src/main/services/__tests__/task-terminal-service.test.ts
git commit -m "feat: extract onStatusTerminal service for unified dependency resolution"
```

---

### Task 2: Wire Service Into All Terminal Paths

Replace the 3 inconsistent resolution paths with the unified service.

**Files:**

- Modify: `src/main/index.ts:104-147` (create service, pass to consumers)
- Modify: `src/main/agent-manager/index.ts:235-241` (use service instead of inline resolveDependents)
- Modify: `src/main/handlers/sprint-local.ts:147-199` (add terminal check + service call)
- Modify: `src/main/queue-api/task-handlers.ts:402-415` (use service instead of per-request index)
- Modify: `src/main/sprint-pr-poller.ts:62-101` (remove legacy setOnTaskTerminal, use service)
- Reference: `src/main/__tests__/sprint-pr-poller.test.ts` (update test expectations)

- [ ] **Step 1: Write failing test for sprint-local terminal resolution**

Add to `src/main/handlers/__tests__/sprint-local.test.ts` — a test that verifies `sprint:update` with `status: 'done'` calls the terminal service via the setter. Read the existing test file first to match its mock patterns (it uses `vi.mock` for sprint-queries and `safeHandle`).

```typescript
import { setOnStatusTerminal } from '../sprint-local'

it('calls onStatusTerminal when status transitions to a terminal state', async () => {
  const mockOnStatusTerminal = vi.fn()
  setOnStatusTerminal(mockOnStatusTerminal)

  // Mock getTask to return an existing task in 'active' status
  mockGetTask.mockReturnValue({ id: 'task-1', status: 'active', depends_on: null })
  // Mock updateTask to return the updated task
  mockUpdateTask.mockReturnValue({ id: 'task-1', status: 'done' })

  // Invoke the sprint:update handler with terminal status
  await handlers['sprint:update'](null, 'task-1', { status: 'done' })

  expect(mockOnStatusTerminal).toHaveBeenCalledWith('task-1', 'done')

  // Cleanup
  setOnStatusTerminal(() => {})
})
```

Note: The exact handler invocation pattern depends on how the test file accesses registered handlers. Read the test file to find the correct pattern (it may use a `handlers` map or call `safeHandle` mock directly).

- [ ] **Step 2: Update `src/main/index.ts` to create and wire the service**

In `src/main/index.ts`, after the agent manager setup block (~line 119-147):

```typescript
import { createTaskTerminalService } from './services/task-terminal-service'
import { getTask, updateTask, getTasksWithDependencies } from './data/sprint-queries'
import { createLogger } from './logger'

// Create shared terminal service (used by agent manager, IPC, queue API, PR poller)
const terminalServiceLogger = createLogger('task-terminal')
const terminalService = createTaskTerminalService({
  getTask,
  updateTask,
  getTasksWithDependencies,
  logger: terminalServiceLogger
})
```

Pass `terminalService.onStatusTerminal` to:

1. Agent manager config (replace inline `resolveDependents` call)
2. Sprint PR poller (via `onTaskTerminal` dep)
3. Sprint local handlers (via setter or parameter)

- [ ] **Step 3: Update agent manager `index.ts` to accept external `onStatusTerminal`**

In `src/main/agent-manager/index.ts`, replace the inline `onTaskTerminal` function (lines 235-241):

```typescript
// Before (inline):
async function onTaskTerminal(taskId: string, status: string): Promise<void> {
  try {
    resolveDependents(taskId, status, depIndex, repo.getTask, repo.updateTask, logger)
  } catch (err) {
    logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
  }
}

// After (delegating to service):
async function onTaskTerminal(taskId: string, status: string): Promise<void> {
  config.onStatusTerminal?.(taskId, status)
}
```

Add `onStatusTerminal?: (taskId: string, status: string) => void` to the agent manager config type.

- [ ] **Step 4: Update sprint-local.ts to call service on terminal transitions**

In `src/main/handlers/sprint-local.ts`, add a module-level setter and call it after `updateTask`:

```typescript
import { createLogger } from '../logger'

const logger = createLogger('sprint-local')
const TERMINAL_STATUSES = new Set(['done', 'failed', 'error', 'cancelled'])

let _onStatusTerminal: ((taskId: string, status: string) => void) | null = null

export function setOnStatusTerminal(fn: (taskId: string, status: string) => void): void {
  _onStatusTerminal = fn
}

// Inside the sprint:update handler, after the updateTask call:
// if (patch.status && TERMINAL_STATUSES.has(patch.status as string)) {
//   _onStatusTerminal?.(id, patch.status as string)
// }
```

- [ ] **Step 5: Update queue API task-handlers.ts to use service**

In `src/main/queue-api/task-handlers.ts`, replace lines 402-415:

```typescript
// Before: creates fresh DependencyIndex per request
// After: use injected service

let _onStatusTerminal: ((taskId: string, status: string) => void) | null = null

export function setQueueApiOnStatusTerminal(fn: (taskId: string, status: string) => void): void {
  _onStatusTerminal = fn
}

// Replace the inline resolveDependents block with:
// if (patch.status && TERMINAL_STATUSES.has(patch.status)) {
//   _onStatusTerminal?.(id, patch.status)
// }
```

Remove the now-unused imports: `resolveDependents`, `createDependencyIndex`, `getTasksWithDependencies`.

- [ ] **Step 6: Wire sprint PR poller directly**

In `src/main/index.ts`, change the sprint PR poller startup to use the service:

```typescript
// Before:
startSprintPrPoller()

// After:
import { setOnTaskTerminal, startSprintPrPoller } from './sprint-pr-poller'
setOnTaskTerminal(terminalService.onStatusTerminal)
startSprintPrPoller()
```

- [ ] **Step 7: Wire sprint-local and queue API setters in index.ts**

```typescript
import { setOnStatusTerminal } from './handlers/sprint-local'
import { setQueueApiOnStatusTerminal } from './queue-api/task-handlers'

setOnStatusTerminal(terminalService.onStatusTerminal)
setQueueApiOnStatusTerminal(terminalService.onStatusTerminal)
```

- [ ] **Step 8: Fix `pr:pollStatuses` IPC handler to trigger resolution**

In `src/main/handlers/git-handlers.ts`, the `pr:pollStatuses` handler (lines 99-113) calls `markTaskDoneByPrNumber` / `markTaskCancelledByPrNumber` which are direct SQLite writes that bypass dependency resolution. This is a **separate code path** from the sprint-pr-poller timer — it's called by the renderer's PR Station polling.

Add `setOnStatusTerminal` setter to git-handlers and wire it in index.ts:

```typescript
// In git-handlers.ts — add at module level:
let _onStatusTerminal: ((taskId: string, status: string) => void) | null = null

export function setGitHandlersOnStatusTerminal(fn: (taskId: string, status: string) => void): void {
  _onStatusTerminal = fn
}

// Inside the pr:pollStatuses handler, after markTaskDoneByPrNumber/markTaskCancelledByPrNumber:
if (result.merged) {
  const ids = await markTaskDoneByPrNumber(prNumber)
  for (const id of ids) _onStatusTerminal?.(id, 'done')
} else if (result.state === 'CLOSED') {
  const ids = await markTaskCancelledByPrNumber(prNumber)
  for (const id of ids) _onStatusTerminal?.(id, 'cancelled')
}
```

Note: Check that `markTaskDoneByPrNumber` returns task IDs — if it currently returns `void`, you'll need to modify it to return the affected IDs (or query them before the update).

In `src/main/index.ts`, add:

```typescript
import { setGitHandlersOnStatusTerminal } from './handlers/git-handlers'
setGitHandlersOnStatusTerminal(terminalService.onStatusTerminal)
```

- [ ] **Step 9: Run all tests**

Run: `npm test && npm run test:main`
Expected: All existing tests pass. Fix any broken mocks from the refactor.

- [ ] **Step 10: Commit**

```bash
git add src/main/index.ts src/main/agent-manager/index.ts src/main/handlers/sprint-local.ts src/main/handlers/git-handlers.ts src/main/queue-api/task-handlers.ts src/main/sprint-pr-poller.ts
git commit -m "feat: wire onStatusTerminal service into all terminal-status paths"
```

---

### Task 3: Fix Push Failure in Completion Handler

When `git push` fails, the task stays `active` forever. It should transition to `error` and trigger dependency resolution.

**Files:**

- Modify: `src/main/agent-manager/completion.ts:283-296`
- Modify: `src/main/agent-manager/__tests__/completion.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/main/agent-manager/__tests__/completion.test.ts`:

```typescript
it('calls onTaskTerminal with error status when git push fails', async () => {
  // Mock execFile to throw on git push
  // Verify onTaskTerminal is called with (taskId, 'error')
  // Verify repo.updateTask is called with status: 'error'
})
```

Check existing test patterns in `completion.test.ts` for the mock setup (it likely mocks `child_process` and uses `ResolveSuccessOpts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/agent-manager/__tests__/completion.test.ts -t "push fails"`
Expected: FAIL

- [ ] **Step 3: Fix the push failure path**

In `src/main/agent-manager/completion.ts`, replace lines 283-296:

```typescript
// Before:
} catch (err) {
  logger.error(`[completion] git push failed for task ${taskId} (branch ${branch}): ${err}`)
  try {
    repo.updateTask(taskId, { notes: `git push failed for branch ${branch}: ${err}` })
  } catch (e) {
    logger.warn(`[completion] Failed to update task ${taskId} after push error: ${e}`)
  }
  return
}

// After:
} catch (err) {
  logger.error(`[completion] git push failed for task ${taskId} (branch ${branch}): ${err}`)
  try {
    repo.updateTask(taskId, {
      status: 'error',
      notes: `git push failed for branch ${branch}: ${err}`,
      claimed_by: null,
      completed_at: new Date().toISOString()
    })
  } catch (e) {
    logger.warn(`[completion] Failed to update task ${taskId} after push error: ${e}`)
  }
  await onTaskTerminal(taskId, 'error')
  return
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/agent-manager/__tests__/completion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/completion.ts src/main/agent-manager/__tests__/completion.test.ts
git commit -m "fix: transition task to error on push failure, trigger dependency resolution"
```

---

### Task 4: Fix Agent Kill Bug

The UI calls `agent:kill` with `agent_run_id`, but the AgentManager indexes active agents by `taskId`. Pipeline agents can't be stopped.

**Files:**

- Modify: `src/renderer/src/hooks/useSprintTaskActions.ts:102-124`
- Modify: `src/renderer/src/hooks/__tests__/useSprintTaskActions.test.ts` (if exists, or create)

- [ ] **Step 1: Write/update test for handleStop**

Check if `src/renderer/src/hooks/__tests__/useSprintTaskActions.test.ts` exists. If so, add a test. If not, test via the component that uses the hook or add a focused unit test.

The test should verify that `handleStop` calls `window.api.agentManager.kill(task.id)` — NOT `window.api.killAgent(task.agent_run_id)`.

- [ ] **Step 2: Fix the kill call**

In `src/renderer/src/hooks/useSprintTaskActions.ts`, replace lines 111-112:

```typescript
// Before:
const result = await window.api.killAgent(task.agent_run_id)

// After:
const result = await window.api.agentManager.kill(task.id)
```

Also remove the early return on line 104: `if (!task.agent_run_id) return` — the task ID is always available, so the guard should check for an active agent state instead:

```typescript
// Before:
if (!task.agent_run_id) return

// After:
if (task.status !== 'active') return
```

- [ ] **Step 3: Verify the `agent-manager:kill` IPC channel exists**

Check `src/main/handlers/agent-manager-handlers.ts` for the `agent-manager:kill` handler and confirm it calls `am.killAgent(taskId)` with the task ID. Also check `src/preload/index.ts` and `src/preload/index.d.ts` for `agentManager.kill`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useSprintTaskActions.ts
git commit -m "fix: use task ID with agent-manager:kill to stop pipeline agents"
```

---

### Task 5: OAuth Token File Permissions

**Files:**

- Modify: `src/main/env-utils.ts:83`
- Modify: `src/main/__tests__/env-utils.test.ts`

- [ ] **Step 1: Add test for file permissions**

In `src/main/__tests__/env-utils.test.ts`, add `writeFileSync` to the mock and test:

```typescript
import { writeFileSync } from 'node:fs'

describe('refreshOAuthTokenFromKeychain', () => {
  it('writes token file with 0o600 permissions', async () => {
    // Mock security CLI to return valid token JSON
    // Call refreshOAuthTokenFromKeychain()
    // Verify writeFileSync was called with { encoding: 'utf8', mode: 0o600 }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/__tests__/env-utils.test.ts`
Expected: FAIL — writeFileSync called with 'utf8' string, not options object

- [ ] **Step 3: Fix the write call**

In `src/main/env-utils.ts`, line 83:

```typescript
// Before:
writeFileSync(tokenPath, token, 'utf8')

// After:
writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/__tests__/env-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/env-utils.ts src/main/__tests__/env-utils.test.ts
git commit -m "fix: write OAuth token file with owner-only permissions (0o600)"
```

---

### Task 6: Queue API Auth — Auto-Generate Key

**Files:**

- Modify: `src/main/queue-api/helpers.ts:11-19`
- Modify: `src/main/queue-api/__tests__/queue-api.test.ts` (update auth tests)

- [ ] **Step 1: Write failing test**

Add test that verifies: when no API key is configured, `checkAuth` rejects requests (returns false) instead of allowing them. Also test that a key is auto-generated and stored.

- [ ] **Step 2: Implement auto-generation**

In `src/main/queue-api/helpers.ts`:

```typescript
import { randomBytes } from 'node:crypto'
import { getSetting, setSetting } from '../settings'

function getApiKey(): string {
  const existing = getSetting('taskRunner.apiKey') ?? process.env['SPRINT_API_KEY']
  if (existing) return existing

  // Auto-generate on first access
  const generated = randomBytes(32).toString('hex')
  setSetting('taskRunner.apiKey', generated)
  return generated
}
```

Change return type from `string | null` to `string` — it always returns a key now.

Remove the early-return in `checkAuth`:

```typescript
export function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const apiKey = getApiKey()
  // apiKey is always set (auto-generated if missing)
  // ... rest of auth logic unchanged
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/main/queue-api/__tests__/queue-api.test.ts`
Expected: Some existing tests may need updated mocks (they may rely on no-auth behavior). Fix accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/main/queue-api/helpers.ts src/main/queue-api/__tests__/queue-api.test.ts
git commit -m "fix: auto-generate Queue API key when none configured"
```

---

### Task 7: CORS Headers on All Responses

**Files:**

- Modify: `src/main/queue-api/helpers.ts:54-57` (sendJson)
- Modify: `src/main/queue-api/router.ts:18-27` (preflight)

- [ ] **Step 1: Add CORS headers to `sendJson`**

In `src/main/queue-api/helpers.ts`:

```typescript
// Before:
export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

// After:
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type'
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS })
  res.end(JSON.stringify(body))
}
```

- [ ] **Step 2: Update preflight to use shared constant**

In `src/main/queue-api/router.ts`, import `CORS_HEADERS` from helpers and use it in the OPTIONS handler. Also add `DELETE` to allowed methods.

- [ ] **Step 3: Add CORS headers to SSE responses too**

Check `src/main/queue-api/event-handlers.ts` for SSE response headers — add CORS headers there as well.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/main/queue-api/__tests__/queue-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/queue-api/helpers.ts src/main/queue-api/router.ts src/main/queue-api/event-handlers.ts
git commit -m "fix: add CORS headers to all Queue API responses, not just OPTIONS"
```

---

### Task 8: Poller Crash Prevention

**Files:**

- Modify: `src/main/sprint-pr-poller.ts:62-64`
- Modify: `src/main/pr-poller.ts:96-98`
- Modify: `src/main/__tests__/sprint-pr-poller.test.ts` (verify no unhandled rejection)

- [ ] **Step 1: Fix sprint PR poller**

In `src/main/sprint-pr-poller.ts`, add a `safePoll` wrapper and use it in `start()`:

```typescript
// Add inside createSprintPrPoller, after the poll() function definition:
function safePoll(): void {
  poll().catch(err => console.error('[sprint-pr-poller] poll error:', err))
}

// Replace the start() method:
// Before:
start() {
  poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)
},

// After:
start() {
  safePoll()
  timer = setInterval(safePoll, POLL_INTERVAL_MS)
},
```

- [ ] **Step 2: Fix PR poller**

In `src/main/pr-poller.ts`, same pattern:

```typescript
// Add near the top of the module, after poll() is defined:
function safePoll(): void {
  poll().catch((err) => console.error('[pr-poller] poll error:', err))
}

// Replace startPrPoller():
// Before:
export function startPrPoller(): void {
  poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)
}

// After:
export function startPrPoller(): void {
  safePoll()
  timer = setInterval(safePoll, POLL_INTERVAL_MS)
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/main/__tests__/sprint-pr-poller.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/sprint-pr-poller.ts src/main/pr-poller.ts
git commit -m "fix: catch unhandled promise rejections in poller start() calls"
```

---

### Task 9: Queue API Port Conflict Handler

**Files:**

- Modify: `src/main/queue-api/server.ts:40-42`

- [ ] **Step 1: Add error handler**

In `src/main/queue-api/server.ts`, after `server = http.createServer(...)` and before `server.listen(...)`:

```typescript
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(
      `Port ${port} is already in use — Queue API not started. Is another BDE instance running?`
    )
  } else {
    logger.error(`Queue API server error: ${err.message}`)
  }
  server = null
})

server.listen(port, host, () => {
  logger.info(`Listening on http://${host}:${port}`)
})
```

- [ ] **Step 2: Run tests**

Run: `npm run test:main`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/queue-api/server.ts
git commit -m "fix: handle EADDRINUSE gracefully in Queue API startup"
```

---

### Task 10: ~~Fix gitStatus Result Access~~ REMOVED

**Status:** Removed after review. The `git:status` IPC handler at `src/main/handlers/git-handlers.ts:67-74` already unwraps the `Result<T>` envelope — it returns `result.data` (which is `{ files: GitFileStatus[] }`) on success, or `{ files: [] }` on error. The store's `result?.files ?? []` access is correct for this behavior. The original audit finding was based on a stale reading.

No action needed.

---

### Task 11: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All renderer tests pass

- [ ] **Step 2: Run main process tests**

Run: `npm run test:main`
Expected: All main process tests pass

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No new lint errors

- [ ] **Step 5: Final commit if any stragglers**

```bash
git status
# Stage any remaining changes
git commit -m "chore: Sprint 1 cleanup — all core safety fixes verified"
```
