# Terminal Handler Reliability

**Date:** 2026-04-13  
**Status:** Draft  
**Audit IDs:** F-t1-amgr-6 (idempotency), F-t1-amgr-7 (dep index scatter)  
**Effort:** S — two surgical changes, same two files  
**Dependencies:** None. No external API changes, no IPC surface changes.

## Problem

Two independent correctness issues in the agent-manager terminal path.

### 1 — Idempotency guard has a 10-second eviction race

`_terminalCalled` is a `Set<string>`. When `handleTaskTerminal` is called for a task it already contains, the second call is silently dropped and the caller gets `undefined` back. The entry is evicted by a `setTimeout(10_000)` — not in the `finally` block.

**Race scenario:** watchdog kills an agent at t=0. The completion handler also fires at t=2s (before the agent handle fully settles). Both call `onTaskTerminal`. The first call adds the taskId to the set and starts async work (dep resolution, metrics). At t=10s the set entry is deleted. If either async path is still in-flight at t=10s — possible under DB load — a third caller can slip through and run resolution twice. Under higher concurrency (>3 agents) this window widens.

**Separate issue:** the silent drop means the caller of the duplicate gets back a resolved promise immediately, with no way to know resolution is still in-flight. This is fine for the watchdog (fire-and-forget) but is brittle for anything that awaits the result.

### 2 — Dep index rebuilt in the terminal handler (redundant O(n) DB query)

`resolveTerminalDependents` in `terminal-handler.ts` does a full `depIndex.rebuild(freshTasks)` before calling `resolveDependents`. This requires a `repo.getTasksWithDependencies()` DB read — O(n) tasks — on **every agent completion**.

The drain loop already calls `_refreshDependencyIndex()` at the start of every tick, keeping the dep-index current. The terminal rebuild was added defensively to pick up tasks created after the last drain tick, but:

- The dep-index is at most one poll interval (a few seconds) stale when the terminal fires.
- Any dependency edge missed during terminal resolution is caught on the next drain tick, which runs `_refreshDependencyIndex()` and then processes queued tasks.
- The redundant rebuild can race with the drain loop's own refresh when multiple agents complete close together.

## Solution

### Change 1 — `Set<string>` → `Map<string, Promise<void>>`

Replace the set-plus-timer pattern with an in-flight promise map. Duplicate callers receive the same promise as the first caller; the entry is deleted in `finally` the moment work completes (no timer).

**`terminal-handler.ts` — `TerminalHandlerDeps`:**
```typescript
// Before
terminalCalled: Set<string>

// After
terminalCalled: Map<string, Promise<void>>
```

**`terminal-handler.ts` — `handleTaskTerminal`:**
```typescript
export async function handleTaskTerminal(
  taskId: string,
  status: string,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  deps: TerminalHandlerDeps
): Promise<void> {
  const existing = deps.terminalCalled.get(taskId)
  if (existing) {
    deps.logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId} — returning in-flight promise`)
    return existing
  }

  const work = executeTerminal(taskId, status, onTaskTerminal, deps)
  deps.terminalCalled.set(taskId, work)
  try {
    await work
  } finally {
    deps.terminalCalled.delete(taskId)
  }
}

async function executeTerminal(
  taskId: string,
  status: string,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  deps: TerminalHandlerDeps
): Promise<void> {
  recordTerminalMetrics(status, deps.metrics)
  if (deps.config.onStatusTerminal) {
    deps.config.onStatusTerminal(taskId, status)
  } else {
    await resolveTerminalDependents(taskId, status, deps.depIndex, deps.epicIndex, deps.repo, onTaskTerminal, deps.logger)
  }
}
```

**`index.ts` — field declaration:**
```typescript
// Before
private readonly _terminalCalled = new Set<string>()

// After
private readonly _terminalCalled = new Map<string, Promise<void>>()
```

The `TerminalHandlerDeps` interface is the only external boundary; all callers pass `this._terminalCalled` which now satisfies `Map<string, Promise<void>>`.

### Change 2 — Remove terminal rebuild, add dirty flag

Remove `depIndex.rebuild(freshTasks)` from `resolveTerminalDependents`. The terminal handler calls `resolveDependents` with the current index (refreshed by the most recent drain tick). This is correct: the dep-index is at most one poll interval stale, and the next drain tick catches any edges missed.

Add `_depIndexDirty: boolean` to `AgentManagerImpl`. The terminal path sets it; the drain loop checks it and performs a **full rebuild** (not incremental) on the next tick, then clears it.

**Why full rebuild on dirty?** The incremental `refreshDependencyIndex` skips tasks whose dep fingerprint hasn't changed. A newly created task (created between the last drain tick and the terminal event) has no cached fingerprint, so it would be added anyway. But to be safe and explicit — "something changed that might have been missed" — a full rebuild on the first dirty drain tick is more conservative and only happens at most once per completion cluster.

**`terminal-handler.ts` — `resolveTerminalDependents` (simplified):**
```typescript
async function resolveTerminalDependents(
  taskId: string,
  status: string,
  depIndex: DependencyIndex,
  epicIndex: EpicDependencyIndex,
  repo: ISprintTaskRepository,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  logger: Logger
): Promise<void> {
  // No longer rebuilds the dep index here.
  // The index was last refreshed by the drain loop and is fresh enough
  // for resolution. The next drain tick will perform a full rebuild if
  // _depIndexDirty is set by the caller.
  try {
    resolveDependents(taskId, status, depIndex, repo.getTask, repo.updateTask, logger,
      getSetting, epicIndex, repo.getGroup, repo.getGroupTasks, undefined, onTaskTerminal)
  } catch (err) {
    logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
  }
}
```

**`index.ts` — new field and updated paths:**
```typescript
private _depIndexDirty = false

// In onTaskTerminal, after handleTaskTerminal resolves:
async onTaskTerminal(taskId: string, status: string): Promise<void> {
  await handleTaskTerminal(taskId, status, this.onTaskTerminal.bind(this), { ... })
  this._depIndexDirty = true
}

// In _drainLoop, replace the single refreshDependencyIndex call:
let taskStatusMap: Map<string, string>
if (this._depIndexDirty) {
  const allTasks = this.repo.getTasksWithDependencies()
  this._depIndex.rebuild(allTasks)
  this._lastTaskDeps.clear()
  for (const task of allTasks) {
    const deps = task.depends_on ?? null
    this._lastTaskDeps.set(task.id, { deps, hash: computeDepsFingerprint(deps) })
  }
  taskStatusMap = new Map(allTasks.map((t) => [t.id, t.status]))
  this._depIndexDirty = false
} else {
  taskStatusMap = this._refreshDependencyIndex()
}
```

## Files to Change

| File | Change |
|------|--------|
| `src/main/agent-manager/terminal-handler.ts` | `TerminalHandlerDeps.terminalCalled` type; `handleTaskTerminal` logic; remove `depIndex.rebuild` from `resolveTerminalDependents` |
| `src/main/agent-manager/index.ts` | `_terminalCalled` field type; add `_depIndexDirty` field; set dirty in `onTaskTerminal`; drain loop dirty-flag branch |

## Tests to Update

**`src/main/agent-manager/__tests__/index.test.ts`** — `onTaskTerminal` suite (line ~1073):

- `'guards against duplicate invocation'` — behaviour is preserved (resolveDependents called once); update log assertion to match the exact new message: `'[agent-manager] onTaskTerminal duplicate for task-1 — returning in-flight promise'`.
- Add: `'duplicate call returns same promise as in-flight first call'` — call `onTaskTerminal` twice without awaiting the first; both should resolve and resolveDependents should be called once.
- Add: `'_depIndexDirty set to true after terminal'` — assert `mgr._depIndexDirty === true` after `onTaskTerminal`.
- Add: `'drain loop does full rebuild when _depIndexDirty'` — set `_depIndexDirty = true`, run `_drainLoop`, assert `depIndex.rebuild` was called and `_depIndexDirty === false` after.

No new test files needed. No renderer tests affected.

## How to Test

```bash
npm run test:main        # main-process integration tests
npm test                 # full unit suite
npm run typecheck        # zero errors required
```

Verify manually: run BDE with 2+ concurrent agents, let them complete simultaneously, confirm no "duplicate" warnings escalate to errors in `~/.bde/bde.log`.
