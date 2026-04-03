# Agent Manager Class Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the agent manager from a closure-based factory to a class with explicit state, improving testability and fixing the drain/watchdog race condition.

**Architecture:** Replace the closure internals of `createAgentManager()` with an `AgentManagerImpl` class. The factory function still exists and returns `new AgentManagerImpl(...)`. All internal state becomes class properties. A `_processingTasks` Set guards against drain/watchdog races. The 5-method decomposition of `processQueuedTask` is deferred to a follow-up — this plan focuses on the structural refactor + race guard.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 (mocked)

**Spec:** `docs/superpowers/specs/2026-03-27-agent-manager-refactor-design.md`

---

## File Structure

| Action      | File                                                     | Responsibility                                           |
| ----------- | -------------------------------------------------------- | -------------------------------------------------------- |
| **Rewrite** | `src/main/agent-manager/index.ts`                        | Replace closure factory with `AgentManagerImpl` class    |
| **Create**  | `src/main/agent-manager/__tests__/index-methods.test.ts` | Tests for class internal methods and race guard          |
| **Verify**  | `src/main/agent-manager/__tests__/index.test.ts`         | Existing 44 tests must still pass (public API unchanged) |

---

### Task 1: Structural Refactor — Closure to Class

Pure structural refactor. No behavioral changes. All 44 existing tests must pass.

**Files:**

- Rewrite: `src/main/agent-manager/index.ts`
- Verify: `src/main/agent-manager/__tests__/index.test.ts`

- [ ] **Step 1: Read existing tests and source thoroughly**

Read both files to understand:

- `src/main/agent-manager/index.ts` — full 644-line file, all closure state and functions
- `src/main/agent-manager/__tests__/index.test.ts` — how factory is tested, what's mocked
- `src/main/agent-manager/types.ts` — AgentManagerConfig, ActiveAgent interfaces
- `src/main/data/sprint-task-repository.ts` — ISprintTaskRepository interface

- [ ] **Step 2: Create the AgentManagerImpl class**

Rewrite `src/main/agent-manager/index.ts`. The key transformation:

**Keep unchanged at the top of the file (lines 1-216):**

- All imports (lines 1-36)
- Logger helpers: `rotateAmLogIfNeeded`, `fileLog`, `defaultLogger` (lines 37-75)
- Pure exported functions: `checkOAuthToken`, `handleWatchdogVerdict` (lines 85-186)
- Interfaces: `AgentManagerStatus`, `AgentManager` (lines 192-216)

**Replace the factory closure (lines 222-644) with `AgentManagerImpl` class:**

```typescript
export class AgentManagerImpl implements AgentManager {
  // ---- Exposed state (testable via _ prefix, matches _runAgent convention) ----
  _concurrency: ConcurrencyState
  readonly _activeAgents = new Map<string, ActiveAgent>()
  _running = false
  _shuttingDown = false
  _drainRunning = false
  _drainInFlight: Promise<void> | null = null
  readonly _agentPromises = new Set<Promise<void>>()
  readonly _depIndex: DependencyIndex

  // ---- Private (timers) ----
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private orphanTimer: ReturnType<typeof setInterval> | null = null
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  // ---- Injected deps ----
  private readonly runAgentDeps: RunAgentDeps

  constructor(
    readonly config: AgentManagerConfig,
    readonly repo: ISprintTaskRepository,
    readonly logger: Logger = defaultLogger
  ) {
    rotateAmLogIfNeeded()
    this._concurrency = makeConcurrencyState(config.maxConcurrent)
    this._depIndex = createDependencyIndex()
    setSprintQueriesLogger(logger)

    this.runAgentDeps = {
      activeAgents: this._activeAgents,
      defaultModel: config.defaultModel,
      logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      repo
    }
  }

  // ... all closure functions become methods with this.xxx references
}

// Factory preserved
export function createAgentManager(
  config: AgentManagerConfig,
  repo: ISprintTaskRepository,
  logger: Logger = defaultLogger
): AgentManager {
  return new AgentManagerImpl(config, repo, logger)
}
```

**Critical `this` binding details (these are the easy-to-miss gotchas):**

1. **`this.config.onStatusTerminal`** — In `onTaskTerminal()`, the current code references bare `config.onStatusTerminal`. In the class this becomes `this.config.onStatusTerminal`. Easy to miss since `config` is both a constructor param name and a property.

2. **`this._concurrency = tryRecover(...)`** — In `_drainLoop()` line 438, the current code does `concurrency = tryRecover(concurrency, Date.now())`. This looks like a local variable assignment but it's actually mutating closure state. In the class: `this._concurrency = tryRecover(this._concurrency, Date.now())`.

3. **`this.repo.updateTask` passed to `handleWatchdogVerdict`** — In `_watchdogLoop()`, `repo.updateTask` is passed as a bare function reference. Check if the repository implementation uses arrow functions or method syntax. If methods, pass `this.repo.updateTask.bind(this.repo)`. If the repo is a plain object with function properties (which it is — see `sprint-task-repository.ts`), bare reference is fine.

4. **`isActive` callbacks** — `recoverOrphans(isActive, ...)` and `pruneStaleWorktrees(..., isActive)` pass `isActive` as a callback. Use arrow: `(id: string) => this._activeAgents.has(id)` — simpler than binding.

5. **`setInterval` callbacks** — All 4 timers need arrow functions to preserve `this`:

   ```typescript
   this.pollTimer = setInterval(() => { ... this._drainLoop() ... }, this.config.pollIntervalMs)
   ```

6. **`agentPromises` self-reference** — In `_processQueuedTask`, the fire-and-forget pattern `const p = _runAgent(...).finally(() => { agentPromises.delete(p) })` becomes `this._agentPromises.delete(p)`. This works because `p` is a local const and the arrow preserves `this`.

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/index.test.ts`

Expected: All 44 tests PASS.

If tests fail, the most likely issues are:

- `this` binding lost in setInterval callbacks → use arrow functions
- Mock patterns that depend on closure structure → adjust mock targets
- `runAgentDeps` reference timing (built in constructor, `this` is available)

Fix any failures before proceeding.

- [ ] **Step 4: Run extracted tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/index-extracted.test.ts`

Expected: All 16 tests PASS (pure functions unchanged).

- [ ] **Step 5: Run full test suite**

Run: `npm test && npm run test:main`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/index.ts
git commit -m "refactor: convert agent manager from closure factory to class"
```

---

### Task 2: Add Race Guard

Add the `_processingTasks` Set to prevent drain/watchdog conflicts. This is a behavioral change — separate commit from the structural refactor.

**Files:**

- Modify: `src/main/agent-manager/index.ts`

- [ ] **Step 1: Add `_processingTasks` property**

Add to the class (if not already added in Task 1):

```typescript
readonly _processingTasks = new Set<string>()
```

- [ ] **Step 2: Guard `_processQueuedTask`**

At the top of `_processQueuedTask`, before any logic:

```typescript
const taskId = raw.id as string
if (this._processingTasks.has(taskId)) return
this._processingTasks.add(taskId)
try {
  // ... all existing processQueuedTask logic
} finally {
  this._processingTasks.delete(taskId)
}
```

- [ ] **Step 3: Guard `_watchdogLoop`**

At the top of the watchdog's `for` loop, after getting the verdict:

```typescript
for (const agent of this._activeAgents.values()) {
  // Skip if drain loop is mid-processing this task
  if (this._processingTasks.has(agent.taskId)) continue

  const verdict = checkAgent(agent, Date.now(), this.config)
  // ... rest of watchdog logic
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/`

Expected: All existing tests pass (race guard is additive, doesn't break existing paths).

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-manager/index.ts
git commit -m "fix: add drain/watchdog race guard via processingTasks Set"
```

---

### Task 3: Add Race Guard Tests

Write focused tests for the class internals and race guard behavior.

**Files:**

- Create: `src/main/agent-manager/__tests__/index-methods.test.ts`

- [ ] **Step 1: Create test file**

Read `src/main/agent-manager/__tests__/index.test.ts` first to understand mock patterns.

Create `src/main/agent-manager/__tests__/index-methods.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest'

// Mock sub-modules (match pattern from index.test.ts)
vi.mock('../worktree', () => ({
  setupWorktree: vi.fn().mockResolvedValue({ worktreePath: '/tmp/wt', branch: 'agent/test' }),
  pruneStaleWorktrees: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../orphan-recovery', () => ({ recoverOrphans: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../run-agent', () => ({ runAgent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../watchdog', () => ({ checkAgent: vi.fn().mockReturnValue('ok') }))
vi.mock('../../data/sprint-queries', () => ({ setSprintQueriesLogger: vi.fn() }))
vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn().mockReturnValue({ myrepo: '/path/to/repo' }),
  BDE_AGENT_LOG_PATH: '/tmp/test-agent.log'
}))
vi.mock('../../env-utils', () => ({
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(false),
  invalidateOAuthToken: vi.fn()
}))
// Mock fs to prevent real file operations
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return { ...actual, appendFileSync: vi.fn(), statSync: vi.fn().mockReturnValue({ size: 0 }) }
})

import { AgentManagerImpl } from '../index'
import { checkAgent } from '../watchdog'

// Read ISprintTaskRepository to get the full interface shape
function makeRepo() {
  return {
    getTask: vi.fn(),
    updateTask: vi.fn(),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    claimTask: vi.fn().mockReturnValue({ id: 'task-1', status: 'active' }),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    releaseTask: vi.fn(),
    createTask: vi.fn(),
    deleteTask: vi.fn(),
    getQueueStats: vi.fn(),
    getActiveTaskCount: vi.fn()
  }
}

function makeConfig(overrides = {}) {
  return {
    maxConcurrent: 2,
    worktreeBase: '/tmp/worktrees',
    maxRuntimeMs: 3600000,
    idleTimeoutMs: 900000,
    pollIntervalMs: 30000,
    defaultModel: 'claude-sonnet-4-5',
    ...overrides
  }
}

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

describe('AgentManagerImpl internals', () => {
  describe('state visibility', () => {
    it('exposes activeAgents for inspection', () => {
      const am = new AgentManagerImpl(makeConfig(), makeRepo() as any, mockLogger)
      expect(am._activeAgents).toBeInstanceOf(Map)
      expect(am._activeAgents.size).toBe(0)
    })

    it('exposes concurrency state with configured maxSlots', () => {
      const am = new AgentManagerImpl(
        makeConfig({ maxConcurrent: 3 }),
        makeRepo() as any,
        mockLogger
      )
      expect(am._concurrency.maxSlots).toBe(3)
    })
  })

  describe('_processingTasks race guard', () => {
    it('skips task already being processed', async () => {
      const repo = makeRepo()
      const am = new AgentManagerImpl(makeConfig(), repo as any, mockLogger)
      am._processingTasks.add('task-1')

      await am._processQueuedTask({ id: 'task-1', title: 'Test', repo: 'myrepo' }, new Map())

      expect(repo.claimTask).not.toHaveBeenCalled()
    })

    it('cleans up processingTasks after successful completion', async () => {
      const repo = makeRepo()
      const am = new AgentManagerImpl(makeConfig(), repo as any, mockLogger)

      await am._processQueuedTask({ id: 'task-2', title: 'Test', repo: 'myrepo' }, new Map())

      expect(am._processingTasks.has('task-2')).toBe(false)
    })

    it('cleans up processingTasks on thrown error', async () => {
      const repo = makeRepo()
      repo.claimTask.mockImplementation(() => {
        throw new Error('boom')
      })
      const am = new AgentManagerImpl(makeConfig(), repo as any, mockLogger)

      await am._processQueuedTask({ id: 'task-3', title: 'Test', repo: 'myrepo' }, new Map())

      expect(am._processingTasks.has('task-3')).toBe(false)
    })

    it('cleans up when repo path not found (early return)', async () => {
      const repo = makeRepo()
      const am = new AgentManagerImpl(makeConfig(), repo as any, mockLogger)

      await am._processQueuedTask({ id: 'task-4', title: 'Test', repo: 'nonexistent' }, new Map())

      expect(am._processingTasks.has('task-4')).toBe(false)
      expect(repo.claimTask).not.toHaveBeenCalled()
    })

    it('cleans up when claim fails (early return)', async () => {
      const repo = makeRepo()
      repo.claimTask.mockReturnValue(null) // claim fails
      const am = new AgentManagerImpl(makeConfig(), repo as any, mockLogger)

      await am._processQueuedTask({ id: 'task-5', title: 'Test', repo: 'myrepo' }, new Map())

      expect(am._processingTasks.has('task-5')).toBe(false)
    })
  })

  describe('watchdog race guard', () => {
    it('skips agents whose tasks are being processed by drain', () => {
      const repo = makeRepo()
      const am = new AgentManagerImpl(makeConfig(), repo as any, mockLogger)

      // Mock checkAgent to return a kill verdict
      vi.mocked(checkAgent).mockReturnValue('max-runtime')

      // Add a fake active agent
      am._activeAgents.set('task-1', {
        taskId: 'task-1',
        agentRunId: 'run-1',
        handle: { abort: vi.fn(), steer: vi.fn() },
        startedAt: Date.now() - 999999,
        lastOutputAt: Date.now() - 999999,
        model: 'test',
        rateLimitCount: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0
      } as any)

      // Mark task as being processed by drain
      am._processingTasks.add('task-1')

      // Run watchdog
      am._watchdogLoop()

      // Agent should still be active (watchdog skipped it despite max-runtime verdict)
      expect(am._activeAgents.has('task-1')).toBe(true)
      expect((am._activeAgents.get('task-1')!.handle as any).abort).not.toHaveBeenCalled()
    })

    it('kills agents NOT being processed by drain', () => {
      const repo = makeRepo()
      const am = new AgentManagerImpl(makeConfig(), repo as any, mockLogger)

      vi.mocked(checkAgent).mockReturnValue('max-runtime')

      am._activeAgents.set('task-2', {
        taskId: 'task-2',
        agentRunId: 'run-2',
        handle: { abort: vi.fn(), steer: vi.fn() },
        startedAt: Date.now() - 999999,
        lastOutputAt: Date.now() - 999999,
        model: 'test',
        rateLimitCount: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0
      } as any)

      // NOT in processingTasks — watchdog should kill
      am._watchdogLoop()

      expect(am._activeAgents.has('task-2')).toBe(false)
      expect(repo.updateTask).toHaveBeenCalled()
    })
  })
})
```

Note: Read `ISprintTaskRepository` and `ActiveAgent` interfaces to get the exact shapes right. The above is approximate — adjust field names and mock shapes to match the actual interfaces.

- [ ] **Step 2: Run tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/index-methods.test.ts`

Expected: All tests PASS.

- [ ] **Step 3: Run all agent manager tests**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/`

Expected: All tests pass (44 + 16 + new method tests).

- [ ] **Step 4: Commit**

```bash
git add src/main/agent-manager/__tests__/index-methods.test.ts
git commit -m "test: add focused tests for agent manager class internals and race guard"
```

---

### Task 4: Final Verification

- [ ] **Step 1: Run full renderer test suite**

Run: `npm test`
Expected: All pass

- [ ] **Step 2: Run full main process tests**

Run: `npm run test:main`
Expected: All pass

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit if any stragglers**

```bash
git status
# Stage and commit any remaining fixes
```
