# Phase 1 Audit Remediation — Quick Wins

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 high-impact, low-effort issues identified in the BDE deep audit across Dashboard, AgentManager, and Sprint Center.

**Architecture:** Targeted fixes in existing files — no new modules. Dashboard gets polling for data freshness. AgentManager gets atomic slot reservation. Queue API gets pre-creation dep validation and WIP enforcement at the claim endpoint.

**Tech Stack:** TypeScript, React (Zustand), Electron IPC, Supabase, vitest

**Note:** Item #4 from original plan (override `updated_at` server-side) is already handled — `updated_at` is excluded from both `UPDATE_ALLOWLIST` and `GENERAL_PATCH_FIELDS`, so no client can set it via any API path.

---

## File Map

| File                                                      | Action | Responsibility                                   |
| --------------------------------------------------------- | ------ | ------------------------------------------------ |
| `src/renderer/src/views/DashboardView.tsx`                | Modify | Add polling interval + error handling            |
| `src/renderer/src/lib/constants.ts`                       | Modify | Add `POLL_DASHBOARD_INTERVAL` constant           |
| `src/renderer/src/views/__tests__/DashboardView.test.tsx` | Modify | Test polling + error handling                    |
| `src/main/agent-manager/index.ts`                         | Modify | Atomic slot reservation in drain loop            |
| `src/main/agent-manager/__tests__/index.test.ts`          | Modify | Test over-spawn prevention                       |
| `src/main/queue-api/task-handlers.ts`                     | Modify | Pre-creation dep validation + WIP limit on claim |
| `src/main/queue-api/__tests__/queue-api.test.ts`          | Modify | Test dep validation order + WIP enforcement      |
| `src/main/data/sprint-queries.ts`                         | Modify | Add `getActiveTaskCount()` helper                |
| `src/main/data/__tests__/sprint-queries.test.ts`          | Modify | Test `getActiveTaskCount()`                      |
| `src/shared/queue-api-contract.ts`                        | Modify | Add `MAX_ACTIVE_TASKS` constant                  |

---

### Task 1: Dashboard Polling & Error Handling

**Files:**

- Modify: `src/renderer/src/lib/constants.ts:57`
- Modify: `src/renderer/src/views/DashboardView.tsx:51-118`
- Modify: `src/renderer/src/views/__tests__/DashboardView.test.tsx`

**Context:** DashboardView fetches completionsPerHour, recentEvents, and PR count once on mount with empty `[]` dependency arrays. All three have `.catch(() => {})` — silent error swallowing. Data goes stale immediately and errors are invisible.

- [ ] **Step 1: Add dashboard polling constant**

In `src/renderer/src/lib/constants.ts`, add after line 12 (`POLL_HEALTH_CHECK_MS`):

```typescript
export const POLL_DASHBOARD_INTERVAL = 60_000 // 60s
```

- [ ] **Step 2: Write failing test for polling behavior**

In `src/renderer/src/views/__tests__/DashboardView.test.tsx`, add a test that verifies dashboard re-fetches data after the polling interval:

```typescript
it('re-fetches dashboard data on polling interval', async () => {
  vi.useFakeTimers()
  render(<DashboardView />)

  // Wait for initial fetch
  await waitFor(() => {
    expect(window.api.dashboard.completionsPerHour).toHaveBeenCalledTimes(1)
  })

  // Advance past polling interval
  await act(async () => {
    vi.advanceTimersByTime(60_000)
  })

  await waitFor(() => {
    expect(window.api.dashboard.completionsPerHour).toHaveBeenCalledTimes(2)
    expect(window.api.dashboard.recentEvents).toHaveBeenCalledTimes(2)
    expect(window.api.getPrList).toHaveBeenCalledTimes(2)
  })

  vi.useRealTimers()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/views/__tests__/DashboardView.test.tsx --reporter=verbose`
Expected: FAIL — currently only 1 call, never 2.

- [ ] **Step 4: Implement polling in DashboardView**

Replace the three separate `useEffect` hooks (lines 51-118) with a single `useEffect` that calls a shared `fetchDashboardData` function on mount and on an interval. **Critical: preserve the exact existing data transformations — only add polling + error logging.**

```typescript
import { POLL_DASHBOARD_INTERVAL } from '../lib/constants'

// Inside component, replace the three useEffect hooks with:

useEffect(() => {
  let cancelled = false

  async function fetchDashboardData(): Promise<void> {
    // Chart data — preserve exact accent colors and label mapping
    try {
      const data = await window.api.dashboard?.completionsPerHour()
      if (cancelled || !data) return
      const accents: Array<'cyan' | 'pink' | 'blue' | 'orange' | 'purple'> = [
        'cyan',
        'pink',
        'blue',
        'orange',
        'purple'
      ]
      setChartData(
        data.map((d, i) => ({
          value: d.count,
          accent: accents[i % accents.length],
          label: d.hour
        }))
      )
    } catch (err) {
      console.error('[Dashboard] Failed to fetch completions:', err)
    }

    // Events — preserve exact field mapping
    try {
      const events = await window.api.dashboard?.recentEvents(30)
      if (cancelled || !events) return
      setFeedEvents(
        events.map((e) => ({
          id: String(e.id),
          label: `${e.event_type}: ${e.agent_id}`,
          accent:
            e.event_type === 'error'
              ? ('red' as const)
              : e.event_type === 'complete'
                ? ('cyan' as const)
                : ('purple' as const),
          timestamp: e.timestamp
        }))
      )
    } catch (err) {
      console.error('[Dashboard] Failed to fetch events:', err)
    }

    // PR count — note: prs?.prs?.length (nested structure from getPrList)
    try {
      const prs = await window.api.getPrList()
      if (cancelled) return
      setPrCount(prs?.prs?.length ?? 0)
    } catch (err) {
      console.error('[Dashboard] Failed to fetch PR list:', err)
    }
  }

  fetchDashboardData()
  const interval = setInterval(fetchDashboardData, POLL_DASHBOARD_INTERVAL)

  return () => {
    cancelled = true
    clearInterval(interval)
  }
}, [])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/views/__tests__/DashboardView.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Write test for error logging**

```typescript
it('logs errors instead of swallowing them', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(window.api.dashboard.completionsPerHour).mockRejectedValueOnce(new Error('Network error'))

  render(<DashboardView />)

  await waitFor(() => {
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Dashboard] Failed to fetch completions:',
      expect.any(Error)
    )
  })

  consoleSpy.mockRestore()
})
```

- [ ] **Step 7: Run full test suite to verify no regressions**

Run: `npx vitest run src/renderer/src/views/__tests__/DashboardView.test.tsx --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/constants.ts src/renderer/src/views/DashboardView.tsx src/renderer/src/views/__tests__/DashboardView.test.tsx
git commit -m "fix: add 60s polling to Dashboard and replace silent error catches

Dashboard data was fetched once on mount and never refreshed. All three
IPC calls silently swallowed errors with .catch(() => {}). Now polls
every 60s and logs errors to console."
```

---

### Task 2: AgentManager Concurrency Slot Reservation

**Files:**

- Modify: `src/main/agent-manager/index.ts:200-290` (processQueuedTask + drainLoop)
- Modify: `src/main/agent-manager/__tests__/index.test.ts`

**Context:** `availableSlots()` is computed once at the top of `drainLoop` (line 318), then `processQueuedTask` is called in a loop. Each `processQueuedTask` does async work (dependency check, claim, worktree setup, spawn). During these awaits, the slot count is stale. If two tasks are processed concurrently within the same drain iteration, both can spawn even if only 1 slot was available. The `drainRunning` flag prevents concurrent drain iterations, but within a single drain, the sequential `for` loop with `await processQueuedTask()` means each task completes before the next starts — so the race is actually between the fetch limit and agents that get added to the map mid-loop. The real fix: re-check available slots before each task spawn.

- [ ] **Step 1: Write failing test for slot re-check**

In `src/main/agent-manager/__tests__/index.test.ts`, add:

```typescript
it('re-checks available slots before each task in drain loop', async () => {
  // Configure maxConcurrent=1
  // Mock getQueuedTasks to return 2 tasks (simulating stale fetch)
  // First processQueuedTask succeeds (spawns agent, fills slot)
  // Second processQueuedTask should be skipped (no slots left)
  // Verify only 1 agent spawned, second task NOT claimed
})
```

The exact mock setup depends on existing test patterns in the file — adapt to match.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/index.test.ts --reporter=verbose -t "re-checks"`
Expected: FAIL — currently all fetched tasks are processed regardless.

- [ ] **Step 3: Add slot re-check in drainLoop**

In `src/main/agent-manager/index.ts`, modify the drain loop's task iteration (around line 328). Add a slot check before each `processQueuedTask` call:

```typescript
for (const raw of queued) {
  if (shuttingDown) break
  // Re-check slots before each task — an earlier iteration may have filled a slot
  if (availableSlots(concurrency, activeAgents.size) <= 0) {
    logger.info('[agent-manager] No slots available — stopping drain iteration')
    break
  }
  try {
    await processQueuedTask(raw, taskStatusMap)
  } catch (err) {
    logger.error(
      `[agent-manager] Failed to process task ${(raw as Record<string, unknown>).id}: ${err}`
    )
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/index.test.ts --reporter=verbose -t "re-checks"`
Expected: PASS

- [ ] **Step 5: Run full agent-manager test suite**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/agent-manager/__tests__/ --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-manager/index.ts src/main/agent-manager/__tests__/index.test.ts
git commit -m "fix: re-check concurrency slots before each task in drain loop

Previously, available slots were computed once at drain start and all
fetched tasks were processed. If an earlier task filled the last slot,
subsequent tasks in the same drain iteration could over-spawn. Now
re-checks activeAgents.size before each processQueuedTask call."
```

---

### Task 3: Validate Dependencies Before Task Creation

**Files:**

- Modify: `src/main/queue-api/task-handlers.ts:118-242` (handleCreateTask)
- Modify: `src/main/queue-api/__tests__/queue-api.test.ts`

**Context:** `handleCreateTask` currently creates the task first (line 220), then validates dependencies for cycles/existence (lines 226-239). If validation fails, it attempts to delete the task as rollback (line 232). If the delete also fails, an orphaned task remains. Fix: validate deps BEFORE calling `createTask()`.

- [ ] **Step 1: Write test verifying deps validated before creation**

In `src/main/queue-api/__tests__/queue-api.test.ts`, add:

```typescript
it('rejects task with cycle-creating dependencies without creating the task', async () => {
  // Setup: existing task-a depends on task-b
  // Attempt: create task-b with depends_on: [{ id: 'task-a', type: 'hard' }]
  // Verify: createTask was NOT called (or called 0 times)
  // Verify: response is 400 with cycle error
  // Verify: deleteTask was NOT called (no rollback needed)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/queue-api/__tests__/queue-api.test.ts --reporter=verbose -t "cycle-creating"`
Expected: FAIL — currently createTask is called before validation.

- [ ] **Step 3: Move dependency validation before createTask**

In `src/main/queue-api/task-handlers.ts`, restructure `handleCreateTask`. Move the dependency cycle/existence validation (currently lines 226-239) to BEFORE the `createTask()` call (currently line 220). The new order:

```typescript
// 1. Required field validation (existing — title, repo)
// 2. Structural spec validation (existing)
// 3. Dependency structure validation (existing — array shape)
// 4. Auto-blocking check (existing — checkTaskDependencies)
// 5. NEW: Dependency cycle/existence validation BEFORE creation
if (dependsOn && dependsOn.length > 0) {
  const validationError = await validateDependencies('proposed-task', dependsOn)
  if (validationError) {
    sendJson(res, 400, { error: validationError })
    return
  }
}
// 6. Create the task (no rollback needed if deps already validated)
const task = await createTask(...)
// 7. Remove old post-creation validation block entirely
```

**Important:** `validateDependencies` currently takes `taskId` as first arg for cycle detection. For pre-creation, pass a temporary ID (e.g., `'pending-new-task'`). The cycle detection in `detectCycle` builds a graph from existing tasks + proposed deps, so it works with any ID that doesn't collide.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/queue-api/__tests__/queue-api.test.ts --reporter=verbose -t "cycle-creating"`
Expected: PASS

- [ ] **Step 5: Run full queue-api test suite**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/queue-api/__tests__/queue-api.test.ts --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/queue-api/task-handlers.ts src/main/queue-api/__tests__/queue-api.test.ts
git commit -m "fix: validate task dependencies before creation, not after

Dependency cycle/existence checks now run before createTask(), eliminating
the rollback-on-failure pattern that could orphan tasks if deleteTask()
also failed."
```

---

### Task 4: Enforce WIP Limit at API Layer

**Files:**

- Modify: `src/shared/queue-api-contract.ts`
- Modify: `src/main/data/sprint-queries.ts`
- Modify: `src/main/data/__tests__/sprint-queries.test.ts`
- Modify: `src/main/queue-api/task-handlers.ts` (handleClaim)
- Modify: `src/main/queue-api/__tests__/queue-api.test.ts`

**Context:** The WIP limit of 5 active tasks is only enforced in the Kanban UI (`KanbanBoard.tsx` line 79, `sprintTasks.ts` line 258, `useSprintTaskActions.ts` line 37). The Queue API `handleClaim` endpoint freely transitions tasks to `active` with no limit. External callers (task-runner, direct API) can bypass the WIP limit.

- [ ] **Step 1: Add MAX_ACTIVE_TASKS constant to shared contract**

In `src/shared/queue-api-contract.ts`, add:

```typescript
/** Maximum tasks allowed in 'active' status at any time (enforced at API layer) */
export const MAX_ACTIVE_TASKS = 5
```

- [ ] **Step 2: Add getActiveTaskCount helper to sprint-queries**

Write failing test first in `src/main/data/__tests__/sprint-queries.test.ts`:

```typescript
describe('getActiveTaskCount', () => {
  it('returns count of active tasks', async () => {
    // Mock Supabase to return { count: 3 }
    const count = await getActiveTaskCount()
    expect(count).toBe(3)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/sprint-queries.test.ts --reporter=verbose -t "getActiveTaskCount"`
Expected: FAIL — function doesn't exist yet.

- [ ] **Step 4: Implement getActiveTaskCount**

In `src/main/data/sprint-queries.ts`, add:

```typescript
export async function getActiveTaskCount(): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from('sprint_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')

  if (error) {
    // Fail-closed: return MAX to prevent new claims when Supabase is down.
    // This is intentional — better to block claims than to over-saturate.
    logger.warn(`[sprint-queries] getActiveTaskCount failed: ${error}`)
    return Infinity
  }
  return count ?? 0
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/data/__tests__/sprint-queries.test.ts --reporter=verbose -t "getActiveTaskCount"`
Expected: PASS

- [ ] **Step 6: Write failing test for WIP enforcement in handleClaim**

In `src/main/queue-api/__tests__/queue-api.test.ts`, add:

```typescript
it('rejects claim when active task count is at WIP limit', async () => {
  // Mock getActiveTaskCount to return 5
  // Attempt to claim a queued task
  // Verify: response is 409 with WIP limit error
  // Verify: claimTask was NOT called
})

it('allows claim when active task count is below WIP limit', async () => {
  // Mock getActiveTaskCount to return 4
  // Attempt to claim a queued task
  // Verify: claimTask was called
  // Verify: response is 200
})
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/queue-api/__tests__/queue-api.test.ts --reporter=verbose -t "WIP limit"`
Expected: FAIL — no WIP check exists yet.

- [ ] **Step 8: Add WIP limit check to handleClaim**

In `src/main/queue-api/task-handlers.ts`, in `handleClaim` after executor validation (line 409) and before calling `claimTask` (line 411):

```typescript
import { getActiveTaskCount } from '../data/sprint-queries'
import { MAX_ACTIVE_TASKS } from '../../shared/queue-api-contract'

// ... inside handleClaim, after executorId validation:

// Enforce WIP limit — prevent more than MAX_ACTIVE_TASKS active tasks.
// Note: TOCTOU race exists between this check and claimTask() below.
// Acceptable because BDE's drain loop is the primary caller and runs
// sequentially. For true atomicity, this would need a Supabase RPC.
const activeCount = await getActiveTaskCount()
if (activeCount >= MAX_ACTIVE_TASKS) {
  sendJson(res, 409, {
    error: `WIP limit reached (${activeCount}/${MAX_ACTIVE_TASKS} active tasks). Complete or cancel an active task first.`
  })
  return
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run --config src/main/vitest.main.config.ts src/main/queue-api/__tests__/queue-api.test.ts --reporter=verbose -t "WIP limit"`
Expected: PASS

- [ ] **Step 10: Update renderer to use shared constant**

In `src/renderer/src/lib/constants.ts`, replace:

```typescript
export const WIP_LIMIT_IN_PROGRESS = 5
```

with:

```typescript
// WIP limit is also enforced server-side via MAX_ACTIVE_TASKS in queue-api-contract
export const WIP_LIMIT_IN_PROGRESS = 5
```

(Keep the local constant for now — renderer can't import from shared directly in some Electron setups. The comment documents the coupling.)

- [ ] **Step 11: Run full test suite**

Run: `npm test && npm run test:main`
Expected: All tests PASS

- [ ] **Step 12: Commit**

```bash
git add src/shared/queue-api-contract.ts src/main/data/sprint-queries.ts src/main/data/__tests__/sprint-queries.test.ts src/main/queue-api/task-handlers.ts src/main/queue-api/__tests__/queue-api.test.ts src/renderer/src/lib/constants.ts
git commit -m "fix: enforce WIP limit at Queue API claim endpoint

WIP limit of 5 active tasks was only enforced in the Kanban UI. The
Queue API handleClaim endpoint now checks getActiveTaskCount() before
allowing a task to transition to active. Returns 409 if limit is reached."
```

---

### Task 5: Final Verification

- [ ] **Step 1: Run full test suite with coverage**

```bash
cd ~/projects/BDE
npm run test:coverage
npm run test:main
npm run typecheck
```

Expected: All pass, coverage thresholds met (72% stmts, 66% branches, 70% functions, 74% lines).

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 3: Final commit (if any fixups needed)**

Only if test/build required adjustments.
