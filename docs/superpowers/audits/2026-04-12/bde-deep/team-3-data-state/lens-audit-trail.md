# Audit Trail Completeness Investigation: Sprint Task State Mutations
**Date:** 2026-04-12  
**Audit Scope:** All paths by which sprint task state changes, audit recording completeness, terminal state convergence, and dependency resolution triggering.

## Executive Summary

The BDE codebase implements a multi-path audit trail system where task state mutations flow through `updateTask()` in sprint-queries.ts, which automatically records changes via `recordTaskChanges()`. However, the investigation reveals **5 critical audit trail and state machine gaps** affecting data integrity and dependent task unblocking:

1. **Direct SQL write to `pr_mergeable_state` bypasses audit trail** — a field that affects PR merge UX but is never recorded as changed
2. **PR poller bulk transitions skip validation but succeed** — `transitionTasksToDone` directly executes SQL without consulting `isValidTransition()`, creating a state machine bypass
3. **Audit trail failure doesn't abort PR poller transactions** — when `recordTaskChangesBulk` fails, the status UPDATE still succeeds, silently losing the audit trail
4. **Terminal status check only validates during explicit updateTask** — the PR poller's direct UPDATE bypasses this check, allowing invalid state if constraints fail
5. **Dependent resolution swallows errors per-task** — if `resolveDependents` throws during PR poller bulk completion, one failed task doesn't block sibling resolution

## Findings

### F-t3-audit-trail-1: Direct SQL Write to `pr_mergeable_state` Omitted from Audit Trail
**Severity:** High  
**Category:** Audit Trail  
**Location:** `src/main/data/sprint-queries.ts:797-808`  
**Evidence:**
```typescript
export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  if (!mergeableState) return
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?')
      .run(mergeableState, prNumber)
    // NO recordTaskChanges() call — audit trail is NOT created
  } catch (err) {
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-queries] updateTaskMergeableState failed for PR #${prNumber}: ${msg}`)
  }
}
```
Called from `src/main/sprint-pr-poller.ts:109` on every PR status poll. Field is visible in UI (affects merge button state) but has no audit history.

**Impact:** When auditing task state changes, the `pr_mergeable_state` transitions are invisible. A task's merge button may show "blocked" → "ready" but no audit record explains the change, making it impossible to correlate UI state changes with GitHub API events or policy decisions.

**Recommendation:** Wrap the UPDATE in a `recordTaskChanges()` call with `changedBy: 'pr-poller'` and manually construct the old/new patch, OR refactor to use the standard `updateTask()` path which automatically records it.

**Effort:** S  
**Confidence:** High

---

### F-t3-audit-trail-2: PR Poller Bulk Transitions Bypass `validateTransition()` State Machine
**Severity:** Critical  
**Category:** Audit Trail + State Machine  
**Location:** `src/main/data/sprint-queries.ts:609-650` (transitionTasksToDone)  
**Evidence:**
```typescript
function transitionTasksToDone(
  prNumber: number,
  changedBy: string,
  db: Database.Database
): string[] {
  const affected = db
    .prepare(
      `SELECT ${SPRINT_TASK_COLUMNS}
       FROM sprint_tasks WHERE pr_number = ? AND status = ?`
    )
    .all(prNumber, 'active') as Array<Record<string, unknown>>

  // ... build audit entries ...

  // Execute UPDATE directly WITHOUT validateTransition check
  db.prepare(
    'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
  ).run('done', completedAt, prNumber, 'active')

  return affectedIds
}
```

By contrast, the normal `updateTask()` path (line 372) enforces `validateTransition(currentStatus, patch.status)` inside the transaction. The PR poller path **hardcodes `active → done` transition** via SQL WHERE clause (`status = 'active'`), never consulting the state machine.

**Impact:** If a task somehow enters a non-'active' status (e.g., 'review', 'blocked', 'failed') while a PR is open, the poller will silently skip it (because the WHERE clause filters by `status = 'active'`), but if multiple tasks are assigned to the same PR and one is in an invalid state, there's no validation protecting the valid one.

More critically: a future schema change or business rule change that makes `active → done` invalid would NOT be caught here — only by the normal `updateTask()` path. The PR poller is a state machine bypass.

**Recommendation:** Call `validateTransition('active', 'done', ...)` (or extract as `isValidTransition`) and throw if false, OR refactor to call `updateTask()` in a loop for each affected task (sacrificing bulk performance but gaining correctness).

**Effort:** M  
**Confidence:** High

---

### F-t3-audit-trail-3: Audit Trail Failure Does Not Abort PR Poller Status Transition
**Severity:** Critical  
**Category:** Audit Trail  
**Location:** `src/main/data/sprint-queries.ts:624-646`  
**Evidence:**
```typescript
  if (affectedIds.length > 0) {
    const completedAt = nowIso()

    try {
      recordTaskChangesBulk(
        affected.map((oldTask) => ({
          taskId: oldTask.id as string,
          oldTask,
          newPatch: { status: 'done', completed_at: completedAt }
        })),
        changedBy,
        db
      )
    } catch (err) {
      logger.warn(`[sprint-queries] Failed to record bulk changes: ${err}`)
      // ERROR IS SWALLOWED — execution continues to the UPDATE
    }

    // This UPDATE executes REGARDLESS of recordTaskChangesBulk failure
    db.prepare(
      'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
    ).run('done', completedAt, prNumber, 'active')
  }
```

The `recordTaskChangesBulk` failure is logged as a **warning, not an error**, and **does not throw**. The status UPDATE still executes. This means the transaction (from `markTaskDoneByPrNumber`'s caller) proceeds to commit with the status change but no audit trail.

**Impact:** When GitHub PR poller detects a merge, it transitions the task to 'done' but if the database is under contention or `task_changes` has a constraint violation, the audit trail silently fails and the status change persists unrecorded. An auditor reviewing task history will see:
- Task was 'active' at T-1
- Task was 'done' at T
- No audit entry explaining the transition or who triggered it

This violates audit completeness. If the transaction is written properly (with db provided), it should wrap the entire operation, but the try/catch is **not** rethrowing.

**Recommendation:** Change `catch (err)` to `throw err` (or `throw new Error(...)`) to abort the transaction. The transaction boundary (from `markTaskDoneByPrNumber`) will roll back the status UPDATE. Or, if audit trail failure is intended to be non-fatal, the log level should be 'error' with context, not 'warn'.

**Effort:** S  
**Confidence:** High

---

### F-t3-audit-trail-4: No Terminal Status Check in PR Poller Before Calling `onTaskTerminal`
**Severity:** Medium  
**Category:** State Machine  
**Location:** `src/main/sprint-pr-poller.ts:61-69` (merged) and `87-107` (cancelled)  
**Evidence:**
```typescript
if (result.merged) {
  const ids = deps.markTaskDoneByPrNumber(prNumber)
  log.info(`[sprint-pr-poller] PR #${prNumber} merged — marked ${ids.length} task(s) done: ...`)
  if (deps.onTaskTerminal) {
    const promises = ids.map((id) => {
      log.info(`[sprint-pr-poller] Calling onTaskTerminal(${id}, 'done')`)
      return Promise.resolve(deps.onTaskTerminal!(id, 'done'))
    })
    // No verification that returned task status is actually 'done'
  }
}
```

The poller calls `onTaskTerminal(id, 'done')` with the status string **without verifying** that the task actually transitioned to 'done'. If `markTaskDoneByPrNumber` returned an empty array (because the WHERE clause found no 'active' tasks), the task is still included in the loop if it was somehow queued/returned by the poller.

**Impact:** If the PR poller has stale data or a race condition, it could call `onTaskTerminal('task-1', 'done')` even though task-1 never changed state (remains 'active'). The dependency resolution service (`TaskTerminalService`) will then try to unblock dependents of a task that may not actually be done, leading to incorrect state transitions in downstream tasks.

**Recommendation:** Before calling `onTaskTerminal`, verify the returned `ids` array is non-empty and fetch the task to confirm `status === 'done'`, OR change `markTaskDoneByPrNumber` to return the full `SprintTask[]` objects so the poller can inspect the actual status.

**Effort:** M  
**Confidence:** Medium

---

### F-t3-audit-trail-5: Dependency Resolution Per-Task Error Swallowing Allows Silent Partial Failure
**Severity:** High  
**Category:** Dependency Resolution  
**Location:** `src/main/services/task-terminal-service.ts:64-82`  
**Evidence:**
```typescript
for (const [id, terminalStatus] of _pendingResolution) {
  try {
    resolveDependents(
      id,
      terminalStatus,
      depIndex,
      deps.getTask,
      deps.updateTask,
      deps.logger,
      deps.getSetting,
      epicIndex,
      deps.getGroup,
      deps.listGroupTasks
    )
  } catch (err) {
    deps.logger.error(
      `[task-terminal-service] resolveDependents failed for ${id}: ${err}`
    )
    // Error is caught and logged — loop continues
  }
}
```

When the PR poller calls `onTaskTerminal` for multiple tasks in a batch (e.g., PR #42 with tasks [task-1, task-2, task-3]), each is queued in `_pendingResolution`. The setTimeout(0) batches them, but if `resolveDependents` throws for task-2, the error is logged and the loop continues to task-3. Task-1 was already processed successfully.

**Impact:** In a multi-task PR completion scenario, if one task has a corrupted dependency graph or a blocked dependent throws an error, the downstream tasks in that batch will still be processed, but upstream tasks that depend on task-2 will **not** be unblocked. The failure is silent (logged as error, not surfaced to caller) and the poller has no way to know it should retry.

Specifically: if task-2's dependents fail to unblock due to `computeBlockState` throwing an exception, task-3's dependents will still try to unblock, creating an inconsistent state where some dependents are queued and others remain blocked.

**Recommendation:** Either:
1. **Fail-fast approach**: Make the per-task error fatal — re-throw to abort the entire batch, or collect all errors and throw a summary after the loop.
2. **Retry approach**: Track failed task IDs and let the poller retry them on the next tick (put them back in `_pendingResolution` or signal to the caller).
3. **Monitoring approach**: Emit an event or metric on per-task failure so operators know something went wrong.

**Effort:** M  
**Confidence:** High

---

### F-t3-audit-trail-6: Audit Trail Completeness for `completed_at` Field
**Severity:** Low  
**Category:** Audit Trail  
**Location:** `src/main/data/task-changes.ts:1-53`  
**Evidence:**
The `completed_at` field is recorded in the audit trail via `recordTaskChanges()` when a task transitions to a terminal status. Both normal `updateTask()` and PR poller bulk paths include `completed_at` in the `newPatch`.

However, the `task_changes` table schema is field-level (records individual field changes), so if both `status` and `completed_at` change in a single transaction, they are recorded as **two separate audit rows**:
```
task_changes.field = 'status', old_value = 'active', new_value = 'done'
task_changes.field = 'completed_at', old_value = null, new_value = '2026-04-12T...'
```

This is correct behavior. **No issue here, included for completeness.**

---

## Dependency Resolution Path Coverage Summary

All terminal paths **attempt** to call `TaskTerminalService.onStatusTerminal` or equivalent:

| Path | Entry Point | Terminal Call | Audit Trail | Validation |
|------|-------------|--------------|------------|-----------|
| IPC `sprint:update` | `sprint-local.ts:132` | `deps.onStatusTerminal()` | via `updateTask()` ✓ | `validateTransition()` ✓ |
| Agent `resolveSuccess` (merge) | `completion.ts:276` | `onTaskTerminal('done')` | via `repo.updateTask()` ✓ | via repo ✓ |
| Agent `resolveFailure` (terminal) | `completion.ts:691` | N/A (via updateTask) | via `repo.updateTask()` ✓ | via repo ✓ |
| PR poller (merged) | `sprint-pr-poller.ts:66` | `onTaskTerminal('done')` | via `markTaskDoneByPrNumber()` ⚠️ | **BYPASSED** ✗ |
| PR poller (closed) | `sprint-pr-poller.ts:93` | `onTaskTerminal('cancelled')` | via `markTaskCancelledByPrNumber()` ⚠️ | **BYPASSED** ✗ |

The PR poller paths bypass the normal `updateTask()` validation and use direct SQL UPDATEs.

---

## Recommendations Priority

1. **CRITICAL (Fix First):** F-t3-audit-trail-3 — Change `catch (err) { logger.warn(...) }` to `throw err` in `transitionTasksToDone` and `transitionTasksToCancelled` to abort the transaction if audit fails.

2. **CRITICAL:** F-t3-audit-trail-2 — Add `validateTransition('active', 'done')` check before executing the UPDATE in the PR poller paths, OR refactor to use `updateTask()` in a loop.

3. **HIGH:** F-t3-audit-trail-1 — Wrap the `updateTaskMergeableState` UPDATE with `recordTaskChanges()` to ensure all mutations are audited.

4. **HIGH:** F-t3-audit-trail-5 — Implement error aggregation or fail-fast semantics in the `TaskTerminalService` batch resolution loop to prevent silent partial failures.

5. **MEDIUM:** F-t3-audit-trail-4 — Add post-transition verification in the PR poller to confirm the task actually reached 'done' before signaling dependency resolution.

---

## Notes for Implementation

- All audit trail changes must occur **inside the transaction boundary** to ensure atomicity — if audit fails, the status UPDATE must also fail.
- The `changed_by` field is currently hardcoded to `'unknown'` in `updateTask()` (line 437). Consider passing it through the call chain for better auditability.
- The `recordTaskChangesBulk` function already exists for batched operations; the PR poller uses it correctly, but the error handling (item 3) must be fixed.
- The `TaskTerminalService` uses `setTimeout(0)` to coalesce multiple terminal notifications; this is intentional for bulk PR merges (documented in `task-terminal-service.ts:59-62`), but error handling must be improved.

