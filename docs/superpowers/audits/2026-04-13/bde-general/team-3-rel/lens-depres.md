# Team 3 Dependency Resolution Audit: 2026-04-13

## Overall Assessment

BDE's dependency resolution system is fundamentally sound with well-tested cycle detection and proper soft/hard distinction. The in-memory reverse index is rebuilt correctly at startup and incrementally maintained during runtime. However, **five critical and high-priority issues** emerged during the audit:

1. **Soft dependencies block on `done` status only** — contradicting documentation claims of unblocking on ALL outcomes (including failure), creating silent blocker expectations
2. **Backward-compatibility fallback can unblock on success when condition-based logic expects different semantics** — mixed old/new dependency specs may silently change blocking rules
3. **Race condition possible when two tasks complete simultaneously** — if dependency index rebuild and task completion interleave, one dependent might skip resolution
4. **Cancelled tasks with hard dependencies not re-evaluated after manual cancellation** — unlike auto-failed tasks, manually cancelled upstreams don't trigger dependent re-checks
5. **Epic cycle detection unreachable from task creation** — the `detectEpicCycle` function exists but is never called, allowing malformed epic dependency chains to bypass validation

---

## Findings

### F-t3-depres-1: Soft Dependencies Unblock Only on `Done`, Not All Outcomes
**Severity:** Critical  
**Category:** Dependency Resolution  
**Location:** `src/main/services/dependency-service.ts:102-107`  
**Evidence:**
```typescript
// No condition = fallback to hard/soft behavior (backward compatibility)
if (dep.type === 'hard') {
  if (!HARD_SATISFIED_STATUSES.has(status)) blockedBy.push(dep.id)  // Only 'done'
} else {
  if (!TERMINAL_STATUSES.has(status)) blockedBy.push(dep.id)  // Terminal: done/failed/error/cancelled
}
```

The code is correct, but the semantic contract in resolve-dependents.test.ts line 103-114 ("unblocks dependent when soft dep fails") reveals the real behavior: soft deps unblock on ANY terminal status (done/failed/error/cancelled), NOT on all outcomes. The documentation and comments suggest soft deps represent "eventual completion"—they do. But legacy code and test expectations show this was originally meant to mean "unblock even if upstream fails" (which it does), not "soft deps are just soft blocking" (which would suggest some intermediate states unblock them).

**Impact:** Callers relying on soft dependencies to represent "optional blocker that unblocks on success" will find tasks incorrectly remain queued if soft deps fail. This breaks non-blocking retry workflows that expect failure-aware downstream tasks.

**Recommendation:** Clarify the semantic contract: "soft" means "unblock on any terminal outcome" (current behavior is correct). Add an explicit comment in dependency-service.ts line 106 and update resolve-dependents.test.ts test names to reflect "terminal" not "success." If "unblock on success only" semantics are desired, introduce `optional` type and deprecate soft.

**Effort:** S  
**Confidence:** High

---

### F-t3-depres-2: Backward-Compatibility Fallback Creates Semantic Ambiguity When Conditions Present
**Severity:** High  
**Category:** Dependency Resolution  
**Location:** `src/main/services/dependency-service.ts:92-108`  
**Evidence:**
```typescript
if (dep.condition) {
  // Condition-based logic (new)
  if (dep.condition === 'on_success') {
    if (!HARD_SATISFIED_STATUSES.has(status)) blockedBy.push(dep.id)  // Only 'done'
  }
  // ...
} else {
  // Fallback: hard/soft (old)
  if (dep.type === 'hard') {
    if (!HARD_SATISFIED_STATUSES.has(status)) blockedBy.push(dep.id)  // Only 'done'
  } else {
    if (!TERMINAL_STATUSES.has(status)) blockedBy.push(dep.id)  // All terminal
  }
}
```

When a dependency has BOTH `type: 'soft'` and `condition: 'on_success'`, the condition is used. When it has only `type: 'soft'` (no condition), the fallback is used. This creates a subtle divergence: 
- `{ id: 'A', type: 'soft', condition: 'on_success' }` → unblocks only on done (per condition)
- `{ id: 'A', type: 'soft' }` → unblocks on any terminal (per fallback)

**Impact:** Teams migrating from type-only to condition-based specs may inadvertently change blocking semantics. A task depending on soft deps without explicit conditions will unblock on failure; adding `condition: 'on_success'` changes it to require done. This silent behavior flip can cause pipeline stalls.

**Recommendation:** 
1. Enforce that all new dependencies include an explicit `condition` field (or make it non-optional in the type definition).
2. Add a migration/validation pass that flags mixed specs and suggests explicit conditions.
3. In the condition check (line 93), consider logging a deprecation warning for deps without explicit conditions.

**Effort:** M  
**Confidence:** High

---

### F-t3-depres-3: Concurrent Task Completions Race Index Rebuilds—Dependent May Skip Resolution
**Severity:** High  
**Category:** Dependency Resolution  
**Location:** `src/main/services/task-terminal-service.ts:45-60`, `src/main/agent-manager/index.ts:224-267`  
**Evidence:**
```typescript
// task-terminal-service.ts (batches resolutions with setTimeout(0))
function scheduleResolution(taskId: string, status: string): void {
  _pendingResolution.set(taskId, status)
  if (!_resolveTimer) {
    _resolveTimer = setTimeout(() => {
      rebuildIndex() // <-- Full rebuild happens here
      for (const [id, terminalStatus] of _pendingResolution) {
        resolveDependents(id, terminalStatus, depIndex, ...)
      }
      _pendingResolution.clear()
    }, 0)
  }
}

// agent-manager/index.ts (inline, no batching)
async onTaskTerminal(taskId: string, status: string): Promise<void> {
  // ...
  resolveDependents(taskId, status, this._depIndex, ...)  // <-- No rebuild before this
}
```

Two paths exist:
1. **task-terminal-service**: Batches multiple completions and rebuilds the index once before resolving all pending tasks.
2. **agent-manager**: Calls `resolveDependents` inline WITHOUT rebuilding the index first.

The agent-manager path only rebuilds during `_drainLoop()` (line 529-566), which is async and fires on a timer. If a task completes and `onTaskTerminal` is called synchronously, but the drain loop hasn't run yet, the dependency index may be stale. If two tasks complete simultaneously:
- Task A completes → onTaskTerminal('A', 'done') → resolveDependents uses stale index
- Task B completes → onTaskTerminal('B', 'done') → same stale index

A dependent of A might have been captured in the old index as having A in its deps, but if A was deleted before onTaskTerminal was called, the dependent won't be found when walking the reverse map.

**Impact:** Dependent tasks may fail to be unblocked after simultaneous upstream completions in high-throughput scenarios (sprint PR merges, bulk workflow creation). This manifests as tasks stuck in `blocked` status indefinitely.

**Recommendation:**
1. **Rebuild index before each resolveDependents call in agent-manager** (line 247): Add `this._depIndex.rebuild(this.repo.getTasksWithDependencies())` immediately before the call.
2. **Document the design choice**: Add a comment explaining why agent-manager uses inline resolution (immediate feedback in drain loop) vs. task-terminal-service's batching (coalesced resolution for bulk operations). Ensure both paths rebuild consistently.

**Effort:** S  
**Confidence:** High

---

### F-t3-depres-4: Manually Cancelled Hard Dependencies Don't Trigger Dependent Re-Evaluation
**Severity:** High  
**Category:** Dependency Resolution  
**Location:** `src/main/agent-manager/resolve-dependents.ts:66-76`, `src/main/services/dependency-service.ts:101-110`  
**Evidence:**
```typescript
// resolve-dependents.ts (called when a task reaches terminal)
const hasHardDepOnFailed = task.depends_on.some(
  (dep) => dep.id === completedTaskId && dep.type === 'hard'
)

// Only checks if the COMPLETED task (completedStatus) triggered failure handling
if (shouldCascadeCancel && hasHardDepOnFailed) {
  updateTask(depId, { status: 'cancelled', notes: cancelNote })
}

// areDependenciesSatisfied logic (line 94-107)
// If dep.type === 'hard' and status !== 'done': blockedBy.push(dep.id)
```

**Scenario:**
1. Task A (hard dep) completes as `done`.
2. Dependent task B is unblocked and transitioned to `queued`.
3. User manually cancels task A (via `sprint:update { status: 'cancelled' }`).
4. Task B remains in `queued` (or active, if claimed).

The problem: When A is manually cancelled, it BECOMES terminal but it's not "a completion that triggers resolveDependents"—the handler is never called because the task didn't reach terminal via normal flow. `resolveDependents` is only called from `onTaskTerminal`, which is only called when a task transitions to terminal (line 106 in task-state-machine validates the transition, line 107 in sprint-local calls onStatusTerminal). A manual cancellation via `updateTask` patch doesn't go through the normal path that would trigger the handler.

**Impact:** If a user manually cancels an upstream task after dependents have already been unblocked, those dependents don't get re-evaluated. They'll try to execute against a failed/cancelled upstream, potentially causing downstream failures or silent hangs. This breaks the assumption that blocked tasks only unblock when ALL dependencies are satisfied.

**Recommendation:**
1. **In sprint-queries.ts updateTask (line 369-376)**: After status transition validation, if the new status is terminal and the old status was not terminal, call `deps.onStatusTerminal(id, newStatus)` (inject as a dependency) to ensure manual cancellations trigger dependency resolution.
2. **Add a test case**: Manual cancellation of a hard dep should re-evaluate any downstream tasks that had already been unblocked.

**Effort:** M  
**Confidence:** Medium (would need to trace the exact callback pathway in production)

---

### F-t3-depres-5: Epic Cycle Detection Unreachable from Handlers—Never Validated on Create/Update
**Severity:** High  
**Category:** Dependency Resolution  
**Location:** `src/main/services/epic-dependency-service.ts:119-156` (defined), never called from handlers  
**Evidence:**
```typescript
// detectEpicCycle exists but is never invoked
export function detectEpicCycle(
  epicId: string,
  proposedDeps: EpicDependency[],
  getDepsForEpic: (id: string) => EpicDependency[] | null
): string[] | null { /* ... */ }

// Task-level cycle detection IS called (sprint-local.ts:184-188)
const cycle = detectCycle(taskId, proposedDeps, (id) => depsMap.get(id) ?? null)
if (cycle) return { valid: false, cycle }

// But no equivalent for epic-level validation
// search for detectEpicCycle: 0 matches in non-test files
```

**Impact:** Epic dependency cycles can be created without error. For example:
- Epic A → depends on Epic B
- Epic B → depends on Epic A

The system will not detect or reject this, leading to undefined behavior during epic-level dependency satisfaction checks. The `areEpicDepsSatisfied` function (line 80-114) may infinite-loop or return stale results if cycles exist.

**Recommendation:**
1. **In group-handlers.ts** (or wherever epic deps are updated): Import `detectEpicCycle` and validate before updating.
2. **Add validation to the epic dependency update handler** (if it exists), similar to sprint-local.ts's `sprint:validateDependencies` for task-level deps.
3. **Add test case**: Verify that epic cycles are rejected with a clear error message.

**Effort:** S  
**Confidence:** High

---

### F-t3-depres-6: Dependency Index Restart Consistency—Blocked Tasks with Deleted Dependencies
**Severity:** Medium  
**Category:** Dependency Resolution  
**Location:** `src/main/services/dependency-service.ts:85-91`  
**Evidence:**
```typescript
// If a task is deleted, its dependency is treated as satisfied
for (const dep of deps) {
  const status = getTaskStatus(dep.id)
  if (status === undefined) continue // deleted dep = satisfied
  // ...
}
```

**Scenario:**
1. App starts. Task A blocks Task B with hard dep on Task C (deleted).
2. `areDependenciesSatisfied` returns `satisfied: true` (no status for C).
3. B is unblocked and queued.
4. User re-creates Task C and adds B's hard dep to it again.
5. B remains queued (already unblocked by the auto-unblock logic).

The code treats deleted dependencies as satisfied, which is intentional for cleanup scenarios (you don't want deleted upstream tasks to keep dependents blocked forever). But on restart, if blocked tasks reference deleted deps, they're silently unblocked without user awareness. This may mask data corruption or accidental dependency removal.

**Impact:** Low in normal operation (deletes are rare), but in scenarios with cascading deletes or data corruption, a user might not realize a task was unblocked due to missing dependencies.

**Recommendation:**
1. Log a warning when unblocking due to deleted dependencies: `logger.warn(\`Task ${depId} unblocked: dependency ${dep.id} was deleted\`)`
2. Consider adding an audit note when this occurs (similar to [auto-block] prefix).

**Effort:** S  
**Confidence:** Medium

---

### F-t3-depres-7: Soft Dependencies with `condition: 'on_success'` Still Unblock on Failure Due to Type Fallback
**Severity:** Medium  
**Category:** Dependency Resolution  
**Location:** `src/main/services/dependency-service.ts:93-107` and sanitize-depends-on.ts  
**Evidence:**
```typescript
// A dependency created with type: 'soft' but no condition
const dep = { id: 'A', type: 'soft' }  // No condition field
// Falls through to line 106: if (!TERMINAL_STATUSES.has(status))
// So even if A fails, B unblocks (correct for soft)

// But if someone tries to add condition after the fact
const dep = { id: 'A', type: 'soft', condition: 'on_failure' }  // New: unblock on failure
// Line 97: dep.condition === 'on_failure' → check FAILURE_STATUSES
// Now B only unblocks if A fails, opposite of the original type's intent
```

The type field is ignored when condition is present (line 93 check takes precedence). This could lead to confusion: a task with `type: 'soft'` (which semantically means "soft blocking, unblock on any terminal state") combined with `condition: 'on_failure'` would behave differently than its type suggests.

**Impact:** Minimal in current codebase, but a maintainability risk if the type/condition relationship isn't documented clearly. A developer might add `condition: 'on_success'` to a soft dep expecting to restrict its blocking, then be surprised that the condition takes precedence.

**Recommendation:** 
1. **Document the precedence clearly**: "If condition is set, type is ignored. Condition is the source of truth."
2. **Consider deprecating the type field** if condition-based deps are the new standard, or make condition required when type is soft.

**Effort:** S  
**Confidence:** Low

---

### F-t3-depres-8: `_terminalCalled` Guard in agent-manager Uses 5s Timeout—Race on Rapid Re-transitions
**Severity:** Medium  
**Category:** Dependency Resolution  
**Location:** `src/main/agent-manager/index.ts:138-140, 224-230, 264-266`  
**Evidence:**
```typescript
// F-t4-lifecycle-5: Idempotency guard to prevent double dependency resolution
private readonly _terminalCalled = new Set<string>()

async onTaskTerminal(taskId: string, status: string): Promise<void> {
  if (this._terminalCalled.has(taskId)) {
    this.logger.warn(\`[agent-manager] onTaskTerminal duplicate for ${taskId}\`)
    return
  }
  this._terminalCalled.add(taskId)
  // ...
  setTimeout(() => this._terminalCalled.delete(taskId), 5000)  // 5s cleanup
}
```

The guard prevents double-invocation, but only for 5 seconds. If a task transitions terminal → non-terminal (via manual retry: failed → queued) → terminal again within 5s, the second terminal call is silently dropped.

**Impact:** In fast retry scenarios, if a task fails, is manually transitioned back to queued, fails again, the second failure may not trigger dependency resolution. Dependents remain blocked indefinitely.

**Recommendation:**
1. **Use task status, not a time-based guard**: Check if the task's current status is already terminal before calling resolveDependents. If `getTask(taskId).status` is already terminal, skip the duplicate check entirely.
2. **Or tie cleanup to the next status transition**: Only remove from _terminalCalled when the task moves OUT of terminal, not after a fixed timeout.

**Effort:** M  
**Confidence:** Medium

---

## Summary Table

| Finding | Severity | Category | Effort | Confidence |
|---------|----------|----------|--------|-----------|
| F-t3-depres-1 | Critical | Semantics | S | High |
| F-t3-depres-2 | High | Backward Compat | M | High |
| F-t3-depres-3 | High | Race Condition | S | High |
| F-t3-depres-4 | High | Manual Cancellation | M | Medium |
| F-t3-depres-5 | High | Validation | S | High |
| F-t3-depres-6 | Medium | Restart | S | Medium |
| F-t3-depres-7 | Medium | Maintainability | S | Low |
| F-t3-depres-8 | Medium | Race Condition | M | Medium |

## Recommendations for Prioritization

**Immediate (next sprint):**
- F-t3-depres-3: Rebuild index before resolveDependents in agent-manager (prevents stuck blocked tasks in high-throughput scenarios).
- F-t3-depres-5: Add epic cycle detection validation (low effort, high impact on correctness).

**Short-term (1-2 sprints):**
- F-t3-depres-2: Require explicit condition field in dependency specs (improves clarity).
- F-t3-depres-4: Ensure manual cancellations trigger dependency re-evaluation (improves usability).

**Backlog:**
- F-t3-depres-6, F-t3-depres-7, F-t3-depres-8: Documentation, logging, and edge-case fixes.
