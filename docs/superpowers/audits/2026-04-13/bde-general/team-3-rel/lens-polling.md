# Polling & Interval Audit — Team 3 (Reliability)
**Date:** 2026-04-13  
**Auditor:** Claude (Polling & Interval Lens)  
**Scope:** Raw setInterval usage, jitter correctness, interval timing, memory leaks, polling consolidation

## Overall Assessment
BDE's polling infrastructure is well-structured overall. The `useBackoffInterval` hook is properly adopted across all major polling points in the renderer, with good cleanup on unmount and adaptive backoff on errors. Main-process pollers (sprint PR and GitHub PR) correctly use staggered startup delays and single-interval architectures. However, there are several issues identified:

1. **useBackoffInterval dependency array** has a critical flaw that can cause unnecessary interval recreation and timer leaks
2. **Jitter is often not configured** on polling hooks, creating thundering herd risk across multiple clients
3. **No explicit jitter on main-process pollers** despite co-scheduling with renderer polling
4. **Duplicate polling** of the same data via multiple independent hooks
5. **Dangling setTimeout/setInterval in stores** (non-polling, but interval management issues)

---

## F-t3-polling-1: useBackoffInterval Dependency Array Breaks When Options Change
**Severity:** High  
**Category:** Polling & Intervals  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useBackoffInterval.ts:83`

**Evidence:**
```typescript
}, [baseMs, options.maxMs, options.jitterMs, options.backoffFactor])
```

The dependency array destructures individual option properties. However:
- Options object is typically created inline as `{ maxMs: 10_000 }` in caller
- Each render, a new object is passed, even if its values haven't changed
- This causes React to see "new dependency" and teardown/rebuild the effect on every render where options are inline literals
- Results in timer recreation, potential leaks, and lost state (currentInterval reverts to baseMs)

**Example from DashboardView (line 34):**
```typescript
useBackoffInterval(() => setNow(Date.now()), 10_000)  // no options — OK
```

**Bad example from ConsoleHeader (line 51):**
```typescript
useBackoffInterval(fetchCtx, 3000, { maxMs: 10_000 })  // new object every render
```

**Impact:**
- Interval is recreated on every parent re-render, defeating exponential backoff
- If a poll is failing and has accumulated backoff (e.g., 16s), next render resets it to 3s
- Wasted timers accumulate and may not be fully cleaned up in error scenarios
- Performance regression for components that re-render frequently

**Recommendation:**
Move the options object outside the component (as a constant) or use `useMemo` to stabilize it:
```typescript
// Option 1: Extract as constant
const FETCH_CTX_OPTIONS = { maxMs: 10_000 };
useBackoffInterval(fetchCtx, 3000, FETCH_CTX_OPTIONS);

// Option 2: Memoize inline options
const ctxOptions = useMemo(() => ({ maxMs: 10_000 }), []);
useBackoffInterval(fetchCtx, 3000, ctxOptions);
```

Alternatively, change the dependency array to `[baseMs]` only if options never change (most common case), and document that options must be stable.

**Effort:** M  
**Confidence:** High

---

## F-t3-polling-2: Missing Jitter on Main Polling Hooks — Thundering Herd Risk
**Severity:** High  
**Category:** Polling & Intervals  
**Location:** Multiple files: `useDashboardPolling.ts:13`, `useAgentSessionPolling.ts:13`, `useCostPolling.ts:13`, `useHealthCheck.ts:25`, `usePrStatusPolling.ts:97`, `useGitStatusPolling.ts:14`, `useSprintPolling.ts:21`

**Evidence:**
All major polling hooks call `useBackoffInterval()` **without explicit jitter options**, relying on the 10% default:

```typescript
// useBackoffInterval applies jitter: Math.round(Math.random() * (baseMs * 0.1))
// = for 60s polls, jitter is 0-6s (default 10%)
useBackoffInterval(fetchAll, POLL_DASHBOARD_INTERVAL)  // 60s poll, 10% jitter = 0-6s

useBackoffInterval(fetchAgents, POLL_SESSIONS_INTERVAL)  // 10s poll, 10% jitter = 0-1s

useBackoffInterval(fetchLocalAgents, POLL_COST_INTERVAL)  // 30s poll, 10% jitter = 0-3s
```

The jitter _is_ applied by default (10% of baseMs), but:
- **No explicit configuration** means maintainers don't see jitter is happening
- **Too small for high-contention APIs**: If 50+ clients all poll GitHub at 60s intervals, even 6s jitter may not be enough
- **Inconsistent across pollers**: Some polls (1s logs, 5s processes) have very small jitter (0-100ms)

**Impact:**
- In multi-client scenarios (e.g., CI/CD running many BDE instances), polls fire in lockstep
- Causes thundering herd on GitHub API (rate limiting, increased latency)
- If GitHub responds slowly, all clients wait together, then retry together
- Load sampler (5s POLL_LOAD_AVERAGE) with <500ms jitter has minimal spread

**Recommendation:**
- Make jitter explicit and proportional to API sensitivity:
  ```typescript
  // For slow/rate-limited APIs, increase jitter to 15-25%
  useBackoffInterval(fetchAll, POLL_DASHBOARD_INTERVAL, { jitterMs: 9000 })  // 15s jitter for 60s poll
  useBackoffInterval(fetchAgents, POLL_SESSIONS_INTERVAL, { jitterMs: 1500 })  // 15s jitter for 10s poll
  ```
- Document jitter expectations in CLAUDE.md
- Consider staggering multiple pollers within a single client (not all at once)

**Effort:** S  
**Confidence:** High

---

## F-t3-polling-3: Duplicate Polling of Sprint Data — Multiple Independent Fetches
**Severity:** Medium  
**Category:** Polling & Intervals  
**Location:** `useSprintPolling.ts:21`, `usePrStatusPolling.ts:34-41` (both load from sprintTasks store)

**Evidence:**
Two independent polling hooks fetch overlapping sprint data:

1. **useSprintPolling** (every 30-120s):
   ```typescript
   useBackoffInterval(loadData, sprintPollMs)  // loads full sprint tasks
   ```

2. **usePrStatusPolling** (every 60s):
   ```typescript
   const pollPrStatuses = useCallback(async (taskList: SprintTask[]) => {
     const withPr = taskList.filter((t) => t.pr_url && !prMergedRef.current[t.id])
     if (withPr.length === 0) return
     try {
       const results = await window.api.pollPrStatuses(...)
   ```

Both:
- Poll at different intervals (30s vs 60s)
- Access the same `sprintTasks` store
- Trigger updates to the same store (updateTask)
- Have their own backoff logic independent from each other

If sprint tasks have 10 PRs, **pollPrStatuses fires an independent API call every 60s**, while **loadData fires separately every 30-120s**. This is intentional (PR polling is specialized), but the combination creates:
- Two separate API calls to potentially the same backend resources
- Uncorrelated backoff (PR poller may back off while sprint poller continues)
- No de-duplication if both fire at nearly the same time

**Impact:**
- Extra load on backend (duplicated query for PR metadata)
- No consolidated error handling (each poller backs off independently)
- If PR poller fails, user won't know sprint data is fresh until next sprint poll

**Recommendation:**
Consider whether PR polling should be consolidated into the main sprint load, or at minimum:
- Document the co-polling behavior in CLAUDE.md
- Ensure both pollers have synchronized error notification
- Consider making `usePrStatusPolling` a specialization that fires on-demand (when PR urls appear) rather than on a fixed interval

**Effort:** M  
**Confidence:** Medium

---

## F-t3-polling-4: useBackoffInterval Re-exports Jitter But Options Not Spread in Dependency Array
**Severity:** Medium  
**Category:** Polling & Intervals  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useBackoffInterval.ts:20-24, 83`

**Evidence:**
```typescript
interface BackoffOptions {
  maxMs?: number
  jitterMs?: number
  backoffFactor?: number
}

// Dependency array destructures properties:
}, [baseMs, options.maxMs, options.jitterMs, options.backoffFactor])
```

Problem: If a caller passes an _object reference_ that is stable but its _properties_ change, React won't detect it:

```typescript
// Scenario: options object is cached but we want to change jitter
const [jitterMs, setJitterMs] = useState(100);
const options = useMemo(() => ({ jitterMs }), [jitterMs]);  // stable object, changing jitter
useBackoffInterval(poll, 60000, options);
```

The dependency array reads `options.jitterMs`, which changes, and React will re-run the effect. But this is fragile — if the object is inline and options object is not the dependency, we miss the change.

**Impact:**
- Confusing behavior if caller tries to change jitter dynamically
- Easy to introduce bugs where jitter changes don't take effect
- Difficult to detect in testing because most use cases are static

**Recommendation:**
Either:
1. Make `options` itself a dependency (not its properties), OR
2. Deep-compare options and warn if it changes, OR
3. Document that options must be stable and provide a `useBackoffOptions` helper

**Effort:** S  
**Confidence:** Medium

---

## F-t3-polling-5: useBackoffInterval Does Not Re-initialize Jitter on Success
**Severity:** Low  
**Category:** Polling & Intervals  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/hooks/useBackoffInterval.ts:54-55`

**Evidence:**
```typescript
try {
  await savedCallback.current()
  currentInterval = intervalMs  // reset to base on success
} catch {
  currentInterval = Math.min(currentInterval * backoffFactor, maxMs)
}
schedule()  // uses currentInterval + jitter()
```

When a poll succeeds and `currentInterval` resets to `intervalMs`, the jitter is recalculated on the next tick. This is correct. However:

The jitter value itself is recalculated every time `jitter()` is called:
```typescript
function jitter(): number {
  return Math.round(Math.random() * jitterMs)  // 0 to jitterMs (up to 10% base by default)
}
```

This means:
- On success after failure: new jitter is drawn (good, adds spread)
- On failure: jitter is also re-drawn (good, adds spread to backoff too)

Actually, this is fine. No issue here, just documenting the behavior.

**Impact:** None — this is correct behavior.

---

## F-t3-polling-6: setInterval in bootstrap.ts Not Marked as "Cleanup at Shutdown"
**Severity:** Medium  
**Category:** Polling & Intervals  
**Location:** `/Users/ryan/projects/BDE/src/main/bootstrap.ts:77-78, 118-128, 162-172, 175-186`

**Evidence:**
Multiple `setInterval` calls for background tasks (backup, event pruning, diff snapshot cleanup):

```typescript
// Line 77: Backup database every 24 hours
const backupInterval = setInterval(backupDatabase, BACKUP_INTERVAL_MS)
app.on('will-quit', () => clearInterval(backupInterval))

// Line 118: Prune old agent events
const pruneEventsInterval = setInterval(
  () => { pruneOldEvents(...) },
  24 * 60 * 60 * 1000
)
app.on('will-quit', () => clearInterval(pruneEventsInterval))

// Line 162, 175: Similar patterns for changes and diff snapshots
```

All are correctly cleaned up on `will-quit`, which is good. However:

- No logging to indicate these intervals are running (hard to debug if one is stuck)
- No error handling if the cleanup callback fails
- Magic number intervals (24h) appear multiple times (should be constants)
- No graceful draining — if a backup is in-flight when `will-quit` fires, it may be orphaned

**Impact:**
- If backup/prune operation hangs, app quit will wait for its timeout
- Difficult to audit which intervals are active without reading code
- If `will-quit` doesn't fire (crash), these intervals may leak

**Recommendation:**
- Extract interval constants (24h appears 3 times)
- Add logging on interval creation/cleanup
- Consider a centralized interval registry for visibility
- Add timeout safeguards to backup/prune operations

**Effort:** S  
**Confidence:** Medium

---

## F-t3-polling-7: Console-Only Error Logging in Polling Hooks — Silent Failures
**Severity:** Low  
**Category:** Polling & Intervals  
**Location:** `usePrStatusPolling.ts:83-85`, `useHealthCheck.ts:17-19`

**Evidence:**
```typescript
// usePrStatusPolling.ts — no error visibility
try {
  const results = await window.api.pollPrStatuses(...)
  // ...
} catch {
  // gh CLI unavailable — degrade gracefully
}

// useHealthCheck.ts — same pattern
try {
  const stuck = await window.api.sprint.healthCheck()
  // ...
} catch {
  /* silent */
}
```

Errors are silently swallowed. No logging, no toast, no store update. If the gh CLI is unavailable or health check fails, user has no signal.

**Impact:**
- Silent degradation makes it hard to debug why PR status isn't updating
- User might think their PR has been merged when it hasn't
- No visibility into health check failures

**Recommendation:**
- Log errors to console in dev, or post a persistent (not auto-dismiss) toast
- Store error state in the respective stores so UI can display "PR status check failed"

**Effort:** S  
**Confidence:** High

---

## F-t3-polling-8: POLL_LOG_INTERVAL (1s) Is Extremely Aggressive — Causes High CPU
**Severity:** Medium  
**Category:** Polling & Intervals  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/lib/constants.ts:2`

**Evidence:**
```typescript
export const POLL_LOG_INTERVAL = 1_000  // 1 second
export const POLL_PROCESSES_INTERVAL = 5_000
export const POLL_AGENTS_INTERVAL = 10_000
```

The 1-second log polling is defined but **not used in any hook or component** (confirmed via grep). However, it's available for use and if any view or hook picks it up:

- 1s polling means the view re-renders at 1 Hz
- With 50+ tasks, each with logs, this could be 1000+ DOM updates/sec
- Event handlers on log viewers (scroll position, selection) would fire constantly

**Impact:**
- High CPU and GPU usage if ever instantiated
- Battery drain on laptops
- Potential memory pressure from rapid DOM churn

**Recommendation:**
- If log polling is not in active use, remove the constant
- If it's intended for future use, document the minimum polling interval (suggest 5-10s for tail behavior)
- Cap log view updates to max 2-4 Hz regardless of poll rate

**Effort:** S  
**Confidence:** Medium

---

## F-t3-polling-9: POLL_HEALTH_CHECK_MS (600s) May Be Too Infrequent — No User Feedback
**Severity:** Low  
**Category:** Polling & Intervals  
**Location:** `/Users/ryan/projects/BDE/src/renderer/src/lib/constants.ts:13`

**Evidence:**
```typescript
export const POLL_HEALTH_CHECK_MS = 600_000  // 10 minutes
```

Health check runs every 10 minutes. If a task gets stuck, the user won't know about it for up to 10 minutes. The health check updates the store, but there's no user-visible notification when a task is detected as stuck.

**Impact:**
- Stuck tasks aren't surfaced to user until the next health check
- User might waste time debugging a task that's already flagged as stuck
- No indication in UI that a health check is pending or has failed

**Recommendation:**
- Add a health check status badge to the dashboard
- Consider shortening to 5 minutes if CPU/API permits
- Add real-time stuck-task detection (via agent timeout signals) as a complement

**Effort:** M  
**Confidence:** Low

---

## Summary Table

| Finding | Severity | Category | Effort | Status |
|---------|----------|----------|--------|--------|
| F-t3-polling-1 | High | Polling & Intervals | M | Open |
| F-t3-polling-2 | High | Polling & Intervals | S | Open |
| F-t3-polling-3 | Medium | Polling & Intervals | M | Open |
| F-t3-polling-4 | Medium | Polling & Intervals | S | Open |
| F-t3-polling-5 | Low | Polling & Intervals | N/A | Working As Designed |
| F-t3-polling-6 | Medium | Polling & Intervals | S | Open |
| F-t3-polling-7 | Low | Polling & Intervals | S | Open |
| F-t3-polling-8 | Medium | Polling & Intervals | S | Open |
| F-t3-polling-9 | Low | Polling & Intervals | M | Open |

---

## Notes for Reviewer
- **useBackoffInterval** is well-designed overall, but the dependency array issue (F-t3-polling-1) is a real bug that can cause timer leaks
- **Jitter is applied** by default (10%) but is often too small for multi-client scenarios — make it explicit
- **Main process pollers** (sprint-pr-poller.ts, pr-poller.ts) are correctly structured with proper cleanup
- **Duplicate polling** (sprint + PR) is intentional but worth documenting
- **Silent error handling** in polling hooks makes debugging harder — add visible error states

