# Task Transitions Audit — BDE General Health 2026-04-13

## Overall Assessment

BDE's task terminal status convergence is **partially complete but has critical gaps**. The designated `TaskTerminalService` (`src/main/services/task-terminal-service.ts`) exists and is used by agent-manager and sprint PR poller, but **cascade cancellation in `resolve-dependents.ts` directly updates task status to `'cancelled'` without routing through `TaskTerminalService`** (line 76). This creates an unmonitored terminal path that bypasses dependency resolution triggering. Additionally, the sprint PR poller's `onTaskTerminal` callback is optional, creating a silent fallback to no-op when not wired. Status transition guards exist (`isValidTransition`) but are NOT enforced at `updateTask()` call sites — callers can update to invalid states without guard checking. Review handler paths correctly use `terminalStatus` callbacks, and watchdog verdict handling properly routes through `onTaskTerminal`, but the confluence point is incomplete.

---

## F-t3-tasktrans-1: Cascade Cancellation Bypasses TaskTerminalService
**Severity:** Critical
**Category:** Task Transitions
**Location:** `src/main/agent-manager/resolve-dependents.ts:76`
**Evidence:**
```typescript
// Line 76 in resolve-dependents.ts
updateTask(depId, { status: 'cancelled', notes: cancelNote })

// Followed by recursive call that also bypasses TaskTerminalService
resolveDependents(
  depId,
  'cancelled',
  index,
  getTask,
  updateTask,
  logger,
  getSetting,
  epicIndex,
  getGroup,
  listGroupTasks
)
```
**Impact:** When cascade cancellation is enabled (`dependency.cascadeBehavior='cancel'`) and an upstream task fails, dependent blocked tasks are marked `'cancelled'` WITHOUT calling `onTaskTerminal()`. This means downstream dependencies of the cancelled task are never resolved (they remain blocked indefinitely), no audit trail entry signals the cascade event, and the task sits in `'cancelled'` state without triggering any terminal cleanup or dependency resolution for its own dependents.
**Recommendation:** After `updateTask(depId, { status: 'cancelled', ... })` on line 76, immediately call `onTaskTerminal?.(depId, 'cancelled')` to trigger dependency resolution for that task's dependents. Pass `onTaskTerminal` as an optional parameter through the `resolve-dependents` function signature.
**Effort:** S
**Confidence:** High

---

## F-t3-tasktrans-2: Sprint PR Poller onTaskTerminal Callback Is Optional
**Severity:** High
**Category:** Task Transitions
**Location:** `src/main/sprint-pr-poller.ts:22-24, 66-86, 93-106`
**Evidence:**
```typescript
// Interface marks onTaskTerminal as optional (line 24)
onTaskTerminal?: (taskId: string, status: string) => void

// Usage at line 66 checks optional and logs warning if not wired
if (deps.onTaskTerminal) {
  const promises = ids.map((id) => {
    // ... call onTaskTerminal
  })
} else {
  log.warn(
    `[sprint-pr-poller] onTaskTerminal not wired — dependency resolution will not fire`
  )
}
```
**Impact:** If sprint-pr-poller is instantiated without `onTaskTerminal` callback (or if the callback fails), merged PRs marking tasks `'done'` and closed PRs marking tasks `'cancelled'` do NOT trigger dependency resolution. Downstream blocked tasks remain blocked even though their dependencies are now satisfied. The poller logs a warning but continues as if nothing happened.
**Recommendation:** Make `onTaskTerminal` REQUIRED in `SprintPrPollerDeps` (remove optional `?`). Throw during `createSprintPrPoller()` if `onTaskTerminal` is missing. Alternatively, ensure the legacy API (`startSprintPrPoller`) wires it with a default that throws if called without being configured.
**Effort:** M
**Confidence:** High

---

## F-t3-tasktrans-3: No Runtime Validation of Status Transitions at updateTask() Call Sites
**Severity:** High
**Category:** Task Transitions
**Location:** `src/main/handlers/sprint-local.ts:106-108` (and similar call sites)
**Evidence:**
```typescript
// sprint-local.ts lines 106-108
if (result && patch.status && TERMINAL_STATUSES.has(patch.status as string)) {
  deps.onStatusTerminal(id, patch.status as string)
}
// But updateTask() itself does NOT validate the transition before persisting
const result = updateTask(id, patch)

// The transition rules exist in task-state-machine.ts but are never enforced at update time
export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.has(to)
}
```
**Impact:** Callers can `updateTask` with an invalid status transition and it will be persisted without error. For example, `'done' → 'active'` (invalid) or `'cancelled' → 'queued'` (invalid) succeed silently. Invalid transitions corrupt task state and confuse agents/UIs.
**Recommendation:** Add validation guard in `updateTask()` implementation:
```typescript
if (patch.status && currentStatus) {
  const result = validateTransition(currentStatus, patch.status)
  if (!result.ok) {
    throw new Error(`Cannot transition ${currentStatus} → ${patch.status}: ${result.reason}`)
  }
}
```
This shifts guard enforcement from callers (which forget) to the data layer (which always runs).
**Effort:** M
**Confidence:** High

---

## F-t3-tasktrans-4: Watchdog Verdict Handler Does Not Distinguish Between Requeue and Terminal Failures
**Severity:** Medium
**Category:** Task Transitions
**Location:** `src/main/agent-manager/watchdog-handler.ts:62-74, 46-60`
**Evidence:**
```typescript
// Line 62-74: rate-limit-loop requeues to 'queued' but does NOT call shouldNotifyTerminal
if (verdict === 'rate-limit-loop') {
  return {
    taskUpdate: { status: 'queued', ... },
    shouldNotifyTerminal: false,  // ← Silent, no terminal callback
    shouldRequeue: true,
    concurrency: applyBackpressure(...)
  }
}
```
**Impact:** When a watchdog kills an agent for rate-limit-loop and requeues it, no terminal callback fires, so upstream task dependencies are never updated in the resolution index (if any depend on this task reaching terminal state before retrying). The rate-limit requeue is treated as "not a terminal event" even though the agent was forcibly killed.
**Recommendation:** Document in `watchdog-handler.ts` why rate-limit-loop does NOT trigger a terminal callback (i.e., it's a requeue, not a completion). If a task can depend on "an agent retry completed successfully," then rate-limit requeue SHOULD call `onTaskTerminal('queued')` or similar.
**Effort:** S
**Confidence:** Medium

---

## F-t3-tasktrans-5: Review PR Service Updates Task to 'done' Without Calling onStatusTerminal
**Severity:** High
**Category:** Task Transitions
**Location:** `src/main/services/review-orchestration-service.ts:125-131`
**Evidence:**
```typescript
// createPr() in review-orchestration-service.ts, lines 122-131
updateTask(i.taskId, { pr_url: pr.prUrl, pr_number: pr.prNumber ?? null, pr_status: 'open' })
const cfg = getRepoConfig(task.repo)
if (cfg) await cleanupWorktree(task.worktree_path, branch, cfg.localPath, i.env)
const updated = updateTask(i.taskId, {
  status: 'done',
  completed_at: nowIso(),
  worktree_path: null
})
if (updated) notifySprintMutation('updated', updated)
i.onStatusTerminal(i.taskId, 'done')  // ← Called AFTER updateTask
```
**Impact:** The task is updated to `'done'` BEFORE `onStatusTerminal` callback is invoked. If `updateTask` triggers side effects (audit logging, broadcast notifications), those fire before dependency resolution is scheduled. This can cause a race where another process polls the DB and sees `status='done'` before `onStatusTerminal` has a chance to resolve dependents.
**Recommendation:** Move `i.onStatusTerminal(i.taskId, 'done')` BEFORE the final `updateTask` call so dependency resolution is queued before status is broadcast.
**Effort:** S
**Confidence:** Medium

---

## F-t3-tasktrans-6: Missing Terminal Status for 'failed' in Review Action Policy
**Severity:** Medium
**Category:** Task Transitions
**Location:** `src/main/services/review-action-policy.ts:81`
**Evidence:**
```typescript
// ReviewActionPlan type (line 81) allows terminalStatus: 'done' | 'cancelled' | null
terminalStatus: 'done' | 'cancelled' | null

// But resolve-dependents.ts expects to handle FAILURE_STATUSES: 'failed', 'error', 'cancelled'
export const FAILURE_STATUSES: ReadonlySet<string> = new Set(['failed', 'error', 'cancelled'])
```
**Impact:** Review actions (merge, discard, shipIt) can only transition to `'done'` or `'cancelled'`. There is no review action path that transitions a task to `'failed'` status. Tasks that are permanently failed (e.g., unresolvable merge conflicts) have no valid terminal path to `'failed'` and stay in `'review'` indefinitely.
**Recommendation:** Add `'failed'` as a valid `terminalStatus` in `ReviewActionPlan`. Create review action paths for permanent failure scenarios. Or document that review failures should transition to `'error'` (watchdog timeout) rather than `'failed'`.
**Effort:** M
**Confidence:** Medium

---

## F-t3-tasktrans-7: Completion.ts Transition to 'review' Does Not Call onTaskTerminal
**Severity:** Medium
**Category:** Task Transitions
**Location:** `src/main/agent-manager/completion.ts:653-654`
**Evidence:**
```typescript
// NOTE at line 653-654:
// "If not auto-merged, do NOT call onTaskTerminal — review is not a terminal status."
// Do NOT clean up worktree — it stays alive for review.
```
**Impact:** This is CORRECT behavior (`review` is not terminal), but the comment is the only thing preventing a future regression. If a developer calls `onTaskTerminal(task.id, 'review')` somewhere, it will incorrectly trigger dependency resolution.
**Recommendation:** Add a runtime guard at the top of `resolveDependents()`:
```typescript
if (!TERMINAL_STATUSES.has(completedStatus)) {
  logger.warn(`[resolve-dependents] Non-terminal status ${completedStatus} passed; ignoring`)
  return
}
```
**Effort:** S
**Confidence:** High

---

## F-t3-tasktrans-8: Agent Manager onTaskTerminal Double-Call Guard Has Race Condition
**Severity:** Low
**Category:** Task Transitions
**Location:** `src/main/agent-manager/index.ts:225-231, 265`
**Evidence:**
```typescript
// onTaskTerminal at line 224
async onTaskTerminal(taskId: string, status: string): Promise<void> {
  if (this._terminalCalled.has(taskId)) {
    this.logger.warn(`[agent-manager] onTaskTerminal duplicate for ${taskId}`)
    return
  }
  this._terminalCalled.add(taskId)
  try {
    // ... resolution code ...
  } finally {
    setTimeout(() => this._terminalCalled.delete(taskId), 5000)
  }
}
```
**Impact:** If a task terminal callback is called twice within 5 seconds (e.g., watchdog and completion both fire), the second call is silently dropped with only a warn log. If the second call carries a more accurate terminal status, that information is discarded.
**Recommendation:** Log the dropped status with full context:
```typescript
if (this._terminalCalled.has(taskId)) {
  this.logger.warn(
    `[agent-manager] Ignoring duplicate onTaskTerminal for ${taskId} (status: ${status}) — already processed`
  )
  return
}
```
**Effort:** S
**Confidence:** Low
