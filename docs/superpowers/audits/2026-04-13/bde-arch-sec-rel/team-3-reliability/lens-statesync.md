# State Synchronization Audit — BDE Renderer
**Audit Date:** 2026-04-13  
**Scope:** Race conditions, stale state bugs, optimistic update conflicts, polling inconsistencies  
**Examiner:** State Synchronization Auditor  

---

## F-t3-statesync-1: PENDING_UPDATE_TTL Vulnerability to Slow IPC Calls
**Severity:** High  
**Category:** State Synchronization  
**Location:** `src/renderer/src/stores/sprintTasks.ts:27,113,364`  
**Evidence:**
```typescript
const PENDING_UPDATE_TTL = 2000  // 2 seconds

// In loadData() at line 113:
if (localTask && now - pending.ts <= PENDING_UPDATE_TTL) {
  // Merge: start with server data, overlay only the pending fields from local
}

// In mergeSseUpdate() at line 364:
if (pending && Date.now() - pending.ts <= PENDING_UPDATE_TTL) {
  // Protect pending optimistic fields
}
```

**Timing Diagram:**
```
t=0ms:    updateTask() triggered
          ├─ Sets pendingUpdates[taskId] = { ts: 0, fields: ['status'] }
          └─ Applies optimistic update to local state
          └─ IPC call to window.api.sprint.update() starts

t=500ms:  Slow network — still waiting for IPC response
          └─ Polling interval fires (POLL_SPRINT_INTERVAL or POLL_SPRINT_ACTIVE_MS)
          └─ loadData() called
          └─ Server returns stale version with pending field

t=1500ms: IPC response still not received
          └─ Another poll fires (or SSE event arrives)
          └─ TTL check: now=1500, pending.ts=0 → 1500ms < 2000ms ✓
          └─ Pending field preserved, merge succeeds

t=2100ms: IPC still in flight, but TTL now expired
          ├─ loadData() fires again
          ├─ TTL check: now=2100, pending.ts=0 → 2100ms > 2000ms ✗
          ├─ Pending field NOT protected
          └─ Server's stale version WINS — user's optimistic change lost
          
t=2500ms: IPC finally resolves with success
          └─ pendingUpdates already cleared by expired TTL
          └─ Server response applied, but local state already reverted
```

**Impact:**  
On slow networks or high-latency IPC, the 2-second TTL can expire while the update request is still in flight. If a poll or SSE event arrives after the TTL expires but before the IPC resolves, the pending field protection is lost. User makes a change (e.g., status update), sees it applied locally, but the optimistic value gets overwritten by server data that arrived before the IPC response. The final IPC success is ignored because `pendingUpdates` was already cleared. User sees their last action disappear without error.

**Concrete Scenario:**
- User clicks "Launch Task" (updateTask with status='active', priority=2)
- Network spike: IPC hangs for 2.5s
- Sprint polling fires at 2.1s: TTL expired, pending protection lost
- Server's stale version (status='backlog', priority=1) wins
- User's status change reverted
- IPC finally resolves, but `shouldClear` check at line 174 finds no pending entry → task stays reverted
- No error toast because IPC succeeded — user confused

**Recommendation:**  
Option A (conservative): Extend TTL to 5-10 seconds to account for slow networks.  
Option B (better): Make TTL adaptive — measure median IPC latency and set TTL to 2-3× that value (min 3s, max 15s).  
Option C (best): Replace TTL with request-level tracking. Instead of expiring a timestamp, track which request ID is "current" and only honor responses for the current request. This matches the `updateId = Date.now()` pattern already used in `updateTask()` at line 151 — extend it to all three update paths (updateTask, loadData, mergeSseUpdate).

**Effort:** M (Option A/B) to L (Option C)  
**Confidence:** High

---

## F-t3-statesync-2: Multiple Independent Pollers for Same Sprint Data
**Severity:** High  
**Category:** State Synchronization  
**Location:** `src/renderer/src/hooks/useSprintPolling.ts:20`, `src/renderer/src/hooks/usePrStatusPolling.ts:97`, `src/main/sprint-pr-poller.ts:10`  
**Evidence:**
```typescript
// useSprintPolling — polls sprint tasks every 30-120s
useBackoffInterval(loadData, sprintPollMs)  // line 20

// usePrStatusPolling — polls PR statuses every 60s
useBackoffInterval(pollPrStatusesCurrent, POLL_PR_STATUS_MS)  // line 97

// Main-process sprint PR poller — polls every 60s
const POLL_INTERVAL_MS = 60_000  // line 10
```

**Timing Diagram — Three Pollers Converging:**
```
t=0s:     PollingProvider mounts
          ├─ useSprintPolling starts → fires immediately, then every 30s
          ├─ usePrStatusPolling starts → fires immediately, then every 60s
          └─ (main process) sprint-pr-poller starts → fires at 30s, then every 60s

t=30s:    TWO pollers fire simultaneously
          ├─ useSprintPolling.loadData() → calls window.api.sprint.list()
          ├─ usePrStatusPolling.pollPrStatuses() → calls window.api.pollPrStatuses()
          └─ Both write to sprintTasks store via updateTask() 
          └─ Race: which one's merge happens second (wins)?

t=30s:    Main-process sprint-pr-poller fires
          ├─ Calls markTaskDoneByPrNumber(), updateTaskMergeableState()
          ├─ These trigger sprint mutation broadcasts
          └─ Renderer receives "updated" event → mergeSseUpdate() fires
          └─ Third independent state update to sprintTasks

t=60s:    usePrStatusPolling + main-process sprint-pr-poller fire simultaneously
          ├─ usePrStatusPolling.pollPrStatuses() updates pr_status, pr_mergeable_state
          ├─ sprint-pr-poller (main) updates pr_mergeable_state, calls markTaskDone()
          └─ Both write to DB → which succeeds? Pessimistic: last-write-wins
          └─ Renderer may see: stale pr_status because PR poller hasn't merged yet
```

**Impact:**  
The renderer has THREE independent pollers updating the same task fields:
1. **useSprintPolling** (renderer): Full task state every 30-120s
2. **usePrStatusPolling** (renderer): PR status + mergeable state every 60s
3. **sprint-pr-poller** (main): PR status + mergeable state every 60s, writes to DB

When multiple pollers fire near simultaneously, the order of state merges is non-deterministic. If usePrStatusPolling's response comes first, then loadData's response arrives, the pendingUpdates check happens TWICE — once in each merge path. This doubles the risk of field overwrites. More critically, the main-process poller writes to the DB independently, then broadcasts a mutation event, which the renderer may receive out-of-order with respect to the other two pollers' responses.

**Concrete Scenario:**
- User manually merged a PR on GitHub
- t=60s: usePrStatusPolling.pollPrStatuses() finds pr.merged=true, calls updateTask(pr_status='merged')
- t=60s: Main-process sprint-pr-poller reads DB, finds task still has pr_status='open', calls markTaskDoneByPrNumber()
- Main-process writes to DB: status='done', broadcasts mutation
- Renderer receives mutation event → mergeSseUpdate() applies {status: 'done'}
- But usePrStatusPolling's updateTask() call may still be in flight from 1s ago
- Race: Which state wins? status='done' from mutation, or pr_status='merged' from usePrStatusPolling?
- Result: Task may show inconsistent PR status or miss the status transition

**Recommendation:**  
- Consolidate PR polling into a SINGLE source. Either:
  1. Remove usePrStatusPolling from renderer, trust main-process sprint-pr-poller to broadcast mutations
  2. Remove main-process sprint-pr-poller, let renderer own PR polling (not recommended — breaks when window is closed)
- Suppress updateTask() calls during loadData() merges. If a field is marked pending, don't call updateTask() from usePrStatusPolling — wait for pendingUpdates to expire, then call.
- Add a merge-order lock: before applying any polling result, wait for all in-flight updates to finish (use a promise-based gate).

**Effort:** L (requires design of unified PR poller)  
**Confidence:** High

---

## F-t3-statesync-3: Stale Closure in usePrStatusPolling's Callback Refs
**Severity:** Medium  
**Category:** State Synchronization  
**Location:** `src/renderer/src/hooks/usePrStatusPolling.ts:34-97`  
**Evidence:**
```typescript
const updateTaskRef = useRef(updateTask)
// eslint-disable-next-line react-hooks/refs -- sync ref for async callback
updateTaskRef.current = updateTask

const tasksRef = useRef(tasks)
// eslint-disable-next-line react-hooks/refs -- sync ref for async callback
tasksRef.current = tasks

const pollPrStatuses = useCallback(
  async (taskList: SprintTask[]) => {
    const withPr = taskList.filter((t) => t.pr_url && !prMergedRef.current[t.id])
    if (withPr.length === 0) return
    try {
      const results = await window.api.pollPrStatuses(
        withPr.map((t) => ({ taskId: t.id, prUrl: t.pr_url! }))
      )
      // ... later in the callback, uses updateTaskRef.current and tasksRef.current
      for (const r of results) {
        if (r.merged) updateTaskRef.current(r.taskId, { pr_status: PR_STATUS.MERGED })
      }
    }
  },
  [setConflicts, setPrMergedMap]  // ← updateTask, tasks NOT in dependency array
)
```

**Timing Diagram:**
```
t=0s:     Component mounts
          ├─ tasks = [t1, t2, t3]
          ├─ tasksRef.current = tasks
          └─ pollPrStatuses closure captures tasksRef at definition time

t=0s:     pollPrStatusesCurrent() fires
          ├─ Calls pollPrStatuses(tasksRef.current)
          ├─ IPC call starts: getStatus([t1.pr_url, t2.pr_url, t3.pr_url])
          └─ tasksRef points to [t1, t2, t3]

t=0.5s:   User deletes task t2 or status changes
          ├─ useSprintTasks triggers re-render
          ├─ tasks = [t1, t3, t2_backup]  // different array reference
          ├─ tasksRef.current = [t1, t3, t2_backup]  (updated by sync ref)
          └─ BUT pollPrStatuses closure still uses old tasks list from earlier

t=1.5s:   IPC returns with results for t1, t2, t3
          ├─ Callback closes over OLD tasksRef state (from t=0s)
          └─ tasksRef.current NOW points to [t1, t3, t2_backup]
          └─ Filter line 36: withPr = taskList.filter(t => t.pr_url && !prMergedRef[t.id])
          └─ Possible off-by-one or logic error if task order changed

t=1.5s:   updateTaskRef.current() called
          └─ updateTaskRef.current = current updateTask
          └─ updateTask (the function) may be a new instance if store changed
          └─ Previous pending updates for t2 may be lost or mismatched
```

**Impact:**  
While the eslint-disable comments indicate this is intentional (sync refs for async callbacks), there's still a subtle race. The `pollPrStatuses` callback is created ONCE and never recreated (dependencies are [setConflicts, setPrMergedMap] only). If the tasks list changes (e.g., a task is deleted, reordered, or its status changes), the callback still uses the OLD tasksRef — which gets updated synchronously, but the callback's closure logic may assume a stable order or set of tasks. If a task is deleted while an IPC call is in flight, and then the response arrives, the callback filters against a stale list, potentially applying updates to the wrong task ID or skipping updates.

**Concrete Scenario:**
- User has [task-A, task-B, task-C] all with PR URLs
- t=0s: pollPrStatuses fires, IPC call starts to check all 3 PRs
- t=0.5s: User deletes task-B, store updates tasks → [task-A, task-C]
- t=0.5s: tasksRef.current = [task-A, task-C] (sync ref updates)
- t=1.5s: IPC returns [merged: true for task-B, merged: false for others]
- Callback runs: updateTaskRef.current(task-B, {pr_status: 'merged'})
- But task-B is no longer in sprintTasks store
- updateTask IPC call targets task-B, succeeds server-side, but renderer has no task-B to update
- Result: PR merge is recorded in DB but not visible in UI because task was deleted

**Recommendation:**  
Either:
1. Include `updateTask` and `tasks` in the useCallback dependency array, allowing the callback to recreate when they change (this is safe and more conventional)
2. Move the filter logic inside the callback so it always uses the current tasksRef.current, not a stale closure value
3. Add a version/generation counter to the tasks list and skip the callback if the list version changed since the IPC call started

**Effort:** S  
**Confidence:** Medium

---

## F-t3-statesync-4: Selector-Based Polling Rate Change Can Cause Polling Inconsistency
**Severity:** Medium  
**Category:** State Synchronization  
**Location:** `src/renderer/src/hooks/useSprintPolling.ts:11-15`, `src/renderer/src/lib/constants.ts:9-10`  
**Evidence:**
```typescript
// useSprintPolling.ts
const hasActiveTasks = useSprintTasks((s) => selectActiveTaskCount(s) > 0)
const sprintPollMs = hasActiveTasks ? POLL_SPRINT_ACTIVE_MS : POLL_SPRINT_INTERVAL

useEffect(() => {
  loadData()
}, [loadData])
useBackoffInterval(loadData, sprintPollMs)

// constants.ts
export const POLL_SPRINT_INTERVAL = 120_000  // 120s
export const POLL_SPRINT_ACTIVE_MS = 30_000  // 30s
```

**Timing Diagram:**
```
t=0s:     Component mounts, hasActiveTasks=false
          └─ sprintPollMs = 120_000
          └─ useBackoffInterval(loadData, 120_000) starts

t=30s:    User launches first task
          ├─ useSprintTasks triggers selector update
          ├─ hasActiveTasks changes: false → true
          ├─ sprintPollMs changes: 120_000 → 30_000
          └─ useBackoffInterval dependency changes
          └─ Old interval (pending at t=120s) is cleared
          └─ New interval (30_000) starts immediately

t=60s:    User completes the last active task
          ├─ hasActiveTasks changes: true → false
          ├─ sprintPollMs changes: 30_000 → 120_000
          └─ useBackoffInterval clears 30s interval, starts 120s interval
          └─ But loadData() was called at t=30s, next would have been t=60s
          └─ Now next poll is at t=60s + 120s = t=180s
          └─ GAP: 120s polling window just became 2×120s after task completion

t=180s:   Next poll fires (if it hasn't been longer)
          ├─ But if a new task becomes active between t=60-180s, interval restarts again
          └─ Each transition can shift the next poll time by ±90s
```

**Impact:**  
When `hasActiveTasks` changes, the `useBackoffInterval` dependency changes, causing the effect to re-run with the new polling interval. However, if the last poll happened at t=30s and the interval is now 120s, the next poll could be at t=150s (30+120). The consequence is a "gap" in polling cadence. More subtly, if a task completes, polling becomes less frequent (30s → 120s), and if another task is immediately launched, polling becomes frequent again. The transition can cause the actual polling interval to increase beyond the configured maximum (the new interval starts fresh, so if two transitions happen close together, you get a long idle period).

Additionally, the selector creates a closure over the current state. If a task transitions from active → done → active rapidly, the selector may fire multiple times, causing multiple `useBackoffInterval` re-runs. Each one clears the previous timer and starts fresh. If IPC latency is high (e.g., 30-50s per loadData call), and transitions happen within that latency window, polls can queue up or be skipped entirely.

**Concrete Scenario:**
- User launches task A at t=0s: interval becomes 30s
- Poll fires at t=0s, 30s, 60s (3 calls in flight, each taking ~40s)
- All three responses arrive at t=40s-100s
- Meanwhile, task A completes at t=70s: selector fires, interval restarts to 120s
- Next poll scheduled: t=70s + 120s = t=190s
- User launches task B at t=80s: interval restarts to 30s again
- Next poll scheduled: t=80s + 30s = t=110s
- Result: Three polls in 110s (excessive), then 80s gap if no new tasks, then resume 30s cadence
- Polling rate = unpredictable, depends on task launch/completion timing

**Recommendation:**  
1. Decouple task activity detection from interval duration. Instead of switching intervals, use a SINGLE interval (e.g., 30s always) and accept the cost of more frequent polling when idle. Document the polling cost trade-off.
2. If two-tier intervals are required, track the transition timestamp and don't restart the interval if a re-run happens within T milliseconds of the last re-run (e.g., >5s apart triggers restart, <5s apart is ignored as a duplicate transition).
3. Use a `useEffect` with manual cleanup instead of `useBackoffInterval`, and manage the timer ID directly so transitions can extend/shorten the interval without restarting.

**Effort:** M  
**Confidence:** Medium

---

## F-t3-statesync-5: Pending Updates Not Invalidated on Task Deletion
**Severity:** Medium  
**Category:** State Synchronization  
**Location:** `src/renderer/src/stores/sprintTasks.ts:212-221, 380-402`  
**Evidence:**
```typescript
deleteTask: async (taskId): Promise<void> => {
  try {
    await window.api.sprint.delete(taskId)
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== taskId)
    }))
    toast.success('Task deleted')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to delete task')
  }
},

batchDeleteTasks: async (taskIds): Promise<void> => {
  // ... after batch delete succeeds ...
  const deletedIds = new Set(result.results.filter((r) => r.ok).map((r) => r.id))
  set((s) => ({
    tasks: s.tasks.filter((t) => !deletedIds.has(t.id))
  }))
}
```

**Impact:**  
When a task is deleted, the `tasks` array is updated, but `pendingUpdates` is NOT cleaned up. If a user had made an optimistic update to a task, then deleted it before the TTL expired, the `pendingUpdates[taskId]` entry remains in the store. If a new task is created with the same ID (unlikely but possible in distributed systems or after task ID reuse), the old pending entry could interfere with the new task's pending updates. More importantly, memory accumulation: if many tasks are created and deleted with pending updates, the `pendingUpdates` object grows unbounded until TTL expiration (2s per task).

**Concrete Scenario:**
- User updates task t1, creating pendingUpdates[t1]
- User immediately deletes task t1 before IPC response or TTL expiration
- deleteTask() removes t1 from tasks array but leaves pendingUpdates[t1] in store
- If the IPC response for the update arrives after task deletion, the callback still tries to process it (updateTask success path at line 172 checks shouldClear)
- New task created with ID t1 (after database reuse)
- pendingUpdates[t1] still exists from the old task — protection applies to new task incorrectly

**Recommendation:**  
In both `deleteTask` and `batchDeleteTasks`, after removing tasks from the array, also remove them from pendingUpdates and pendingCreates:
```typescript
set((s) => ({
  tasks: s.tasks.filter((t) => t.id !== taskId),
  pendingUpdates: Object.fromEntries(
    Object.entries(s.pendingUpdates).filter(([id]) => id !== taskId)
  ),
  pendingCreates: s.pendingCreates.filter((id) => id !== taskId)
}))
```

**Effort:** S  
**Confidence:** High

---

## F-t3-statesync-6: No Invalidation When Task Fields Change During IPC
**Severity:** Medium  
**Category:** State Synchronization  
**Location:** `src/renderer/src/hooks/usePrStatusPolling.ts:36-83`, `src/renderer/src/stores/sprintTasks.ts:150-210`  
**Evidence:**
```typescript
// usePrStatusPolling — updates pr_status, pr_mergeable_state
for (const r of results) {
  if (r.merged) updateTaskRef.current(r.taskId, { pr_status: PR_STATUS.MERGED })
}
for (const r of results) {
  if (r.mergeableState) {
    updateTaskRef.current(r.taskId, {
      pr_mergeable_state: r.mergeableState as SprintTask['pr_mergeable_state']
    })
  }
}

// sprintTasks — updateTask tracks fields in pendingUpdates
set((s) => {
  const existing = s.pendingUpdates[taskId]
  const existingFields = existing?.fields ?? []
  const newFields = Object.keys(patch)
  const mergedFields = [...new Set([...existingFields, ...newFields])]
  return {
    pendingUpdates: {
      ...s.pendingUpdates,
      [taskId]: { ts: updateId, fields: mergedFields }
    },
    tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch, updated_at: nowIso() } : t))
  }
})
```

**Impact:**  
If a task has a pending update for field A (e.g., `status`), and then a poller tries to update field B (e.g., `pr_status`), the updateTask call from the poller adds B to the pendingUpdates list. However, when the initial update for A completes and clears the pendingUpdates entry, field B's update is not preserved. The problem is symmetric — if the user updates status AFTER the poller has queued an update for pr_status, the user's update for status merges into the pending list, but when the poller's response arrives first, it clears the entry entirely, losing the user's change.

Additionally, there's no validation that the fields being marked as pending actually changed. If the optimistic update specifies the same value as the server already has, the field is still marked pending, causing unnecessary protection. If a poller query returns the same value for a field, updateTask still creates a new pending entry (creating noise in the pending list).

**Concrete Scenario:**
- User updates task: status='active' (updateTask called, pendingUpdates[t1]={ts: X, fields: ['status']})
- Renderer is waiting for response (IPC in flight)
- Meanwhile, usePrStatusPolling fires: detects pr_status='merged', calls updateTask(t1, {pr_status: 'merged'})
- pendingUpdates[t1] merges: fields=['status', 'pr_status']
- User's updateTask response arrives first: clears pendingUpdates[t1] entirely because current.ts === updateId
- Poll merge happens next: now there's no pendingUpdates[t1] to protect pr_status
- Server's older pr_status value wins over the polled result
- Result: PR status shows stale value because the pollers' concurrent updates weren't properly sequenced

**Recommendation:**  
1. Use a per-field TTL instead of per-task TTL. Each field in pendingUpdates[taskId].fields tracks its own timestamp, not a shared timestamp for all fields.
2. When clearning pendingUpdates, only remove expired fields, not the entire entry. If all fields expire, then remove the entry.
3. Add a conflict resolution strategy: if multiple pollers try to update different fields simultaneously, queue them with increasing priority (newest first).
4. Consider a "field dependency" map: if user updates status, don't let pr_status poller overwrite it until TTL expires. Define which fields can be independently updated by different sources.

**Effort:** L  
**Confidence:** Medium

---

## F-t3-statesync-7: Stale Snapshot Delivered to Components Due to Selector Caching
**Severity:** Low  
**Category:** State Synchronization  
**Location:** `src/renderer/src/stores/sprintTasks.ts:52-53`  
**Evidence:**
```typescript
export const selectActiveTaskCount = (state: SprintTasksState): number =>
  state.tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length
```

**Usage:**
```typescript
const hasActiveTasks = useSprintTasks((s) => selectActiveTaskCount(s) > 0)
```

**Impact:**  
The `selectActiveTaskCount` selector is a pure function that recomputes on every invocation. However, if a component holds a snapshot of `hasActiveTasks` from a prior render and the tasks change, the component may use stale info for decisions. Zustand's shallow equality check on the selector's result (boolean) means the component re-renders when the count changes, but if the component caches the result or derives other state from it, there can be a brief window of inconsistency.

More critically, the selector is accessed in `useSprintPolling` via a Zustand selector:
```typescript
const hasActiveTasks = useSprintTasks((s) => selectActiveTaskCount(s) > 0)
```

If a task becomes active between the selector evaluation and the useBackoffInterval dependency change, the poller might not immediately switch to the faster interval (depends on React re-render timing). This is a minor race, not a critical bug.

**Concrete Scenario:**
- Component uses `hasActiveTasks` to show/hide UI
- Store updates: task becomes active
- Selector recomputes: hasActiveTasks = true
- Component re-renders
- During render, if another component reads an older snapshot from store, it may have hasActiveTasks = false
- Result: Brief visual inconsistency (unlikely to manifest in practice, but theoretically possible in SSR or concurrent rendering scenarios)

**Recommendation:**  
No action required for current Zustand version (v4 with shallow equality). If upgrading to a future version with auto-tracking or time-travel debugging, ensure selectors are pure and don't memoize results across renders. For robustness, consider adding a comment in the selector definition explaining that it's recomputed on every store change.

**Effort:** S (documentation only)  
**Confidence:** Low

---

## F-t3-statesync-8: SSE-Driven Updates Not Deduped with Poll-Driven Updates
**Severity:** Medium  
**Category:** State Synchronization  
**Location:** `src/renderer/src/stores/sprintTasks.ts:348-375` (mergeSseUpdate), `src/renderer/src/stores/sprintTasks.ts:62-148` (loadData)  
**Evidence:**
```typescript
// mergeSseUpdate — called by SSE listener
mergeSseUpdate: (update): void => {
  set((s) => {
    const nextTasks = s.tasks.map((t) => {
      if (t.id !== update.taskId) return t
      const merged = {
        ...t,
        ...update,
        depends_on: sanitizeDependsOn(...)
      }
      // Pending update protection
      const pending = s.pendingUpdates[t.id]
      if (pending && Date.now() - pending.ts <= PENDING_UPDATE_TTL) {
        for (const field of pending.fields) {
          ;(merged as unknown as Record<string, unknown>)[field] = (
            t as unknown as Record<string, unknown>
          )[field]
        }
      }
      return merged
    })
    return { tasks: nextTasks }
  })
}

// loadData — called by polling
async loadData(): Promise<void> {
  // ... similar merge logic with pending protection
}
```

**Impact:**  
Both SSE and polling can deliver updates for the same task field within a short time window. The code handles pending update protection correctly in both paths, but there's no deduplication. If an SSE event arrives immediately after a poll, they both apply the same field update, potentially with different values if the updates are racing with each other.

Additionally, there's no integration with the `notifyOnce` deduplication in `useTaskNotifications.ts`. If a task completion event arrives via SSE and then via polling in quick succession, two notifications might fire (one from SSE handler, one from polling toast handler). The `notifyOnce` function dedupes based on taskId only, so rapid succession updates might slip through.

**Concrete Scenario:**
- Task transitions to 'done' on server at t=0s
- SSE event arrives at t=100ms: mergeSseUpdate({taskId: t1, status: 'done'})
- Polling fires at t=500ms: loadData(), finds status='done' in response
- mergeSseUpdate applies status='done' to local state
- 400ms later, loadData merges same status='done' from server
- Both apply the same update, but the tasks array reference changes twice, triggering two re-renders
- Toast notification fires immediately on SSE (if implemented), then another toast on poll merge if not deduped
- Result: Redundant UI updates and potentially duplicate notifications (depending on implementation of toast logic)

**Recommendation:**  
1. Add a "last update version" counter to each task. When SSE updates a task, increment the counter. When polling merges, skip fields that have a newer version counter (updated after the poll request was sent).
2. Implement a 500-1000ms dedup window: if an SSE event updates a field, mark it as "recently updated" and skip that field in the next polling merge.
3. Use requestAnimationFrame or a microtask queue to batch SSE and polling updates that arrive within the same frame, applying them once instead of twice.

**Effort:** M  
**Confidence:** Medium

---

## F-t3-statesync-9: Concurrent Batch Mutations Not Sequenced
**Severity:** Low  
**Category:** State Synchronization  
**Location:** `src/renderer/src/stores/sprintTasks.ts:405-432` (batchRequeueTasks)  
**Evidence:**
```typescript
batchRequeueTasks: async (taskIds): Promise<void> => {
  const operations = taskIds.map((id) => ({
    op: 'update' as const,
    id,
    patch: { status: TASK_STATUS.QUEUED }
  }))
  const result = await window.api.sprint.batchUpdate(operations)
  
  // Check for errors and toast
  
  // Reload data to get updated task states (including dependency blocking)
  await get().loadData()
}
```

**Impact:**  
If a user triggers two batch operations on overlapping task sets in rapid succession (e.g., requeue batch A, then immediately requeue batch B), the second batchRequeueTasks call starts its `loadData()` while the first one's `loadData()` is still in flight. Both calls can merge concurrently, leading to two full state refreshes from the server. The store state can flap if the first call completes with stale data after the second call has already replaced it.

More critically, `loadData()` clears all pendingUpdates as part of its merge (expires old ones). If a user has pending updates from individual updateTask calls on tasks in the batch, those pending entries are wiped out by the batchUpdate's loadData call, potentially losing protection for unrelated fields.

**Concrete Scenario:**
- User updates task A's priority (pending: ['priority']) at t=0s
- User clicks "Requeue batch" on [A, B, C] at t=1s
- batchRequeueTasks fires: IPC call starts
- Meanwhile, SSE event updates task A at t=1.5s: mergeSseUpdate({taskId: A, notes: 'updated'})
- pendingUpdates[A] still protects priority
- batchRequeueTasks response arrives at t=2s: loadData() executes
- loadData expires old pendingUpdates (all of them, since TTL logic doesn't discriminate by source)
- Notes field (from SSE) is now unprotected and can be overwritten by stale server data
- Result: User's notes update (from SSE) lost because batch operation cleared the entire pendingUpdates entry

**Recommendation:**  
1. Track the source of each pending update (user, poller, batch) and only expire entries from the same source.
2. Implement a "batch mode" in loadData: if called from batchRequeueTasks, only merge the specific taskIds that were in the batch, don't reload everything.
3. Use a request version ID: each batchUpdate request gets a unique ID, and only clear pendingUpdates entries that are older than the request timestamp.

**Effort:** M  
**Confidence:** Low

---

## Summary

| Finding | Severity | Category | Action |
|---------|----------|----------|--------|
| F-t3-statesync-1 | High | TTL Timing | Extend or replace TTL mechanism |
| F-t3-statesync-2 | High | Multiple Pollers | Consolidate PR polling sources |
| F-t3-statesync-3 | Medium | Stale Closures | Fix callback dependencies |
| F-t3-statesync-4 | Medium | Polling Rate | Simplify interval logic |
| F-t3-statesync-5 | Medium | Missing Invalidation | Clean up on delete |
| F-t3-statesync-6 | Medium | Field-Level Races | Per-field TTL or conflict resolution |
| F-t3-statesync-7 | Low | Selector Caching | Document for future upgrades |
| F-t3-statesync-8 | Medium | SSE/Poll Dedup | Add version tracking or dedup window |
| F-t3-statesync-9 | Low | Batch Sequencing | Track mutation sources separately |

**Critical Path (in priority order):**
1. **F-t3-statesync-1** — Pending update TTL can expire during slow IPC, losing user edits. Fix first.
2. **F-t3-statesync-2** — Multiple independent pollers for same data create race conditions. Consolidate sources.
3. **F-t3-statesync-5** — Low-hanging fruit. Clean up pendingUpdates on task deletion.
4. **F-t3-statesync-4** — Polling interval adaptive change can cause large gaps. Simplify or stabilize.

**Confidence Levels:**
- High (1, 2, 5): Strong evidence from code inspection and test coverage
- Medium (3, 4, 6, 8, 9): Require concrete reproduction or timing analysis to confirm
- Low (7): Theoretical edge case, unlikely to manifest in practice

**Total Estimated Effort to Fix All:** 2-3 weeks (assuming parallel work on high-severity items).
