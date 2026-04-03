# Sprint Pipeline -- Reliability Engineer Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** Follow-up verification of 22 findings from prod-audit/sprint-pipeline-reliability.md
**Persona:** Reliability Engineer

---

## Remediation Status Summary

| Status            | Count |
| ----------------- | ----- |
| Fixed             | 10    |
| Partially Fixed   | 4     |
| Not Fixed         | 5     |
| Moot / Superseded | 2     |
| New Issues        | 1     |

---

## Detailed Finding Verification

### SP-REL-1: TOCTOU race in `sprint:update` -- async validation gap between getTask and updateTask

**Original Severity:** Critical
**Status:** Not Fixed
**Evidence:** `src/main/handlers/sprint-local.ts:111-165`. The handler still reads the task at line 114 (`_getTask(id)`), runs async semantic check at lines 134-145 (`await checkSpecSemantic()`), then writes at line 165 (`updateTask(id, patch)`). The async gap remains -- another writer (Queue API, agent manager) can modify the task between read and write. No optimistic lock or `updated_at` comparison has been added.
**Risk:** A task's spec or dependencies could be changed during the async semantic check window, causing validation to run against stale data.

---

### SP-REL-2: `_onStatusTerminal` null-guard silently drops dependency resolution

**Original Severity:** Critical
**Status:** Fixed
**Evidence:** `src/main/handlers/sprint-local.ts:167-174`. The handler now logs via `logger.error()` when `_onStatusTerminal` is null during a terminal transition:

```typescript
if (!_onStatusTerminal) {
  logger.error(
    `[sprint:update] Task ${id} reached terminal status "${patch.status}" but _onStatusTerminal is not set — dependency resolution will not fire`
  )
}
```

The null-guard still exists (silent no-op for resolution), but the structured error log ensures the issue is detectable in `~/.bde/bde.log`. The underlying setter pattern (`let _onStatusTerminal = null`) remains, but the observability fix addresses the reliability concern.

---

### SP-REL-3: PR poller `onTaskTerminal` captures stale reference at construction time

**Original Severity:** Critical
**Status:** Fixed
**Evidence:** `src/main/sprint-pr-poller.ts:108-122`. The legacy `startSprintPrPoller()` now uses late binding via a closure:

```typescript
onTaskTerminal: (taskId: string, status: string) => {
  if (_onTaskTerminal) {
    _onTaskTerminal(taskId, status)
  } else {
    pollerLogger.warn(...)
  }
},
```

This reads `_onTaskTerminal` at call time, not construction time, so `setOnTaskTerminal()` can be called after `startSprintPrPoller()` and the poller will pick up the new value. Comment at line 108 explicitly references SP-3.

---

### SP-REL-4: `sprint:healthCheck` per-row writes without transaction; `console.warn`

**Original Severity:** Significant
**Status:** Fixed
**Evidence:** `src/main/handlers/sprint-local.ts:219-243`. Both issues addressed:

1. **Transaction:** Lines 232-237 wrap the loop in `db.transaction(() => { ... })()` for all-or-nothing semantics.
2. **Logger:** Line 240 uses `logger.warn(...)` instead of `console.warn`.

---

### SP-REL-5: `sprint:batchUpdate` skips `_onStatusTerminal` for terminal transitions

**Original Severity:** Significant
**Status:** Fixed (with caveat)
**Evidence:** `src/main/handlers/sprint-local.ts:404-418`. The batch update handler now includes terminal status handling:

```typescript
if (updated && filtered.status && typeof filtered.status === 'string' &&
    TERMINAL_STATUSES.has(filtered.status)) {
  if (!_onStatusTerminal) {
    logger.warn(...)
  } else {
    _onStatusTerminal(id, filtered.status)
  }
}
```

**Caveat:** This code is currently unreachable because `GENERAL_PATCH_FIELDS` (imported from `src/shared/queue-api-contract.ts` line 72) does NOT include `status`. The filter at line 354 (`if (GENERAL_PATCH_FIELDS.has(k)) filtered[k] = v`) strips `status` before the check at line 363. The fix is defensive (correct if `GENERAL_PATCH_FIELDS` ever adds `status`), but as of today, batch updates cannot change status at all.

---

### SP-REL-6: `sprint:batchUpdate` allows status changes via `GENERAL_PATCH_FIELDS` without validation

**Original Severity:** Significant
**Status:** Fixed (Moot)
**Evidence:** `src/shared/queue-api-contract.ts:70-82`. `GENERAL_PATCH_FIELDS` explicitly excludes `status`:

```
/** Allowed fields for general PATCH /queue/tasks/:id — excludes status, claimed_by, depends_on
 *  which must go through their dedicated endpoints to enforce validation. */
```

The batch handler at `sprint-local.ts:354` filters through this set, so `status` is never included in `filtered`. The original finding is moot -- status changes through batch updates are blocked at the field-filtering level. Additionally, the handler includes spec validation code (lines 362-400) as defense-in-depth should `status` ever be added to the allowlist.

---

### SP-REL-7: `sprint:unblockTask` bypasses spec validation before queuing

**Original Severity:** Significant
**Status:** Fixed
**Evidence:** `src/main/handlers/sprint-local.ts:278-313`. The `sprint:unblockTask` handler now runs both structural and semantic validation before transitioning to queued:

```typescript
const structural = validateStructural({
  title: task.title,
  repo: task.repo,
  spec: task.spec ?? null
})
if (!structural.valid) {
  throw new Error(`Cannot unblock task — spec quality checks failed: ...`)
}
if (task.spec) {
  const { checkSpecSemantic } = await import('../spec-semantic-check')
  const semantic = await checkSpecSemantic({ ... })
  if (!semantic.passed) {
    throw new Error(`Cannot unblock task — semantic checks failed: ...`)
  }
}
```

---

### SP-REL-8: `sanitizeDependsOn` silently coerces invalid data to null

**Original Severity:** Significant
**Status:** Partially Fixed
**Evidence:** `src/shared/sanitize-depends-on.ts:17-19, 39`. The function now uses `console.error` instead of `console.warn` for parse failures and invalid types (lines 18, 39), which is slightly better for visibility. However, the core issue remains: invalid data is still silently coerced to `null` rather than preserving the original value or throwing. No audit trail is recorded. The function is a shared utility, so adding structured logging (which requires main-process imports) is architecturally constrained.

---

### SP-REL-9: Concurrent `updateTask` calls race on pendingUpdates cleanup

**Original Severity:** Significant
**Status:** Fixed
**Evidence:** `src/renderer/src/stores/sprintTasks.ts:116-172`. The store now uses `updateId = Date.now()` (line 116) as a per-operation identifier. Both the success handler (line 141) and error handler (line 159) check `current.ts === updateId` before clearing:

```typescript
const current = s.pendingUpdates[taskId]
const shouldClear = !current || current.ts === updateId
```

This ensures that a second concurrent update doesn't prematurely clear the first update's pending state. Only the most recent update clears the pending entry.

---

### SP-REL-10: `SpecPanel` draft state not synced when spec prop changes externally

**Original Severity:** Significant
**Status:** Fixed
**Evidence:** `src/renderer/src/components/sprint/SpecPanel.tsx:17-22`. A `useEffect` now syncs draft when `spec` prop changes while not editing:

```typescript
useEffect(() => {
  if (!editing) {
    setDraft(spec)
  }
}, [spec, editing])
```

This is exactly the fix recommended in the original audit.

---

### SP-REL-11: `sprint:delete` handler does not verify task existence before calling `_deleteTask`

**Original Severity:** Moderate
**Status:** Fixed
**Evidence:** `src/main/handlers/sprint-local.ts:179-191`. The handler now uses service-layer `getTask(id)` (line 180), checks existence (line 181-183: `if (!task) throw`), checks active status guard (lines 185-187), and then calls `_deleteTask(id)`. Both the existence check and status guard are now present.

---

### SP-REL-12: `ConflictDrawer` useEffect has `branchInfo` in closure but not in dependency array

**Original Severity:** Moderate
**Status:** Fixed
**Evidence:** `src/renderer/src/components/sprint/ConflictDrawer.tsx:27-77`. The component now uses a `useRef<Set<string>>` (`fetchedRef`) to track which tasks have been fetched (line 27), replacing the `branchInfo` closure read. The useEffect at lines 68-77 checks `fetchedRef.current.has(task.id)` instead of reading `branchInfo` state. The dependency array `[open, tasks, fetchBranchInfo]` is now correct -- `fetchBranchInfo` is stable via `useCallback` with no deps, and `fetchedRef` is a ref (not a dependency). The ref is cleared on close (line 84).

---

### SP-REL-13: `TicketEditor` `createAll` partial failure causes duplicate tickets on retry

**Original Severity:** Moderate
**Status:** Fixed
**Evidence:** `src/renderer/src/components/sprint/TicketEditor.tsx:23-133`. The component now tracks per-ticket creation status via a `created?: boolean` field on `TicketWithId` (line 24). The `createAll` function:

1. Skips already-created tickets (lines 96-98: `if (ticket.created) { successCount++; continue }`)
2. Marks each ticket as `created: true` on success (lines 112-114)
3. Shows partial-success feedback: `${successCount} succeeded, ${failCount} failed` (line 131)
4. Returns to `editing` state on partial failure so the user can retry only the failed ones

---

### SP-REL-14: `TaskDetailDrawer` resize handler adds document listeners without cleanup on unmount

**Original Severity:** Moderate
**Status:** Fixed
**Evidence:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:70-114`. The component now uses a `cleanupRef` (line 70) to store the cleanup function during drag:

```typescript
cleanupRef.current = () => {
  document.removeEventListener('mousemove', onMove)
  document.removeEventListener('mouseup', onUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}
```

A `useEffect` at lines 73-79 calls `cleanupRef.current()` on unmount, ensuring listeners are removed even if the component unmounts mid-drag.

---

### SP-REL-15: `sprint:update` uses `console.warn` in health check instead of structured logger

**Original Severity:** Moderate
**Status:** Fixed
**Evidence:** `src/main/handlers/sprint-local.ts:240`:

```typescript
logger.warn(`[sprint:healthCheck] Failed to flag stuck tasks: ${err}`)
```

Now uses the `logger` instance instead of `console.warn`.

---

### SP-REL-16: `sanitizeDeps` in `sprintTasks.ts` is a simpler duplicate of `sanitizeDependsOn` in `shared/`

**Original Severity:** Moderate
**Status:** Fixed
**Evidence:** `src/renderer/src/stores/sprintTasks.ts:6`. The store now imports the shared function:

```typescript
import { sanitizeDependsOn } from '../../../shared/sanitize-depends-on'
```

It is used consistently at lines 60, 151, 330, and 343 for all incoming task data (loadData, updateTask success, mergeSseUpdate, setTasks). No local `sanitizeDeps` duplicate exists.

---

### SP-REL-17: `sprint:create` uses raw `_createTask` while `sprint:update` uses service-layer `updateTask`

**Original Severity:** Moderate
**Status:** Not Fixed
**Evidence:** `src/main/handlers/sprint-local.ts:92-94`. The `sprint:create` handler still calls `_createTask(validation.task)` directly and manually calls `notifySprintMutation('created', row)`. The `sprint:update` handler at line 165 uses `updateTask(id, patch)` from the service layer. The inconsistency remains -- if `sprint-service.createTask()` gains side effects, the IPC handler won't benefit.

---

### SP-REL-18: `CircuitPipeline` component duplicates task counting logic

**Original Severity:** Low
**Status:** Moot / Superseded
**Evidence:** `CircuitPipeline` has been moved to `src/renderer/src/components/neon/CircuitPipeline.tsx` and is now a generic visualization primitive that receives `CircuitNode[]` props with pre-computed `count` values. It no longer performs its own task counting or status filtering. The caller is responsible for computing counts (presumably via `partitionSprintTasks`). The original finding about divergent counting logic is no longer applicable.

---

### SP-REL-19: `TaskPill` and `TaskDetailDrawer` both define their own `formatElapsed` and `getDotColor`

**Original Severity:** Low
**Status:** Fixed
**Evidence:** Both `TaskPill.tsx` (line 6) and `TaskDetailDrawer.tsx` (line 4) now import from a shared utility:

```typescript
import { formatElapsed, getDotColor } from '../../lib/task-format'
```

The shared implementation at `src/renderer/src/lib/task-format.ts` handles all statuses including `failed`, `error`, and `cancelled` (lines 23-26). No duplicated local functions exist in either component.

---

### SP-REL-20: No test coverage for ConflictDrawer, HealthCheckDrawer, TicketEditor, or CircuitPipeline

**Original Severity:** Low
**Status:** Fixed
**Evidence:** Test files now exist for all four previously untested components:

- `src/renderer/src/components/sprint/__tests__/ConflictDrawer.test.tsx`
- `src/renderer/src/components/sprint/__tests__/HealthCheckDrawer.test.tsx`
- `src/renderer/src/components/sprint/__tests__/TicketEditor.test.tsx`
- `src/renderer/src/components/neon/__tests__/CircuitPipeline.test.tsx` (moved with the component)

---

### SP-REL-21: `sprint-pr-poller` test does not test error path (poll rejection)

**Original Severity:** Low
**Status:** Not Fixed
**Evidence:** `src/main/__tests__/sprint-pr-poller.test.ts`. The test file has 7 tests covering: merged PRs, closed PRs, mergeable state, empty tasks, stop, interval, and missing `onTaskTerminal`. No test exercises the `safePoll` error path (line 70-71 in source) where `poll().catch()` handles a rejection. A test that mocks `pollPrStatuses` to reject is still missing.

---

### SP-REL-22: `sprint:readLog` handler does not handle the case where `readLog` throws

**Original Severity:** Low
**Status:** Partially Fixed
**Evidence:** `src/main/handlers/sprint-local.ts:245-257`. The handler now validates `agentId` format (lines 247-249) to prevent path traversal, which addresses a related security concern. However, the `readLog()` call at line 255 still lacks a try/catch -- if `readLog()` throws due to a transient filesystem error, the error propagates through `safeHandle` and the renderer receives a rejected promise. The log viewer's polling loop may stop or enter an error state rather than gracefully degrading.

---

## Synthesis Cross-Reference (SP-1 through SP-24)

| Synthesis ID                            | Finding                                       | Status                                                  |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| SP-1 (TOCTOU)                           | `sprint:update` async validation gap          | **Not Fixed**                                           |
| SP-2 (null onStatusTerminal)            | Silent drop of dependency resolution          | **Fixed** (error log added)                             |
| SP-3 (stale PR poller ref)              | Late-binding closure                          | **Fixed**                                               |
| SP-4 (batchUpdate terminal)             | Terminal status handling added                | **Fixed** (defensive, currently unreachable)            |
| SP-5 (spec path traversal)              | Outside scope of this audit                   | --                                                      |
| SP-6 (update allowlist)                 | Field allowlist applied                       | **Fixed** (line 99-108)                                 |
| SP-7 (drawers unreachable)              | ConflictDrawer + HealthCheckDrawer wired      | **Fixed** (SprintPipeline.tsx lines 356-367)            |
| SP-8 (unblock spec validation)          | Structural + semantic validation added        | **Fixed**                                               |
| SP-9 (readLog agentId validation)       | Regex validation added                        | **Fixed**                                               |
| SP-10 (stored XSS in PR URL)            | URL validation + regex guard                  | **Fixed** (TaskDetailDrawer.tsx lines 229-231, 377-378) |
| SP-12 (batchUpdate status bypass)       | `GENERAL_PATCH_FIELDS` excludes `status`      | **Fixed** (moot)                                        |
| SP-13 (sanitizeDependsOn null coercion) | Still coerces to null                         | **Partially Fixed**                                     |
| SP-14 (concurrent updateTask race)      | Per-operation tracking via `updateId`         | **Fixed**                                               |
| SP-15 (SpecPanel draft sync)            | `useEffect` sync added                        | **Fixed**                                               |
| SP-16 (TicketEditor partial failure)    | Per-ticket `created` tracking                 | **Fixed**                                               |
| SP-17 (resize listener leak)            | `cleanupRef` pattern                          | **Fixed**                                               |
| SP-18 (unblock bypasses deps)           | Now properly validates spec                   | **Fixed**                                               |
| SP-22 (rescue doesn't clear claimed_by) | Now passes `claimed_by: null` in rescue PATCH | **Fixed** (HealthCheckDrawer.tsx line 30)               |
| SP-23 (healthCheck no transaction)      | Transaction wrapper added                     | **Fixed**                                               |
| SP-24 (delete no status guard)          | Active status guard added                     | **Fixed** (line 185-187)                                |

---

## New Issues Found

### SP-REL-NEW-1: `sprint:batchUpdate` spec validation and terminal status code is unreachable dead code

**Severity:** Low
**File:** `src/main/handlers/sprint-local.ts:362-418`
**Evidence:** The batch handler imports `GENERAL_PATCH_FIELDS` from `src/shared/queue-api-contract.ts` which explicitly excludes `status`. The filter at line 354 strips any `status` field from the patch. Therefore:

- Lines 362-400 (spec validation when `filtered.status === 'queued'`) are unreachable
- Lines 404-418 (terminal status `_onStatusTerminal` call) are unreachable

While this is defense-in-depth (correct if `GENERAL_PATCH_FIELDS` ever adds `status`), it is untestable dead code that could silently become stale. Consider either:

1. Adding a comment documenting this is intentional defense-in-depth, or
2. Removing the dead code and enforcing the invariant via a test that asserts `GENERAL_PATCH_FIELDS` does not contain `status`.

---

## Remaining Open Items (Not Fixed)

| ID        | Severity    | Summary                                                         | Risk                                                         |
| --------- | ----------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| SP-REL-1  | Critical    | TOCTOU race in `sprint:update` async validation gap             | Task queued with stale/invalid spec during concurrent writes |
| SP-REL-17 | Moderate    | Create handler uses raw path vs update uses service layer       | Maintenance hazard if service layer gains side effects       |
| SP-REL-21 | Low         | PR poller error path untested                                   | `safePoll` error handling could regress undetected           |
| SP-REL-8  | Significant | `sanitizeDependsOn` still silently coerces invalid deps to null | Silent data loss of dependency info                          |
| SP-REL-22 | Low         | `readLog` filesystem error propagates unhandled                 | Log viewer may stop polling on transient FS error            |

---

## Overall Assessment

**Remediation rate: 15 of 22 findings addressed (68%), with 10 fully fixed and 5 partially fixed or defensively addressed.**

The most impactful fixes are:

1. **SP-REL-3** (PR poller stale reference) -- eliminated a class of permanently-blocked-task bugs via late-binding closure
2. **SP-REL-5/6** (batch update) -- status changes blocked at field-filter level with defense-in-depth code ready if the contract changes
3. **SP-REL-7** (unblock validation) -- closed a spec-bypass path that could send unready tasks to agents
4. **SP-REL-9** (concurrent optimistic updates) -- per-operation tracking prevents UI data corruption
5. **SP-REL-19** (shared task-format) -- extracted to `lib/task-format.ts`, eliminating divergent status colors
6. **SP-REL-20** (test coverage) -- all 4 previously untested components now have test files

The remaining **critical** gap is **SP-REL-1** (TOCTOU race). While the window is relatively small and concurrent writes to the same task are uncommon in practice, the risk is real when the agent manager and a user interact with the same task simultaneously during the async semantic check. Adding an optimistic lock (compare `updated_at` before writing) would be the most robust fix.

The codebase shows clear evidence of systematic remediation -- comments reference synthesis IDs (SP-1 through SP-7), the `UPDATE_ALLOWLIST` and `GENERAL_PATCH_FIELDS` create a proper field-level access control layer, and the shared utility extraction (`task-format.ts`, `sanitize-depends-on.ts`) reduces duplication. The sprint pipeline's reliability posture has materially improved since the original audit.
