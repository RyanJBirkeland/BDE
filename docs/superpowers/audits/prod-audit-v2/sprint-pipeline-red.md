# Sprint Pipeline — Red Team Follow-Up Audit (v2)

**Date:** 2026-03-29
**Scope:** Sprint Pipeline handlers, services, shared validation, renderer components, stores
**Persona:** Red Team (security / penetration-test-style code review)
**Previous audit:** `prod-audit/sprint-pipeline-red.md` (2026-03-29)

---

## Remediation Status — Previous Findings

### SP-RED-1: SQL Column Name Interpolation Without Identifier Validation

- **Status:** Fixed
- **Evidence:** `sprint-queries.ts:210-212` now has `if (!/^[a-z_]+$/.test(key)) throw new Error(`Invalid column name: ${key}`)` — defense-in-depth regex assertion at the interpolation site, exactly as recommended.

### SP-RED-2: IPC `sprint:update` Accepts Arbitrary Fields Without Allowlist Filtering

- **Status:** Fixed
- **Evidence:** `sprint-local.ts:98-109` now filters through `UPDATE_ALLOWLIST` before processing. The handler iterates `Object.entries(patch)`, checks `UPDATE_ALLOWLIST.has(key)`, and rejects with "No valid fields to update" if nothing passes. Comment `// SP-6` references the finding.
- **Residual note:** The IPC handler uses `UPDATE_ALLOWLIST` (which includes `claimed_by`, `pr_url`, `pr_number`, `pr_status`, `agent_run_id`), while the Queue API uses the stricter `GENERAL_PATCH_FIELDS`. This is intentional — internal callers (agent manager, health check drawer) legitimately write these fields via IPC. The filtering is now explicit rather than relying solely on downstream defense.

### SP-RED-3: `sprint:unblockTask` Bypasses Spec Quality Checks

- **Status:** Fixed
- **Evidence:** `sprint-local.ts:284-309` now runs `validateStructural()` and `checkSpecSemantic()` before transitioning to queued — identical quality gates as the `sprint:update` handler. Structural check is synchronous, semantic check is async with the same error messaging pattern.

### SP-RED-4: Symlink-Based Path Traversal in `validateSpecPath`

- **Status:** Fixed
- **Evidence:** `sprint-spec.ts:35-47` now calls `realpathSync(resolved)` after `path.resolve()` and re-checks the prefix against `realpathSync(specsRoot)`. The `try/catch` around `realpathSync(resolved)` correctly falls back to the resolved path for non-existent files (new file creation), which is safe because a non-existent path can't be a symlink.

### SP-RED-5: `sprint:readLog` Agent ID Not Validated — Potential Path Traversal

- **Status:** Fixed
- **Evidence:** `sprint-local.ts:247` validates `agentId` with `/^[a-zA-Z0-9_-]+$/` regex and throws "Invalid agent ID format" on failure. This blocks path traversal characters (`../`, `/`, etc.).

### SP-RED-6: Unvalidated `href` Construction from Task Notes (Stored XSS via URL)

- **Status:** Fixed
- **Evidence:** `TaskDetailDrawer.tsx:229-231` now validates `ghRepo` with `/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/` and `branch` with `/^[a-zA-Z0-9/_.-]+$/`. Both use `encodeURIComponent()` in the URL construction (line 235). Values that don't match are rejected (returns `null`).

### SP-RED-7: `sprint:delete` Has No Authorization or Status Guard

- **Status:** Fixed
- **Evidence:** `sprint-local.ts:185-187` now checks `task.status === 'active'` and throws "Cannot delete active task — stop the agent first". This prevents orphaned agent processes from deletion of in-flight tasks.
- **Residual note:** `sprint:batchUpdate` delete operations (line 425-429) do NOT have this guard — they call `_deleteTask(id)` without checking status. See SP-RED-V2-1 below.

### SP-RED-8: `sprint:healthCheck` Uses Direct `_updateTask` Bypassing Notifications

- **Status:** Fixed
- **Evidence:** `sprint-local.ts:232-237` now wraps updates in a `db.transaction()` and uses `updateTask()` (service-layer, line 235) instead of `_updateTask()`. This ensures SSE notifications and audit trail logging fire for each update. The transaction also addresses SP-23 (per-row writes without transaction).

### SP-RED-9: `pr_url` Rendered as Clickable Link Without URL Validation

- **Status:** Fixed
- **Evidence:** `TaskDetailDrawer.tsx:374-391` now parses `task.pr_url` with `new URL()`, validates `url.hostname !== 'github.com'`, and returns `null` if invalid. This blocks `javascript:`, phishing URLs, and malformed data.

### SP-RED-10: `sanitizeDependsOn` Recursive Parsing of Nested JSON Strings

- **Status:** Not Fixed
- **Evidence:** `sanitize-depends-on.ts:16` still has unbounded recursive call: `return sanitizeDependsOn(parsed)` with no depth parameter. While exploitation is unlikely (JSON.parse produces non-string after 2-3 levels), the recommended depth limit was not added.
- **Risk:** Very low — theoretical stack overflow from deeply nested JSON strings. Practical impact is negligible.

### SP-RED-11: Queue API Status Endpoint Allows `blocked` Status Bypass

- **Status:** Partially Fixed
- **Evidence:** `queue-api-contract.ts:45` now includes `'blocked'` in `RUNNER_WRITABLE_STATUSES` (with comment `// QA-11: Allow runners to set blocked status`). However, the underlying issue remains: when transitioning to `queued` via the status endpoint, the handler runs spec validation (lines 369-416) but does NOT re-evaluate the task's `depends_on` before allowing the transition. If a blocked task has unsatisfied hard dependencies, a runner can still force it to `queued` by calling `PATCH /queue/tasks/:id/status { "status": "queued" }`. The `sprint:update` IPC handler has the same gap — it checks dependencies only when the task is first being queued (line 148-159), not when re-evaluating an existing blocked task.

---

## Remediation Status — Synthesis Findings (SP-1 through SP-38)

### SP-1: TOCTOU Race in `sprint:update` — Async Validation Gap

- **Status:** Partially Fixed
- **Evidence:** `sprint-local.ts:111-114` has comment `// SP-1: Read task inside validation block to reduce TOCTOU window`. The task is now read immediately before validation and the spec used in checks comes from `patch.spec ?? task.spec`. However, between the async `checkSpecSemantic()` call (line 135) and the `updateTask()` call (line 165), another IPC call could modify the task. The window is reduced but not eliminated — a full fix would require optimistic locking (e.g., `WHERE updated_at = ?`) or running validation and update within a single transaction.

### SP-2: `_onStatusTerminal` Null-Guard Silently Drops Dependency Resolution

- **Status:** Fixed
- **Evidence:** `sprint-local.ts:166-174` now logs an error when `_onStatusTerminal` is null: `logger.error(...)`. The terminal callback is still nullable (design choice — it's set externally), but the failure is no longer silent.

### SP-3: PR Poller `onTaskTerminal` Captures Stale Reference at Construction

- **Status:** Fixed
- **Evidence:** `sprint-pr-poller.ts:108-121` now uses late binding via a closure that reads `_onTaskTerminal` at call time: `onTaskTerminal: (taskId, status) => { if (_onTaskTerminal) { _onTaskTerminal(taskId, status) } ... }`. This prevents stale closure captures.

### SP-4: `sprint:batchUpdate` Skips `_onStatusTerminal` for Terminal Transitions

- **Status:** Fixed
- **Evidence:** `sprint-local.ts:404-418` now calls `_onStatusTerminal(id, filtered.status)` for terminal status changes in batch updates. The same null-guard + warning pattern from `sprint:update` is applied.

### SP-7: ConflictDrawer and HealthCheckDrawer Unreachable from Pipeline UI

- **Status:** Fixed
- **Evidence:** `SprintPipeline.tsx:356-367` renders both `<ConflictDrawer>` and `<HealthCheckDrawer>` with proper state wiring. `conflictDrawerOpen`/`healthCheckDrawerOpen` come from `useSprintUI` store. `conflictingTasks` is computed with proper filter (line 133-143). `visibleStuckTasks` and `dismissTask` come from `useHealthCheck` hook (line 87).

### SP-12: `sprint:batchUpdate` Allows Status Changes Without Spec Validation

- **Status:** Fixed
- **Evidence:** `sprint-local.ts:363-399` now runs structural + semantic spec validation when `filtered.status === 'queued'` in batch updates.

### SP-15: SpecPanel Draft Not Synced When Spec Prop Changes Externally

- **Status:** Fixed
- **Evidence:** `SpecPanel.tsx:17-22` has a `useEffect` that syncs `draft` from `spec` prop when not in editing mode: `if (!editing) { setDraft(spec) }`.

### SP-16: TicketEditor `createAll` Partial Failure Causes Duplicate Tickets on Retry

- **Status:** Fixed
- **Evidence:** `TicketEditor.tsx:24` adds `created?: boolean` tracking per ticket. Lines 95-98 skip already-created tickets on retry. Lines 112-113 mark individual tickets as created after success.

### SP-17: TaskDetailDrawer Resize Listeners Leak on Unmount

- **Status:** Fixed
- **Evidence:** `TaskDetailDrawer.tsx:70-79` uses a `cleanupRef` that stores cleanup functions for active mousemove/mouseup listeners. A dedicated `useEffect` (lines 73-79) calls the cleanup on unmount. The `onUp` handler (lines 96-103) clears listeners and nulls the ref.

### SP-18: "Unblock" Button Force-Launches Bypassing Dependencies

- **Status:** Fixed
- **Evidence:** `TaskDetailDrawer.tsx:336` now routes through `onUnblock` callback: `onClick={() => onUnblock ? onUnblock(task) : onLaunch(task)}`. In `SprintPipeline.tsx:187-197`, `handleUnblock` calls `window.api.sprint.unblockTask(task.id)` which runs the spec quality gate (SP-RED-3 fix above).

### SP-20: SpecPanel No Save Success/Failure Feedback

- **Status:** Fixed
- **Evidence:** `SpecPanel.tsx:44` calls `toast.success('Spec saved')` on success, and `SpecPanel.tsx:46` calls `toast.error(...)` on failure.

### SP-22: HealthCheckDrawer "Rescue" Does Not Clear `claimed_by`

- **Status:** Fixed
- **Evidence:** `HealthCheckDrawer.tsx:27-30` now sends `{ status: TASK_STATUS.QUEUED, agent_run_id: null, claimed_by: null }`. Both `agent_run_id` and `claimed_by` are cleared.

### SP-23: `sprint:healthCheck` Per-Row Writes Without Transaction

- **Status:** Fixed
- **Evidence:** `sprint-local.ts:232-237` wraps all updates in `db.transaction(() => { ... })()`.

### SP-26: CircuitPipeline in sprint/ Is Dead Code

- **Status:** Fixed
- **Evidence:** `CircuitPipeline.tsx` no longer exists in `src/renderer/src/components/sprint/`. Grep for "CircuitPipeline" returns zero matches in the sprint components directory.

### SP-27: DoneHistoryPanel Items Lack Keyboard Accessibility

- **Status:** Fixed
- **Evidence:** `DoneHistoryPanel.tsx:32-39` now has `role="button"`, `tabIndex={0}`, `aria-label={task.title}`, and `onKeyDown` handler for Enter/Space keys.

### SP-28: SpecPanel/DoneHistoryPanel No Escape Key Dismiss

- **Status:** Fixed
- **Evidence:** `SpecPanel.tsx:24-37` has Escape key handler (cancels edit if editing, closes panel otherwise). `DoneHistoryPanel.tsx:11-17` has Escape key handler that calls `onClose()`.

### SP-29: Loading State Shows Only Text, No Spinner

- **Status:** Fixed
- **Evidence:** `SprintPipeline.tsx:221-226` renders `<Spinner size="md" />` alongside the loading text.

### SP-30: Failed Notes Truncated to 40 Chars, No Tooltip

- **Status:** Fixed
- **Evidence:** `PipelineBacklog.tsx:78` now uses CSS `textOverflow: 'ellipsis'` with `overflow: 'hidden'` and adds `title={task.notes || 'No details'}` for tooltip on hover.

### SP-32: "Re-run" Creates Duplicate Task — Misleading Label

- **Status:** Fixed
- **Evidence:** `TaskDetailDrawer.tsx:396,410` buttons now read "Clone & Queue" instead of "Re-run". `PipelineBacklog.tsx:89` still shows "Re-run" for the failed card sidebar action, which is acceptable as it's contextually clear in the failed section.

### SP-33: Duplicate `sanitizeDeps` in Store Weaker Than Shared Version

- **Status:** Fixed
- **Evidence:** `sprintTasks.ts:6` imports `sanitizeDependsOn` from shared, and uses it consistently in `loadData` (line 60), `updateTask` (line 151), `mergeSseUpdate` (line 330), and `setTasks` (line 343). No local duplicate implementation found.

### SP-34: Duplicate `formatElapsed`/`getDotColor` Functions

- **Status:** Fixed
- **Evidence:** Both `TaskPill.tsx:6` and `TaskDetailDrawer.tsx:4` import from `../../lib/task-format`. The shared module `task-format.ts` exports both functions. No inline duplicates remain.

### SP-37: Drawer Resize Handle Has No ARIA/Visual Affordance

- **Status:** Fixed
- **Evidence:** `TaskDetailDrawer.tsx:126-131` adds `role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize drawer"`, `tabIndex={0}`, and `cursor: 'col-resize'` styling.

---

## New Findings

### SP-RED-V2-1: `sprint:batchUpdate` Delete Operations Skip Active Task Guard

- **Severity:** Low
- **Effort:** S
- **File(s):** `src/main/handlers/sprint-local.ts:425-429`
- **Description:** While the `sprint:delete` handler now properly blocks deletion of active tasks (line 185-187), the `sprint:batchUpdate` handler's delete path does not apply the same guard. A batch operation with `{ op: 'delete', id: '<active-task-id>' }` will succeed, bypassing the protection and potentially orphaning a running agent.
- **Evidence:**
  ```typescript
  // sprint-local.ts:425-429
  } else if (op === 'delete') {
    const task = getTask(id)
    _deleteTask(id)
    if (task) notifySprintMutation('deleted', task)
    results.push({ id, op: 'delete', ok: true })
  }
  // No status check — active tasks deletable via batch
  ```
- **Recommendation:** Add the same active-task guard before `_deleteTask(id)`:
  ```typescript
  if (task?.status === 'active') {
    results.push({
      id,
      op: 'delete',
      ok: false,
      error: 'Cannot delete active task — stop the agent first'
    })
    continue
  }
  ```

### SP-RED-V2-2: Queue API `blocked->queued` Transition Still Skips Dependency Re-Evaluation

- **Severity:** Medium
- **Effort:** S
- **File(s):** `src/main/queue-api/task-handlers.ts:369-417`, `src/main/handlers/sprint-local.ts:147-159`
- **Description:** Carried forward from SP-RED-11. Adding `blocked` to `RUNNER_WRITABLE_STATUSES` (QA-11 fix) actually makes this worse — runners can now explicitly set a task to `blocked`, then immediately set it to `queued` in a second call, bypassing dependency checks. The Queue API status handler validates spec quality when transitioning to `queued` but does NOT call `checkTaskDependencies()` to verify that hard dependencies are satisfied. The IPC `sprint:update` handler does check dependencies (line 148-159), but only when the task already has `depends_on` populated.
- **Evidence:**
  ```
  # Two API calls bypass dependency system:
  PATCH /queue/tasks/:id/status {"status": "blocked"}   # explicitly block
  PATCH /queue/tasks/:id/status {"status": "queued"}     # unblock without dep check
  ```
- **Recommendation:** When the target status is `queued`, fetch the task, check `depends_on`, and call `checkTaskDependencies()`. If unsatisfied hard deps exist, reject the transition or auto-set to `blocked`.

### SP-RED-V2-3: `sprint:unblockTask` Uses Raw `_updateTask` — Bypasses SSE and Terminal Resolution

- **Severity:** Low
- **Effort:** S
- **File(s):** `src/main/handlers/sprint-local.ts:311`
- **Description:** After the spec validation fix (SP-RED-3), the `sprint:unblockTask` handler correctly validates specs before transitioning. However, it calls `_updateTask(taskId, { status: 'queued' })` (raw sprint-queries) instead of `updateTask()` (service-layer). This bypasses SSE notification broadcasting. It only manually calls `notifySprintMutation` (line 312), which is the IPC push but not the Queue API SSE broadcaster. External consumers watching the SSE stream won't see the status change until the next poll.
- **Evidence:**
  ```typescript
  // sprint-local.ts:311-312
  const updated = _updateTask(taskId, { status: 'queued' })
  if (updated) notifySprintMutation('updated', updated)
  // Uses raw _updateTask, not service-layer updateTask
  ```
- **Recommendation:** Replace with `updateTask(taskId, { status: 'queued' })` from the service layer for consistent SSE notification.

### SP-RED-V2-4: TicketEditor Still Uses 30+ Inline `tokens.*` Styles

- **Severity:** Low (code quality, not security)
- **Effort:** M
- **File(s):** `src/renderer/src/components/sprint/TicketEditor.tsx:316-457`
- **Description:** Carried forward from SP-31. The `styles` object at the bottom of TicketEditor.tsx contains 30+ inline style definitions using `tokens.*`. This violates the neon styling convention documented in CLAUDE.md ("Do NOT use inline `tokens.*` styles for neon views -- use CSS classes"). While not a security issue, it creates maintenance burden and inconsistency with the rest of the sprint pipeline components which use BEM classes in CSS files.

---

## Summary Table

| ID          | Title                                                          | Previous Status | Current Status      |
| ----------- | -------------------------------------------------------------- | --------------- | ------------------- |
| SP-RED-1    | SQL column name interpolation without identifier validation    | Open            | **Fixed**           |
| SP-RED-2    | IPC `sprint:update` accepts arbitrary fields without allowlist | Open            | **Fixed**           |
| SP-RED-3    | `sprint:unblockTask` bypasses spec quality checks              | Open            | **Fixed**           |
| SP-RED-4    | Symlink-based path traversal in `validateSpecPath`             | Open            | **Fixed**           |
| SP-RED-5    | `sprint:readLog` agent ID not validated                        | Open            | **Fixed**           |
| SP-RED-6    | Unvalidated `href` construction from task notes                | Open            | **Fixed**           |
| SP-RED-7    | `sprint:delete` has no status guard                            | Open            | **Fixed**           |
| SP-RED-8    | `sprint:healthCheck` uses direct `_updateTask`                 | Open            | **Fixed**           |
| SP-RED-9    | `pr_url` rendered without URL validation                       | Open            | **Fixed**           |
| SP-RED-10   | `sanitizeDependsOn` recursive parsing unbounded                | Open            | **Not Fixed**       |
| SP-RED-11   | Queue API blocked->queued bypass                               | Open            | **Partially Fixed** |
| SP-1        | TOCTOU race in `sprint:update`                                 | Open            | **Partially Fixed** |
| SP-2        | `_onStatusTerminal` null-guard drops resolution                | Open            | **Fixed**           |
| SP-3        | PR poller stale `onTaskTerminal` reference                     | Open            | **Fixed**           |
| SP-4        | `sprint:batchUpdate` skips `_onStatusTerminal`                 | Open            | **Fixed**           |
| SP-7        | ConflictDrawer/HealthCheckDrawer unreachable                   | Open            | **Fixed**           |
| SP-12       | `sprint:batchUpdate` status without spec validation            | Open            | **Fixed**           |
| SP-15       | SpecPanel draft not synced                                     | Open            | **Fixed**           |
| SP-16       | TicketEditor partial failure duplicates                        | Open            | **Fixed**           |
| SP-17       | TaskDetailDrawer resize listener leak                          | Open            | **Fixed**           |
| SP-18       | Unblock button bypasses dependencies                           | Open            | **Fixed**           |
| SP-20       | SpecPanel no save feedback                                     | Open            | **Fixed**           |
| SP-22       | HealthCheck Rescue no clear claimed_by                         | Open            | **Fixed**           |
| SP-23       | healthCheck per-row writes no transaction                      | Open            | **Fixed**           |
| SP-26       | CircuitPipeline dead code                                      | Open            | **Fixed**           |
| SP-27       | DoneHistoryPanel no keyboard accessibility                     | Open            | **Fixed**           |
| SP-28       | SpecPanel/DoneHistoryPanel no Escape dismiss                   | Open            | **Fixed**           |
| SP-29       | Loading state no spinner                                       | Open            | **Fixed**           |
| SP-30       | Failed notes truncated, no tooltip                             | Open            | **Fixed**           |
| SP-32       | Re-run misleading label                                        | Open            | **Fixed**           |
| SP-33       | Duplicate sanitizeDeps in store                                | Open            | **Fixed**           |
| SP-34       | Duplicate formatElapsed/getDotColor                            | Open            | **Fixed**           |
| SP-37       | Resize handle no ARIA affordance                               | Open            | **Fixed**           |
| SP-RED-V2-1 | Batch delete skips active task guard                           | —               | **New (Low)**       |
| SP-RED-V2-2 | blocked->queued still skips dep re-eval                        | —               | **New (Medium)**    |
| SP-RED-V2-3 | unblockTask uses raw \_updateTask                              | —               | **New (Low)**       |
| SP-RED-V2-4 | TicketEditor 30+ inline token styles                           | —               | **New (Low)**       |

## Severity Summary

| Severity             | Count                            |
| -------------------- | -------------------------------- |
| Critical             | 0                                |
| High                 | 0                                |
| Medium               | 1 (SP-RED-V2-2, carried forward) |
| Low                  | 3 (SP-RED-V2-1, V2-3, V2-4)      |
| Not Fixed (Low risk) | 1 (SP-RED-10)                    |
| Partially Fixed      | 2 (SP-RED-11/SP-1)               |

## Overall Assessment

The Sprint Pipeline has undergone substantial security remediation since the initial audit. **27 of 32 reviewed findings are fully fixed**, covering all High and Critical items from both the red team audit and the synthesis. The fixes are well-implemented with proper defense-in-depth patterns:

- SQL injection defense now has both allowlist AND regex assertion
- Path traversal is blocked with symlink resolution via `realpathSync()`
- URL construction validates format with regex AND uses `encodeURIComponent()`
- PR URL rendering validates hostname is `github.com`
- Agent ID validation uses strict alphanumeric regex
- Spec quality gates are consistently applied across `sprint:update`, `sprint:unblockTask`, and `sprint:batchUpdate`
- Resource cleanup patterns (resize listeners, intervals) are properly managed

The remaining gaps are minor:

1. **Dependency bypass** (SP-RED-V2-2) is the most significant remaining issue — the Queue API status endpoint allows `blocked->queued` without re-evaluating dependencies. This is a logic bypass, not a remote exploit.
2. **Batch delete inconsistency** (SP-RED-V2-1) is a defense-in-depth gap that's unlikely to be triggered accidentally.
3. The unbounded recursion in `sanitizeDependsOn` (SP-RED-10) is purely theoretical.

**Verdict: The Sprint Pipeline is in good security posture. The dependency bypass (SP-RED-V2-2) should be addressed before production use; all other items are low priority.**
