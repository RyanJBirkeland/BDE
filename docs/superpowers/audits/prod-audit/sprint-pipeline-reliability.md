# Sprint Pipeline -- Reliability Engineer Audit

**Date:** 2026-03-29
**Scope:** 29 files in Sprint Pipeline (source + tests)
**Persona:** Reliability Engineer

---

## Cross-Reference with Synthesis Final Report

### Previously Reported -- Now Fixed

| Synthesis Issue | Status | Evidence |
|---|---|---|
| UX-3: Pipeline "Edit" button navigates to blank Workbench (does not call `loadTask()`) | **Fixed** | `SprintPipeline.tsx:278` now calls `useTaskWorkbenchStore.getState().loadTask(selectedTask)` before `setView('task-workbench')` |
| ARCH-2: Repository pattern inconsistently applied (IPC handlers bypass `ISprintTaskRepository`) | **Partially fixed** | `sprint-local.ts` now imports from `sprint-service.ts` for notification-aware functions (`updateTask`, `getTask`, `listTasks`, etc.). Direct `_createTask`/`_updateTask`/`_deleteTask` imports remain for cases requiring raw data access (creation, health check) |
| sprint-tasks-sd 2.1: `window.confirm()` in SprintDetailPane | **Fixed** (moot) | SprintDetailPane is dead code; SprintPipeline uses `ConfirmModal` via `useSprintTaskActions().confirmProps` |

### Previously Reported -- Still Open

| Synthesis Issue | Status | Notes |
|---|---|---|
| ARCH-1: Dual orchestrator duplication (SprintCenter + SprintPipeline) | **Still open** | SprintCenter is dead code but not deleted; no shared `useSprintOrchestration()` hook |
| ARCH-6: Fragile `onStatusTerminal` wiring -- 4 separate setter functions | **Still open** | `sprint-local.ts:71-75` still uses `_onStatusTerminal` setter pattern; `sprint-pr-poller.ts:100-104` uses `_onTaskTerminal` setter |
| sprint-tasks-pm C2: `window.confirm()` usage in other locations | **Still open in broader codebase** (not in files in scope) |

---

## Findings

### Critical

**SP-REL-1: Race condition in `sprint:update` handler -- TOCTOU between getTask and updateTask**

- **File:** `src/main/handlers/sprint-local.ts:98-153`
- **Evidence:**
  ```typescript
  const task = patch.status === 'queued' ? _getTask(id) : null
  // ... validation logic runs ...
  const result = updateTask(id, patch)
  ```
  The handler reads the task at line 99, performs validation (structural, semantic, dependency checks) over an async window (the `checkSpecSemantic` call at line 119 is `await`-ed), then writes back at line 149. During the async gap, another writer (Queue API, agent manager, or a concurrent IPC call) could modify the task's status, spec, or dependencies. The validation results are then applied to a potentially stale task.
- **Impact:** A task could be queued with an invalid spec if the spec was changed between the read and write. Dependency blocking decisions could be based on stale dependency states.
- **Fix:** Read and validate inside a transaction, or re-read the task after async operations and re-validate if the task has changed. At minimum, add an optimistic lock check (compare `updated_at` before writing).

**SP-REL-2: `onStatusTerminal` callback is null-guarded but wiring order is fragile -- missed terminal transitions silently drop dependency resolution**

- **File:** `src/main/handlers/sprint-local.ts:71-75, 150-152`
- **Evidence:**
  ```typescript
  let _onStatusTerminal: ((taskId: string, status: string) => void) | null = null
  // ...
  _onStatusTerminal?.(id, patch.status as string)
  ```
  If `setOnStatusTerminal()` has not been called before a terminal status transition occurs (e.g., during startup race), `_onStatusTerminal` is `null` and the call is silently skipped. This means dependent tasks will never be unblocked.
- **Impact:** Tasks remain blocked permanently with no error or log message.
- **Fix:** Log a warning when `_onStatusTerminal` is null during a terminal transition, or use an event bus pattern that queues events until a handler is registered.

**SP-REL-3: PR poller `onTaskTerminal` captures stale reference at construction time**

- **File:** `src/main/sprint-pr-poller.ts:106-117`
- **Evidence:**
  ```typescript
  export function startSprintPrPoller(): void {
    _instance = createSprintPrPoller({
      // ...
      onTaskTerminal: _onTaskTerminal ?? undefined,
      // ...
    })
    _instance.start()
  }
  ```
  `_onTaskTerminal` is read once at `startSprintPrPoller()` call time and baked into the closure. If `setOnTaskTerminal()` is called after `startSprintPrPoller()`, the poller uses the stale `undefined` value. The poller even logs a warning about this (`"onTaskTerminal not wired"`) but continues silently.
- **Impact:** PR merge events do not trigger dependency resolution if the wiring order is wrong at startup. Tasks stay blocked forever.
- **Fix:** Pass `onTaskTerminal` as a getter `() => _onTaskTerminal` or restructure to use a late-binding pattern. The `createSprintPrPoller` deps interface should accept a callback factory.

### Significant

**SP-REL-4: `sprint:healthCheck` handler iterates all tasks and calls `_updateTask` per-row without a transaction**

- **File:** `src/main/handlers/sprint-local.ts:191-207`
- **Evidence:**
  ```typescript
  const allTasks = _listTasks()
  for (const task of allTasks) {
    if (['error', 'failed'].includes(task.status) && !task.needs_review) {
      const updatedAt = new Date(task.updated_at).getTime()
      if (updatedAt < oneHourAgo) {
        _updateTask(task.id, { needs_review: true })
      }
    }
  }
  ```
  Each `_updateTask` is a separate SQLite write. If the process crashes mid-loop, some tasks will have `needs_review: true` and others won't. Also, the catch block at line 203 swallows errors with `console.warn` instead of using the structured logger.
- **Impact:** Inconsistent `needs_review` state on crash. Error swallowed with `console.warn` bypasses the structured logging system.
- **Fix:** Wrap the loop in a SQLite transaction. Replace `console.warn` with `logger.warn`.

**SP-REL-5: `sprint:batchUpdate` handler does not fire `_onStatusTerminal` for terminal status transitions**

- **File:** `src/main/handlers/sprint-local.ts:252-315`
- **Evidence:**
  The `sprint:update` handler at line 150-152 checks for terminal statuses and calls `_onStatusTerminal`. The `sprint:batchUpdate` handler at line 292 calls `updateTask(id, filtered)` (the service-layer wrapper) but never checks for terminal status transitions or calls `_onStatusTerminal`.
- **Impact:** Batch updates that transition tasks to `done`, `failed`, `error`, or `cancelled` will NOT trigger dependency resolution. Dependent tasks remain permanently blocked.
- **Fix:** Add the same terminal status check after `updateTask()` in the batch update loop:
  ```typescript
  if (updated && filtered.status && TERMINAL_STATUSES.has(filtered.status as string)) {
    _onStatusTerminal?.(id, filtered.status as string)
  }
  ```

**SP-REL-6: `sprint:batchUpdate` allows status changes via `GENERAL_PATCH_FIELDS` without validation**

- **File:** `src/main/handlers/sprint-local.ts:274-291`
- **Evidence:**
  The batch handler imports `GENERAL_PATCH_FIELDS` and filters patch keys through it. If `status` is in that set, a batch update can change a task's status without running spec validation, semantic checks, or dependency blocking -- all of which are enforced in `sprint:update`. This creates an unchecked bypass of the queuing guardrails.
- **Impact:** Tasks can be moved to `queued` status via batch update without meeting spec quality requirements.
- **Fix:** Either exclude `status` from batch updates (forcing single-task status changes through `sprint:update`) or apply the same validation pipeline.

**SP-REL-7: `sprint:unblockTask` bypasses spec validation and `_onStatusTerminal` check**

- **File:** `src/main/handlers/sprint-local.ts:237-245`
- **Evidence:**
  ```typescript
  const updated = _updateTask(taskId, { status: 'queued' })
  if (updated) notifySprintMutation('updated', updated)
  ```
  Uses raw `_updateTask` directly (bypasses notification via service layer but manually calls `notifySprintMutation`). Does not check whether the task's spec meets quality requirements before setting status to `queued`. Does not call `_onStatusTerminal` (though `queued` is not a terminal status, the inconsistency with `sprint:update` is notable).
- **Impact:** A task with an inadequate spec can be manually unblocked to `queued` and then claimed by the drain loop, leading to agent failures.
- **Fix:** Run at minimum the structural validation check before transitioning to queued.

**SP-REL-8: `sanitizeDependsOn` silently coerces invalid data to null without propagating information**

- **File:** `src/shared/sanitize-depends-on.ts:17-19, 39`
- **Evidence:**
  ```typescript
  } catch {
    console.warn('[sanitizeDependsOn] Failed to parse depends_on string:', value)
    return null
  }
  ```
  Invalid `depends_on` data is silently converted to `null`. If a task had dependencies but they arrived as a malformed string, the task loses its dependency information permanently on the next write cycle. No structured error is thrown and no audit trail is recorded.
- **Impact:** Tasks that should be blocked may run without dependencies being checked. Silent data loss.
- **Fix:** Throw or return a sentinel value when parsing fails rather than silently coercing to null. At minimum, ensure the original value is preserved if parsing fails.

**SP-REL-9: Optimistic update store has no protection against concurrent `updateTask` calls for the same task**

- **File:** `src/renderer/src/stores/sprintTasks.ts:126-165`
- **Evidence:**
  ```typescript
  updateTask: async (taskId, patch): Promise<void> => {
    set((s) => {
      const existing = s.pendingUpdates[taskId]
      const existingFields = existing?.fields ?? []
      const newFields = Object.keys(patch)
      const mergedFields = [...new Set([...existingFields, ...newFields])]
      return { pendingUpdates: { ...s.pendingUpdates, [taskId]: { ts: Date.now(), fields: mergedFields } }, ... }
    })
    try {
      const serverTask = (await window.api.sprint.update(taskId, patch)) as SprintTask | null
      set((s) => {
        const { [taskId]: _, ...rest } = s.pendingUpdates
        return { pendingUpdates: rest, ... }
      })
    } catch (e) {
      set((s) => {
        const { [taskId]: _, ...rest } = s.pendingUpdates
        return { pendingUpdates: rest }
      })
  ```
  If two `updateTask` calls fire for the same task concurrently, the second call's success handler will clear `pendingUpdates[taskId]` even though the first call may not have resolved yet, causing the first call's optimistic fields to be lost during the next poll.
- **Impact:** UI shows stale data after concurrent updates to the same task.
- **Fix:** Track pending updates per operation (e.g., with a counter or operation ID) rather than per task, so clearing one operation's pending state doesn't affect another's.

**SP-REL-10: `SpecPanel` initializes `draft` state from props but never syncs when `spec` prop changes**

- **File:** `src/renderer/src/components/sprint/SpecPanel.tsx:13`
- **Evidence:**
  ```typescript
  const [draft, setDraft] = useState(spec)
  ```
  The `draft` state is initialized once from the `spec` prop. If the parent re-renders `SpecPanel` with a new `spec` value (e.g., after background spec generation completes), the draft will still show the old value. The user may unknowingly save the stale spec.
- **Impact:** User saves outdated spec content, overwriting newer server-side spec.
- **Fix:** Add a `useEffect` that resets `draft` when `spec` prop changes while not in editing mode:
  ```typescript
  useEffect(() => { if (!editing) setDraft(spec) }, [spec, editing])
  ```

### Moderate

**SP-REL-11: `sprint:delete` handler does not verify task existence before calling `_deleteTask`**

- **File:** `src/main/handlers/sprint-local.ts:156-163`
- **Evidence:**
  ```typescript
  const task = getTask(id)    // service-layer getTask
  _deleteTask(id)             // raw delete (no existence check)
  ```
  `getTask` and `_deleteTask` use different access paths (service-layer vs raw). If the task is deleted between the `getTask` call and the `_deleteTask` call, `_deleteTask` runs against a non-existent row. While SQLite handles this gracefully (0 rows affected), the `notifySprintMutation('deleted', task)` fires with the stale task object, potentially confusing SSE consumers.
- **Impact:** Minor: phantom delete notification for already-deleted task.
- **Fix:** Use the same access path, or check the return value of `_deleteTask`.

**SP-REL-12: `ConflictDrawer` useEffect has `branchInfo` in closure but not in dependency array**

- **File:** `src/renderer/src/components/sprint/ConflictDrawer.tsx:29-76`
- **Evidence:**
  ```typescript
  useEffect(() => {
    // ...
    for (const task of tasks) {
      if (branchInfo[task.id] && !branchInfo[task.id].loading) continue
      // ...
    }
    // ...
  }, [open, tasks])  // branchInfo is NOT in the dependency array
  ```
  The effect reads `branchInfo` to skip already-loaded tasks, but `branchInfo` is not in the dependency array. This means:
  1. When `branchInfo` updates (task data loaded), the effect doesn't re-run, which is correct for avoiding re-fetches.
  2. But if `tasks` changes to add a new task while `branchInfo` is stale, the closure captures the old `branchInfo` and may incorrectly skip the new task.

  React's exhaustive-deps lint rule would flag this.
- **Impact:** New conflicting tasks added while the drawer is open may not have their branch info fetched.
- **Fix:** Use a ref for `branchInfo` in the skip check, or add it to deps with appropriate guarding.

**SP-REL-13: `TicketEditor.createAll` partial failure leaves some tickets created and others not**

- **File:** `src/renderer/src/components/sprint/TicketEditor.tsx:88-106`
- **Evidence:**
  ```typescript
  const createAll = async (): Promise<void> => {
    setState('creating')
    try {
      for (const { _id: _, ...ticket } of tickets) {
        await useSprintTasks.getState().createTask({ ... })
      }
      toast.success(`${tickets.length} tickets created in backlog`)
      setState('done')
    } catch (err) {
      toast.error(`Failed to create tickets: ${err}`)
      setState('editing')
    }
  }
  ```
  If ticket 3 of 5 fails, tickets 1-2 are already created but the user sees an error and returns to editing state. The UI still shows all 5 tickets as if none were created. There's no indication of which succeeded.
- **Impact:** Duplicate tickets on retry: user clicks "Create All" again, re-creating tickets 1-2.
- **Fix:** Track per-ticket creation status. Remove successfully created tickets from the editor on partial success, or show which ones succeeded.

**SP-REL-14: `TaskDetailDrawer` resize handler adds document listeners without cleanup on unmount**

- **File:** `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:96-121`
- **Evidence:**
  ```typescript
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    // ...
    const onMove = (ev: MouseEvent): void => { ... }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width])
  ```
  If the component unmounts while the user is dragging (e.g., closing the drawer mid-resize), the `mouseup` event never fires and the `mousemove` and `mouseup` listeners leak on the document. Also, `document.body.style.cursor` and `document.body.style.userSelect` remain stuck.
- **Impact:** Resource leak: orphaned event listeners. Cosmetic issue: cursor style stuck in `col-resize`.
- **Fix:** Add a cleanup function in a `useEffect` that removes any active drag listeners on unmount.

**SP-REL-15: `sprint:update` uses `console.warn` in health check instead of structured logger**

- **File:** `src/main/handlers/sprint-local.ts:204`
- **Evidence:**
  ```typescript
  console.warn('[sprint:healthCheck] Failed to flag stuck tasks:', err)
  ```
  The module has a `logger` instance at line 45 but the health check catch block uses `console.warn` instead.
- **Impact:** Health check errors bypass the structured logging system (`~/.bde/bde.log`) and only appear in the Electron main process console, which is harder to diagnose.
- **Fix:** Replace with `logger.warn(...)`.

**SP-REL-16: `sanitizeDeps` in `sprintTasks.ts` is a simpler duplicate of `sanitizeDependsOn` in `shared/`**

- **File:** `src/renderer/src/stores/sprintTasks.ts:23-32` vs `src/shared/sanitize-depends-on.ts`
- **Evidence:**
  The store has a local `sanitizeDeps` that handles only the `string` case with a try/catch. The shared `sanitizeDependsOn` in `src/shared/sanitize-depends-on.ts` handles strings, arrays, validation of `{id, type}` structure, and edge cases. The store's version does not validate the parsed array structure.
- **Impact:** The renderer could hold `depends_on` arrays with invalid entries (missing `id` or `type`), which could cause runtime errors in dependency-related UI (e.g., `getDependencyStats` in `TaskDetailDrawer`).
- **Fix:** Replace the local `sanitizeDeps` with the shared `sanitizeDependsOn` function.

**SP-REL-17: `sprint:create` handler calls `_createTask` (raw) but `sprint:update` calls `updateTask` (service-layer) -- inconsistent notification paths**

- **File:** `src/main/handlers/sprint-local.ts:92-94` vs `149`
- **Evidence:**
  ```typescript
  // Create: raw + manual notify
  const row = _createTask(validation.task)
  notifySprintMutation('created', row)

  // Update: service-layer (auto-notifies)
  const result = updateTask(id, patch)
  ```
  The create handler calls `_createTask` (raw, no notification) then manually calls `notifySprintMutation`. The update handler calls `updateTask` from the service layer (which auto-notifies). This means if the service layer ever changes its notification behavior, the create and update paths will diverge.
- **Impact:** Maintenance hazard. If someone adds a side effect to `sprint-service.createTask()`, the IPC handler won't benefit because it bypasses it.
- **Fix:** Have `sprint:create` call the service-layer `createTask()` instead of `_createTask` + manual notification.

### Low

**SP-REL-18: `CircuitPipeline` component duplicates task counting logic that exists in `partitionSprintTasks`**

- **File:** `src/renderer/src/components/sprint/CircuitPipeline.tsx:24-43`
- **Evidence:**
  `countForStage` reimplements status-based filtering with a different mapping than `partitionSprintTasks`. For example, `CircuitPipeline` counts `in-progress` as `status === 'active'`, but `partitionSprintTasks` splits active tasks into `inProgress` vs `awaitingReview` based on `pr_status`. This means `CircuitPipeline` will show a count of 3 active when only 1 is truly in-progress and 2 are awaiting review.
- **Impact:** Inconsistent counts between CircuitPipeline and the main pipeline view.
- **Fix:** Pass the already-computed partition to CircuitPipeline instead of raw tasks, or reuse `partitionSprintTasks`.

**SP-REL-19: `TaskPill` and `TaskDetailDrawer` both define their own `formatElapsed` and `getDotColor` functions**

- **File:** `src/renderer/src/components/sprint/TaskPill.tsx:21-42` and `src/renderer/src/components/sprint/TaskDetailDrawer.tsx:23-58`
- **Evidence:**
  Both components define local `formatElapsed` and `getDotColor` functions with slightly different implementations. `TaskDetailDrawer.getDotColor` handles `failed`, `error`, and `cancelled` statuses; `TaskPill.getDotColor` does not.
- **Impact:** Inconsistent status colors between the pill and the drawer for failed/error/cancelled tasks. The pill shows cyan (default) while the drawer shows red.
- **Fix:** Extract to a shared utility (this was already flagged in synthesis as sprint-tasks-sd 4.1-4.5).

**SP-REL-20: No test coverage for `ConflictDrawer`, `HealthCheckDrawer`, `TicketEditor`, or `CircuitPipeline`**

- **File:** `src/renderer/src/components/sprint/__tests__/` (directory listing)
- **Evidence:**
  The test directory contains tests for `SprintPipeline`, `PipelineStage`, `PipelineBacklog`, `TaskPill`, `TaskDetailDrawer`, `SpecPanel`, and `DoneHistoryPanel`. There are no test files for:
  - `ConflictDrawer.tsx` (233 lines, spawn-agent logic, async state management)
  - `HealthCheckDrawer.tsx` (101 lines, IPC calls)
  - `TicketEditor.tsx` (430 lines, batch creation, complex state)
  - `CircuitPipeline.tsx` (95 lines, count logic)
- **Impact:** Four components with non-trivial logic are untested. `TicketEditor` in particular has the partial-failure bug (SP-REL-13) that tests would catch.
- **Fix:** Add test files for these components, prioritizing `TicketEditor` and `ConflictDrawer`.

**SP-REL-21: `sprint-pr-poller` test does not test error path (poll rejection)**

- **File:** `src/main/__tests__/sprint-pr-poller.test.ts`
- **Evidence:**
  All 7 tests cover happy paths (merged, closed, open, no tasks, stop, interval). There is no test for when `deps.pollPrStatuses` rejects or when `deps.listTasksWithOpenPrs` throws. The `safePoll` wrapper at line 70-71 catches errors, but this path is untested.
- **Impact:** If the error handling in `safePoll` regresses, it won't be caught by tests.
- **Fix:** Add a test that mocks `pollPrStatuses` to reject and verifies the poller continues polling on the next interval.

**SP-REL-22: `sprint:readLog` handler does not handle the case where `readLog` throws**

- **File:** `src/main/handlers/sprint-local.ts:209-216`
- **Evidence:**
  ```typescript
  safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
    const fromByte = typeof rawFromByte === 'number' ? rawFromByte : 0
    const info = getAgentLogInfo(getDb(), agentId)
    if (!info) return { content: '', status: 'unknown', nextByte: fromByte }
    const result = await readLog(agentId, fromByte)
    return { content: result.content, status: info.status, nextByte: result.nextByte }
  })
  ```
  If `readLog()` throws (e.g., file system error), the error propagates through `safeHandle` which logs it, but the renderer receives a rejected promise. The renderer's polling loop may stop or enter an error state rather than gracefully returning empty content.
- **Impact:** Log viewer may stop updating if a transient FS error occurs.
- **Fix:** Wrap the `readLog` call in try/catch and return the fallback response on error.

---

## Test Coverage Assessment

| File | Tests Exist | Critical Path Coverage | Gaps |
|---|---|---|---|
| `sprint-local.ts` | Yes (unit + integration) | Good: create, update, delete, claim, healthCheck, readLog, validateDeps, unblockTask, batchUpdate | **Missing**: batchUpdate terminal status path, concurrent update scenario, semantic check failure during update |
| `sprint-pr-poller.ts` | Yes (unit) | Good: merged, closed, open, stop, interval | **Missing**: error path, multiple tasks with same PR number |
| `sanitize-depends-on.ts` | **No dedicated test file** | N/A | Validated indirectly through integration tests but no unit-level edge case coverage |
| `sprintTasks.ts` (store) | Yes (unit) | Good: loadData, updateTask, createTask, deleteTask, launchTask, mergeSseUpdate, optimistic updates | **Missing**: concurrent updateTask calls, setTasks path |
| `SprintPipeline.tsx` | Yes (unit) | Good: rendering, drawer states, spec panel, done history | **Missing**: error state rendering, loading state |
| `PipelineStage.tsx` | Yes (unit) | Good: rendering, empty state, task count | Adequate |
| `PipelineBacklog.tsx` | Yes (unit) | Good: backlog/failed rendering, actions, keyboard | Adequate |
| `TaskPill.tsx` | Yes (unit) | Good: status classes, elapsed time, selection | Adequate |
| `TaskDetailDrawer.tsx` | Yes (unit) | Good: all status action buttons, PR display, deps, branch-only | **Missing**: resize drag behavior |
| `SpecPanel.tsx` | Yes (unit) | Good: edit/save/cancel, close | **Missing**: prop change while editing |
| `DoneHistoryPanel.tsx` | Yes (unit) | Good: rendering, click handlers, empty state | Adequate |
| `ConflictDrawer.tsx` | **No** | N/A | Needs full test coverage |
| `HealthCheckDrawer.tsx` | **No** | N/A | Needs basic render + rescue test |
| `TicketEditor.tsx` | **No** | N/A | Needs partial failure + batch creation tests |
| `CircuitPipeline.tsx` | **No** | N/A | Needs count accuracy test |
| `sprint-listeners.ts` | Yes (unit) | Good: sub/unsub, error isolation, SSE broadcast, IPC broadcast | Adequate |

---

## Summary Table

| ID | Severity | File | Summary |
|---|---|---|---|
| SP-REL-1 | Critical | `sprint-local.ts:98-153` | TOCTOU race: async validation gap between getTask and updateTask |
| SP-REL-2 | Critical | `sprint-local.ts:71-75` | Null `_onStatusTerminal` silently drops dependency resolution |
| SP-REL-3 | Critical | `sprint-pr-poller.ts:106-117` | `onTaskTerminal` captures stale reference at construction time |
| SP-REL-4 | Significant | `sprint-local.ts:191-207` | Health check per-row writes without transaction; `console.warn` |
| SP-REL-5 | Significant | `sprint-local.ts:252-315` | `batchUpdate` skips `_onStatusTerminal` for terminal transitions |
| SP-REL-6 | Significant | `sprint-local.ts:274-291` | `batchUpdate` allows status changes without spec validation |
| SP-REL-7 | Significant | `sprint-local.ts:237-245` | `unblockTask` skips spec validation before queuing |
| SP-REL-8 | Significant | `sanitize-depends-on.ts:17-19` | Invalid deps silently coerced to null (data loss) |
| SP-REL-9 | Significant | `sprintTasks.ts:126-165` | Concurrent updateTask calls race on pendingUpdates cleanup |
| SP-REL-10 | Significant | `SpecPanel.tsx:13` | Draft state not synced when spec prop changes externally |
| SP-REL-11 | Moderate | `sprint-local.ts:156-163` | Delete notifies with stale task if concurrent delete |
| SP-REL-12 | Moderate | `ConflictDrawer.tsx:29-76` | Missing `branchInfo` in useEffect dependency array |
| SP-REL-13 | Moderate | `TicketEditor.tsx:88-106` | Partial failure in batch create causes duplicate tickets on retry |
| SP-REL-14 | Moderate | `TaskDetailDrawer.tsx:96-121` | Resize event listeners leak on unmount during drag |
| SP-REL-15 | Moderate | `sprint-local.ts:204` | `console.warn` instead of structured logger |
| SP-REL-16 | Moderate | `sprintTasks.ts:23-32` | Duplicate `sanitizeDeps` weaker than shared `sanitizeDependsOn` |
| SP-REL-17 | Moderate | `sprint-local.ts:92-94` | Create uses raw path; update uses service-layer (inconsistent) |
| SP-REL-18 | Low | `CircuitPipeline.tsx:24-43` | Duplicated count logic diverges from `partitionSprintTasks` |
| SP-REL-19 | Low | `TaskPill.tsx` / `TaskDetailDrawer.tsx` | Duplicated `formatElapsed` / `getDotColor` with divergent behavior |
| SP-REL-20 | Low | `sprint/__tests__/` | No tests for 4 components (ConflictDrawer, HealthCheckDrawer, TicketEditor, CircuitPipeline) |
| SP-REL-21 | Low | `sprint-pr-poller.test.ts` | No test for poll error/rejection path |
| SP-REL-22 | Low | `sprint-local.ts:209-216` | `readLog` throw propagates unhandled to renderer |

---

## Recommended Fix Priority

### Immediate (blocks production reliability)
1. **SP-REL-5**: Add `_onStatusTerminal` call in `batchUpdate` -- one-line fix, prevents permanently blocked tasks
2. **SP-REL-2**: Add warning log when `_onStatusTerminal` is null during terminal transition
3. **SP-REL-3**: Fix stale reference capture in PR poller construction

### Next Sprint
4. **SP-REL-1**: Add optimistic locking or transaction for update handler
5. **SP-REL-6**: Exclude `status` from `batchUpdate` `GENERAL_PATCH_FIELDS` filter
6. **SP-REL-8**: Preserve original value when `sanitizeDependsOn` parse fails
7. **SP-REL-9**: Track concurrent pending updates per operation
8. **SP-REL-10**: Sync SpecPanel draft with prop changes

### Backlog
9. **SP-REL-20**: Add tests for untested components
10. **SP-REL-16**: Replace local `sanitizeDeps` with shared function
11. **SP-REL-14**: Fix resize listener leak
12. **SP-REL-13**: Track per-ticket success in batch create
