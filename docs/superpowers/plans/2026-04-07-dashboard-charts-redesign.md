# Dashboard Charts Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the decorative dashboard sparklines with real axis-bearing charts, add a CPU load average chart fed by a main-process sampler, consolidate status counters into a compact rail, and collapse the attention/failure UI into a single Fires strip that includes system load saturation.

**Architecture:** Three layers. (1) Main process gains a new `load-sampler.ts` service holding a 120-sample ring buffer + a new IPC channel. (2) `dashboard-handlers.ts` gets one SQL query updated to return success/fail split per hour. (3) Renderer replaces 5 dashboard components with 5 new ones (ThroughputChart, SuccessRateChart, LoadAverageChart, FiresStrip, StatusRail), deletes 5 obsolete ones (SuccessRing, SuccessTrendChart, SpecTypeSuccessRate, FailureBreakdown, StatusCounters), and extends `useDashboardMetrics` + `useDashboardDataStore`.

**Tech Stack:** TypeScript (strict), React 19, Zustand, Vitest + Testing Library, Electron IPC, SQLite (better-sqlite3), SVG (no chart library).

**Spec:** `docs/superpowers/specs/2026-04-07-dashboard-charts-redesign-design.md`

**Worktree convention:** Create a worktree before starting: `git worktree add -b feat/dashboard-charts-redesign ~/worktrees/BDE/dashboard-charts-redesign main`

**Before EVERY commit:** `npm run typecheck && npm test && npm run lint` — CLAUDE.md requires all three green.

---

## Task Overview

| #   | Task                                     | Files touched                                                                                                                                                      | Depends on |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | Preflight — confirm no hidden consumers  | grep burndown / SuccessRing                                                                                                                                        | —          |
| 2   | Backend: load-sampler service (pure)     | `src/main/services/load-sampler.ts` + tests                                                                                                                        | —          |
| 3   | Backend: throughput SQL split            | `src/main/handlers/dashboard-handlers.ts` + tests                                                                                                                  | —          |
| 4   | Backend: IPC channel + handler + preload | `ipc-channels.ts`, `dashboard-handlers.ts`, `preload/index.ts`, `main/index.ts`                                                                                    | 2, 3       |
| 5   | Store: `useDashboardDataStore` updates   | `stores/dashboardData.ts` + tests                                                                                                                                  | 4          |
| 6   | Metrics hook extensions                  | `hooks/useDashboardMetrics.ts` + tests                                                                                                                             | 5          |
| 7   | Component: `ThroughputChart`             | `components/dashboard/ThroughputChart.tsx` + tests                                                                                                                 | 5          |
| 8   | Component: `SuccessRateChart`            | `components/dashboard/SuccessRateChart.tsx` + tests                                                                                                                | —          |
| 9   | Component: `LoadAverageChart`            | `components/dashboard/LoadAverageChart.tsx` + tests                                                                                                                | 5          |
| 10  | Component: `FiresStrip`                  | `components/dashboard/FiresStrip.tsx` + tests                                                                                                                      | 6          |
| 11  | Component: `StatusRail`                  | `components/dashboard/StatusRail.tsx` + tests                                                                                                                      | 6          |
| 12  | Integrate into `DashboardView`           | `views/DashboardView.tsx`, `components/dashboard/CenterColumn.tsx`, `components/dashboard/index.ts`                                                                | 7–11       |
| 13  | Delete obsolete code                     | `SuccessRing.tsx`, `SuccessTrendChart.tsx`, `SpecTypeSuccessRate.tsx`, `FailureBreakdown.tsx`, `StatusCounters.tsx`, `ChartsSection.tsx`, burndown types/functions | 12         |
| 14  | Verification + screenshots + PR          | —                                                                                                                                                                  | 13         |

---

### Task 1: Preflight — confirm no hidden consumers of removed code

**Files:** none (read-only investigation)

This is cheap insurance before we rip things out in task 13. If a consumer exists outside the dashboard view, we must find it now.

- [ ] **Step 1: Grep for burndown consumers**

Run:

```bash
rg -n "burndown|Burndown|burnDown|BurnDown" src/ --type ts --type tsx
```

Expected: only matches in `ChartsSection.tsx`, `CenterColumn.tsx`, `DashboardView.tsx`, `stores/dashboardData.ts`, `main/handlers/dashboard-handlers.ts`, `shared/ipc-channels.ts`, `preload/index.ts`, and their tests. Flag any other consumer (e.g. MorningBriefing, unrelated hooks) — if found, STOP and escalate before proceeding.

- [ ] **Step 2: Grep for `SuccessRing`, `SuccessTrendChart`, `SpecTypeSuccessRate`, `FailureBreakdown`, `StatusCounters`**

Run:

```bash
rg -n "SuccessRing|SuccessTrendChart|SpecTypeSuccessRate|FailureBreakdown|StatusCounters" src/ --type ts --type tsx
```

Expected: only matches inside `components/dashboard/` and its tests, plus `components/dashboard/index.ts` and consumers in `views/DashboardView.tsx` / `components/dashboard/CenterColumn.tsx` / `ChartsSection.tsx`. Anything else → STOP.

- [ ] **Step 3: Verify `started_at` is populated on active tasks**

Run:

```bash
rg -n "started_at" src/main/data/sprint-queries.ts src/main/handlers/sprint-local.ts src/shared/types.ts
```

Expected: `started_at` is populated by the agent-manager and manual transitions. If there is any path that creates an `active` task without setting `started_at`, the stuck-detection code in Task 6 must guard with a null check. **Document whatever you find** as a comment on the stuck-detection code in Task 6.

- [ ] **Step 4: No commit — this is read-only investigation.** Record findings in your working notes.

---

### Task 2: Load-sampler service (pure, main-process, no IPC yet)

**Files:**

- Create: `src/main/services/load-sampler.ts`
- Create: `src/main/services/__tests__/load-sampler.test.ts`

Pure ring buffer + timer lifecycle. Testable in isolation without Electron.

- [ ] **Step 1: Write failing tests**

Create `src/main/services/__tests__/load-sampler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    default: {
      ...actual,
      loadavg: vi.fn(() => [1, 2, 3]),
      cpus: vi.fn(() => new Array(8).fill({ model: 'fake' }))
    },
    loadavg: vi.fn(() => [1, 2, 3]),
    cpus: vi.fn(() => new Array(8).fill({ model: 'fake' }))
  }
})

import {
  startLoadSampler,
  stopLoadSampler,
  getLoadSnapshot,
  _resetForTests,
  SAMPLE_INTERVAL_MS,
  BUFFER_SIZE
} from '../load-sampler'

describe('load-sampler', () => {
  beforeEach(() => {
    _resetForTests()
    vi.useFakeTimers()
    vi.mocked(os.loadavg).mockReturnValue([1, 2, 3])
  })

  afterEach(() => {
    stopLoadSampler()
    vi.useRealTimers()
  })

  it('returns cpuCount from os.cpus().length', () => {
    startLoadSampler()
    expect(getLoadSnapshot().cpuCount).toBe(8)
  })

  it('seeds a sample immediately on start', () => {
    startLoadSampler()
    const snap = getLoadSnapshot()
    expect(snap.samples).toHaveLength(1)
    expect(snap.samples[0]).toMatchObject({ load1: 1, load5: 2, load15: 3 })
    expect(snap.samples[0].t).toBeTypeOf('number')
  })

  it('adds a sample on each interval tick', () => {
    startLoadSampler()
    vi.mocked(os.loadavg).mockReturnValue([4, 5, 6])
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)
    expect(getLoadSnapshot().samples).toHaveLength(2)
    expect(getLoadSnapshot().samples[1]).toMatchObject({ load1: 4, load5: 5, load15: 6 })
  })

  it('evicts oldest samples at BUFFER_SIZE capacity', () => {
    startLoadSampler()
    for (let i = 0; i < BUFFER_SIZE + 10; i++) {
      vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)
    }
    expect(getLoadSnapshot().samples).toHaveLength(BUFFER_SIZE)
  })

  it('getLoadSnapshot returns a copy, not a reference', () => {
    startLoadSampler()
    const a = getLoadSnapshot().samples
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)
    const b = getLoadSnapshot().samples
    expect(a).not.toBe(b)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(2)
  })

  it('startLoadSampler is idempotent', () => {
    startLoadSampler()
    startLoadSampler()
    startLoadSampler()
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)
    // If it weren't idempotent, 3 timers × 1 tick = 3 new samples
    expect(getLoadSnapshot().samples).toHaveLength(2) // seed + 1 tick
  })

  it('stopLoadSampler halts sampling', () => {
    startLoadSampler()
    stopLoadSampler()
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS * 5)
    expect(getLoadSnapshot().samples).toHaveLength(1) // only the seed
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npx vitest run src/main/services/__tests__/load-sampler.test.ts`
Expected: FAIL — `load-sampler` module not found.

- [ ] **Step 3: Implement the sampler**

Create `src/main/services/load-sampler.ts`:

```typescript
import os from 'node:os'

export interface LoadSample {
  t: number
  load1: number
  load5: number
  load15: number
}

export const SAMPLE_INTERVAL_MS = 5_000
export const BUFFER_SIZE = 120 // 10 minutes at 5s

let ring: LoadSample[] = []
let timer: NodeJS.Timeout | null = null
let cpuCount = os.cpus().length

function sample(): void {
  const [load1, load5, load15] = os.loadavg()
  ring.push({ t: Date.now(), load1, load5, load15 })
  if (ring.length > BUFFER_SIZE) ring.shift()
}

export function startLoadSampler(): void {
  if (timer) return
  // Refresh cpuCount in case of unusual hotplug scenarios
  cpuCount = os.cpus().length
  sample() // seed immediately so consumers see something
  timer = setInterval(sample, SAMPLE_INTERVAL_MS)
  timer.unref?.() // don't hold the process open in tests
}

export function stopLoadSampler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getLoadSnapshot(): { samples: LoadSample[]; cpuCount: number } {
  // Return a copy so callers can't mutate internal state
  return { samples: ring.slice(), cpuCount }
}

/** @internal Test-only: wipe buffer + timer. */
export function _resetForTests(): void {
  stopLoadSampler()
  ring = []
  cpuCount = os.cpus().length
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run src/main/services/__tests__/load-sampler.test.ts`
Expected: 7 tests PASS.

- [ ] **Step 5: Verify typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/main/services/load-sampler.ts src/main/services/__tests__/load-sampler.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/load-sampler.ts src/main/services/__tests__/load-sampler.test.ts
git commit -m "feat(dashboard): add load-sampler service for CPU load average tracking"
```

---

### Task 3: Throughput SQL — split success vs failed

**Files:**

- Modify: `src/main/handlers/dashboard-handlers.ts` (function `getCompletionsPerHour` — lines 5-22)
- Modify: `src/main/handlers/__tests__/dashboard-handlers.test.ts`
- Modify: `src/shared/ipc-channels.ts` (interface `CompletionBucket` — line 684)

- [ ] **Step 1: Update the shared `CompletionBucket` type**

In `src/shared/ipc-channels.ts`, change:

```typescript
export interface CompletionBucket {
  hour: string
  count: number
}
```

to:

```typescript
export interface CompletionBucket {
  hour: string
  successCount: number
  failedCount: number
}
```

- [ ] **Step 2: Update the handler test**

Find the existing `getCompletionsPerHour` test block in `src/main/handlers/__tests__/dashboard-handlers.test.ts`. Add these expectations (keep any existing tests that still make sense):

```typescript
it('returns success/failed split per hour', () => {
  // setup: insert 3 done + 1 failed run in the same hour, and 2 done in another hour
  const db = getDb()
  const now = Date.now()
  const stmt = db.prepare(
    `INSERT INTO agent_runs (id, status, started_at, finished_at) VALUES (?, ?, ?, ?)`
  )
  stmt.run('r1', 'done', new Date(now).toISOString(), now)
  stmt.run('r2', 'done', new Date(now).toISOString(), now)
  stmt.run('r3', 'done', new Date(now).toISOString(), now)
  stmt.run('r4', 'failed', new Date(now).toISOString(), now)
  stmt.run('r5', 'done', new Date(now - 3600_000).toISOString(), now - 3600_000)
  stmt.run('r6', 'done', new Date(now - 3600_000).toISOString(), now - 3600_000)

  const result = getCompletionsPerHour()

  // Find both hours
  const currentHour = result.find((b) => b.successCount === 3 && b.failedCount === 1)
  const priorHour = result.find((b) => b.successCount === 2 && b.failedCount === 0)
  expect(currentHour).toBeDefined()
  expect(priorHour).toBeDefined()
})

it('returns empty array when no runs in the last 24h', () => {
  const result = getCompletionsPerHour()
  expect(result).toEqual([])
})
```

Remove/update any older test that asserts the `count` field.

- [ ] **Step 3: Run tests — expect failure**

Run: `npx vitest run src/main/handlers/__tests__/dashboard-handlers.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 4: Update the SQL**

In `src/main/handlers/dashboard-handlers.ts`, replace the `getCompletionsPerHour` function body:

```typescript
export function getCompletionsPerHour(): {
  hour: string
  successCount: number
  failedCount: number
}[] {
  const db = getDb()
  const rows = db
    .prepare(
      `
    SELECT
      strftime('%Y-%m-%dT%H:00:00', finished_at / 1000, 'unixepoch', 'localtime') AS hour,
      SUM(CASE WHEN status = 'done'   THEN 1 ELSE 0 END) AS successCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
    FROM agent_runs
    WHERE finished_at IS NOT NULL
      AND finished_at > (strftime('%s', 'now', '-24 hours') * 1000)
    GROUP BY hour
    ORDER BY hour ASC
  `
    )
    .all() as { hour: string; successCount: number; failedCount: number }[]
  return rows
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npx vitest run src/main/handlers/__tests__/dashboard-handlers.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Typecheck (will fail in renderer — that's fine, Task 5 fixes it)**

Run: `npx tsc --noEmit`
Expected: errors in `src/renderer/src/stores/dashboardData.ts` about `d.count` missing — that's expected, we'll fix in Task 5. **Do not commit yet.**

- [ ] **Step 7: Temporarily pin renderer to the new shape**

In `src/renderer/src/stores/dashboardData.ts`, inside the `fetchAll` body where `chartData` is computed, change:

```typescript
chartData = data.map((d) => ({
  value: d.count,
  accent: 'cyan' as const,
  label: d.hour
}))
```

to:

```typescript
chartData = data.map((d) => ({
  value: d.successCount + d.failedCount,
  accent: 'cyan' as const,
  label: d.hour
}))
```

This is a temporary bridge so the build stays green after Task 3. Task 5 will replace it properly.

- [ ] **Step 8: Typecheck + tests + lint all green**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/handlers/dashboard-handlers.ts src/main/handlers/__tests__/dashboard-handlers.test.ts src/renderer/src/stores/dashboardData.ts
git commit -m "feat(dashboard): split throughput SQL into success/failed counts per hour"
```

---

### Task 4: System load IPC channel + handler + preload + main-process init

**Files:**

- Modify: `src/shared/ipc-channels.ts` — add `SystemChannels` interface
- Modify: `src/main/handlers/dashboard-handlers.ts` — add `system:loadAverage` handler inside `registerDashboardHandlers`
- Modify: `src/preload/index.ts` — add `system.loadAverage()` method
- Modify: `src/main/index.ts` — call `startLoadSampler()` after `app.whenReady`

- [ ] **Step 1: Add the `LoadSample` type and channel definition in `ipc-channels.ts`**

Near the other dashboard types (around line 683), add:

```typescript
export interface LoadSample {
  t: number
  load1: number
  load5: number
  load15: number
}

export interface LoadSnapshot {
  samples: LoadSample[]
  cpuCount: number
}

export interface SystemChannels {
  'system:loadAverage': { args: []; result: LoadSnapshot }
}
```

Then find the type that unions all channel interfaces (search for `DashboardChannels &` or `IpcChannelMap`). Add `SystemChannels` to the union. If the file uses a pattern like:

```typescript
export type IpcChannelMap = SomeChannels & OtherChannels & DashboardChannels & ...
```

add `& SystemChannels` to the end.

- [ ] **Step 2: Register the handler**

In `src/main/handlers/dashboard-handlers.ts`, add at the top:

```typescript
import { getLoadSnapshot } from '../services/load-sampler'
```

Inside `registerDashboardHandlers()`, after the existing handlers, add:

```typescript
safeHandle('system:loadAverage', async () => {
  return getLoadSnapshot()
})
```

- [ ] **Step 3: Expose preload bridge**

In `src/preload/index.ts`, next to the existing `dashboard: { … }` block (around line 325), add a new section:

```typescript
// System metrics
system: {
  loadAverage: () => typedInvoke('system:loadAverage')
},
```

Ensure it's added to the exported API object and typed correctly. If there's an `IApi` interface definition, update it too.

- [ ] **Step 4: Start the sampler at app ready**

In `src/main/index.ts`, find `app.whenReady().then(() => { … })` (around line 114). Inside that `.then` callback, after the existing setup but before or alongside the `register*Handlers()` calls (around line 289), add:

```typescript
import { startLoadSampler, stopLoadSampler } from './services/load-sampler'
```

at the top of the file, and inside `.whenReady`:

```typescript
startLoadSampler()
```

Also add cleanup on shutdown. Find the existing `app.on('window-all-closed', …)` or `app.on('before-quit', …)` handler and add:

```typescript
stopLoadSampler()
```

If no suitable shutdown hook exists, add:

```typescript
app.on('before-quit', () => {
  stopLoadSampler()
})
```

- [ ] **Step 5: Typecheck + test + lint**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass. The IPC type must match between main handler and preload.

- [ ] **Step 6: Smoke test the IPC end-to-end**

Run: `npm run dev`
Open the app, open DevTools console in the renderer, type:

```javascript
await window.api.system.loadAverage()
```

Expected: returns `{ samples: [...], cpuCount: <number> }` with at least one sample. Close dev server.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc-channels.ts src/main/handlers/dashboard-handlers.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(dashboard): wire system:loadAverage IPC channel and start sampler on app ready"
```

---

### Task 5: `useDashboardDataStore` updates

**Files:**

- Modify: `src/renderer/src/stores/dashboardData.ts`
- Modify: `src/renderer/src/stores/__tests__/dashboardData.test.ts`

Replaces the temporary `chartData` bridge from Task 3 with the proper `throughputData` type, adds `loadData` + `fetchLoad`, removes `burndownData`.

- [ ] **Step 1: Write failing tests for the new store shape**

Update `src/renderer/src/stores/__tests__/dashboardData.test.ts`. Add tests:

```typescript
it('fetchAll populates throughputData with hour/success/failed', async () => {
  mockCompletionsPerHour.mockResolvedValue([
    { hour: '2026-04-07T14:00:00', successCount: 3, failedCount: 1 }
  ])
  await useDashboardDataStore.getState().fetchAll()
  const s = useDashboardDataStore.getState()
  expect(s.throughputData).toEqual([
    { hour: '2026-04-07T14:00:00', successCount: 3, failedCount: 1 }
  ])
})

it('fetchAll no longer exposes burndownData', () => {
  const s = useDashboardDataStore.getState()
  expect((s as Record<string, unknown>).burndownData).toBeUndefined()
})

it('fetchLoad populates loadData from system.loadAverage', async () => {
  mockLoadAverage.mockResolvedValue({
    samples: [{ t: 1, load1: 2, load5: 3, load15: 4 }],
    cpuCount: 8
  })
  await useDashboardDataStore.getState().fetchLoad()
  expect(useDashboardDataStore.getState().loadData).toEqual({
    samples: [{ t: 1, load1: 2, load5: 3, load15: 4 }],
    cpuCount: 8
  })
})

it('fetchLoad sets cardErrors.loadAverage on failure', async () => {
  mockLoadAverage.mockRejectedValue(new Error('boom'))
  await useDashboardDataStore.getState().fetchLoad()
  expect(useDashboardDataStore.getState().cardErrors.loadAverage).toBeDefined()
})

it('fetchLoad clears cardErrors.loadAverage on success after failure', async () => {
  mockLoadAverage.mockRejectedValueOnce(new Error('boom'))
  await useDashboardDataStore.getState().fetchLoad()
  expect(useDashboardDataStore.getState().cardErrors.loadAverage).toBeDefined()
  mockLoadAverage.mockResolvedValueOnce({ samples: [], cpuCount: 8 })
  await useDashboardDataStore.getState().fetchLoad()
  expect(useDashboardDataStore.getState().cardErrors.loadAverage).toBeUndefined()
})
```

Add the IPC mock at the top of the test file alongside existing mocks:

```typescript
const mockLoadAverage = vi.fn()
// ... in the window.api mock:
system: {
  loadAverage: mockLoadAverage
}
```

Remove any `burndown`-related test assertions.

- [ ] **Step 2: Run tests — expect failure**

Run: `npx vitest run src/renderer/src/stores/__tests__/dashboardData.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the store**

In `src/renderer/src/stores/dashboardData.ts`:

1. Import `LoadSnapshot`, `CompletionBucket` types from `../../../shared/ipc-channels`.
2. Replace the `chartData: ChartBar[]` field with `throughputData: CompletionBucket[]`, initial `[]`.
3. Delete the `burndownData` field entirely, along with its type.
4. Add `loadData: LoadSnapshot | null`, initial `null`.
5. Add a new action `fetchLoad: () => Promise<void>`.
6. Inside `fetchAll`, replace the `chartData` block with:
   ```typescript
   let throughputData: CompletionBucket[] = []
   try {
     const data = await window.api.dashboard?.completionsPerHour()
     if (data) throughputData = data
   } catch {
     errors.throughput = 'Failed to load completions'
   }
   ```
7. Delete the entire `burndownData` fetch block and its error key.
8. Implement `fetchLoad`:
   ```typescript
   fetchLoad: async () => {
     try {
       const data = await window.api.system?.loadAverage()
       if (data) {
         set((state) => {
           const nextErrors = { ...state.cardErrors }
           delete nextErrors.loadAverage
           return { loadData: data, cardErrors: nextErrors }
         })
       }
     } catch (e) {
       set((state) => ({
         cardErrors: { ...state.cardErrors, loadAverage: 'Failed to load system metrics' }
       }))
     }
   }
   ```
9. Update the final `set(...)` in `fetchAll` to use `throughputData` instead of `chartData`, remove `burndownData`, and when no errors occurred, also drop the `throughput`/`successTrend` keys from `cardErrors` (preserve any other stale keys like `loadAverage`):
   ```typescript
   set((state) => ({
     throughputData,
     feedEvents,
     prCount,
     successTrendData,
     cardErrors: mergeCardErrors(state.cardErrors, errors, [
       'throughput',
       'successTrend',
       'feed',
       'prs'
     ]),
     loading: false,
     lastFetchedAt: Date.now()
   }))
   ```
   Implement a tiny helper near the top:
   ```typescript
   function mergeCardErrors(
     prev: Record<string, string | undefined>,
     incoming: Record<string, string>,
     keysThisFetchOwns: string[]
   ): Record<string, string | undefined> {
     const next = { ...prev }
     for (const k of keysThisFetchOwns) delete next[k]
     Object.assign(next, incoming)
     return next
   }
   ```
   Rationale: `fetchAll` shouldn't clobber `loadAverage` errors set by `fetchLoad`, and vice versa.

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run src/renderer/src/stores/__tests__/dashboardData.test.ts`
Expected: all new tests PASS.

- [ ] **Step 5: Full typecheck — expect build errors in consumers**

Run: `npm run typecheck`
Expected: errors in `DashboardView.tsx`, `CenterColumn.tsx`, `ChartsSection.tsx`, `useDashboardMetrics.ts` due to renamed/removed fields. **These are expected.** Tasks 6 and 12 will fix them. To keep the repo shippable between tasks, apply minimal bridging only in files we'll delete:

In `CenterColumn.tsx` and `ChartsSection.tsx`, wherever `chartData` or `burndownData` is read, replace with `throughputData` directly (these files will be deleted in Task 13 anyway). In `useDashboardMetrics.ts`, leave it for now — Task 6 rewrites it.

Actually simpler: **make this task self-contained by using `@ts-expect-error` comments in the two doomed files** with a note pointing to Task 13. The cleaner alternative is to fix the consumers here:

- In `DashboardView.tsx`: rename destructured `chartData` → `throughputData` and drop `burndownData`.
- In `CenterColumn.tsx`: update props type, rename `chartData` → `throughputData` (type `CompletionBucket[]`), drop `burndownData`.
- In `ChartsSection.tsx`: rename `chartData` → `throughputData` (same type), drop `burndownData`. The existing component will temporarily pass the data into `MiniChart` incorrectly — wrap with:

  ```typescript
  <MiniChart
    data={throughputData.map(d => ({
      value: d.successCount + d.failedCount,
      accent: 'cyan' as const,
      label: d.hour
    }))}
    height={120}
  />
  ```

  **Add a `// TODO(dashboard-redesign): replaced in Task 12` comment.** Do the same for anywhere `burndownData` was used — replace with an empty `<div>` placeholder carrying the same TODO comment.

- [ ] **Step 6: Full typecheck + tests + lint all green**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/stores/dashboardData.ts src/renderer/src/stores/__tests__/dashboardData.test.ts src/renderer/src/views/DashboardView.tsx src/renderer/src/components/dashboard/CenterColumn.tsx src/renderer/src/components/dashboard/ChartsSection.tsx
git commit -m "refactor(dashboard): store uses throughputData and loadData; remove burndown"
```

---

### Task 6: `useDashboardMetrics` extensions

**Files:**

- Modify: `src/renderer/src/hooks/useDashboardMetrics.ts`
- Create: `src/renderer/src/hooks/__tests__/useDashboardMetrics.test.ts` (if missing)

- [ ] **Step 1: Write failing tests**

Check whether `useDashboardMetrics.test.ts` exists. If yes, extend it. If not, create it with tests for:

```typescript
describe('useDashboardMetrics — stuck detection', () => {
  it('marks an active task as stuck when (now - started_at) > max_runtime_ms', () => {
    // render hook with one active task started 2h ago, no max_runtime_ms
    // assert stuckCount === 1
  })

  it('respects per-task max_runtime_ms when set', () => {
    // one active task started 30min ago with max_runtime_ms = 10min
    // assert stuckCount === 1
  })

  it('uses DEFAULT_STUCK_MS (1h) as fallback', () => {
    // one active task started 30min ago, no max_runtime_ms
    // assert stuckCount === 0
  })

  it('handles null started_at gracefully (not stuck)', () => {
    // one active task with started_at === null
    // assert stuckCount === 0
  })
})

describe('useDashboardMetrics — loadSaturated', () => {
  it('returns null when load1 < 2 × cpuCount', () => {
    // mock loadData with load1 = 10, cpuCount = 8 → null
  })

  it('returns populated object when load1 >= 2 × cpuCount', () => {
    // mock loadData with load1 = 20, cpuCount = 8 → { load1: 20, cpuCount: 8 }
  })

  it('returns null when loadData is null', () => {
    // expect null
  })
})

describe('useDashboardMetrics — successRate7dAvg + delta', () => {
  it('computes average of last 7 non-null days', () => {
    // 14 days of data, last 7 avg = 95.0
    // expect successRate7dAvg === 95.0
  })

  it('computes week-over-week delta', () => {
    // last 7 avg = 98, prior 7 avg = 94 → delta = +4
  })

  it('returns null when fewer than 1 non-null day in either window', () => {
    // expect both null
  })
})
```

Use `@testing-library/react`'s `renderHook` pattern — match the style used in other `__tests__` files in `src/renderer/src/hooks/` (check `useDashboardPolling.test.ts` for a template).

- [ ] **Step 2: Run tests — expect failure**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useDashboardMetrics.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend the hook**

In `src/renderer/src/hooks/useDashboardMetrics.ts`:

1. Near the top, add:

   ```typescript
   export const DEFAULT_STUCK_MS = 60 * 60 * 1000 // 1h — matches agent-manager watchdog
   ```

2. Import `loadData` and `successTrendData` from `useDashboardDataStore`:

   ```typescript
   import { useDashboardDataStore } from '../stores/dashboardData'
   // inside the hook:
   const { loadData, successTrendData } = useDashboardDataStore(
     useShallow((s) => ({ loadData: s.loadData, successTrendData: s.successTrendData }))
   )
   ```

   (Check if `useShallow` is already imported; if not, add the import from `zustand/react/shallow`.)

3. Add `stuckCount` memo:

   ```typescript
   const stuckCount = useMemo(() => {
     return tasks.filter((t) => {
       if (t.status !== 'active' || !t.started_at) return false
       const elapsed = now - new Date(t.started_at).getTime()
       const threshold = t.max_runtime_ms ?? DEFAULT_STUCK_MS
       return elapsed > threshold
     }).length
   }, [tasks, now])
   ```

   (Reuse the existing `now` state variable that polls every 60s.)

4. Add `loadSaturated` memo:

   ```typescript
   const loadSaturated = useMemo(() => {
     if (!loadData || loadData.samples.length === 0) return null
     const latest = loadData.samples[loadData.samples.length - 1]
     if (latest.load1 < 2 * loadData.cpuCount) return null
     return { load1: latest.load1, cpuCount: loadData.cpuCount }
   }, [loadData])
   ```

5. Add `successRate7dAvg` and `successRateWeekDelta` memos:

   ```typescript
   const { successRate7dAvg, successRateWeekDelta } = useMemo(() => {
     const avg = (arr: number[]): number | null => {
       const nums = arr.filter((n): n is number => n != null)
       if (nums.length === 0) return null
       return nums.reduce((s, n) => s + n, 0) / nums.length
     }
     const last7 = successTrendData.slice(-7).map((d) => d.successRate)
     const prior7 = successTrendData.slice(-14, -7).map((d) => d.successRate)
     const last7Avg = avg(last7 as number[])
     const prior7Avg = avg(prior7 as number[])
     return {
       successRate7dAvg: last7Avg,
       successRateWeekDelta: last7Avg != null && prior7Avg != null ? last7Avg - prior7Avg : null
     }
   }, [successTrendData])
   ```

6. Drop `avgDuration`, `avgTaskDuration`, `taskDurationCount`, `localAgents` imports — **unless the right-column `tokenTrendData` still needs `localAgents`**. Check existing usage; if still needed, leave the import but remove the unused exports. Update the `DashboardMetrics` type accordingly.

7. Add the new fields to the return type and return object.

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useDashboardMetrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck will break consumers**

Run: `npm run typecheck`
Expected: errors in `DashboardView.tsx` / `CenterColumn.tsx` / `ChartsSection.tsx` / tests for removed fields. Temporarily destructure only the fields we still expose; tests will need mock updates. Keep changes minimal — Task 12 rewrites the integration.

For the consumers, pass dummy values for removed fields or rewrite the destructure. Specifically in `DashboardView.tsx`, drop `avgDuration`, `avgTaskDuration`, `taskDurationCount` from the destructure and from the `CenterColumn` props. In `CenterColumn.tsx` and `ChartsSection.tsx`, drop those props and remove their usage (the "Avg Task Duration" card will be formally removed in Task 13).

- [ ] **Step 6: Typecheck + test + lint green**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/hooks/useDashboardMetrics.ts src/renderer/src/hooks/__tests__/useDashboardMetrics.test.ts src/renderer/src/views/DashboardView.tsx src/renderer/src/components/dashboard/CenterColumn.tsx src/renderer/src/components/dashboard/ChartsSection.tsx
git commit -m "feat(dashboard): extend metrics with stuckCount, loadSaturated, week-over-week delta"
```

---

### Task 7: `ThroughputChart` component

**Files:**

- Create: `src/renderer/src/components/dashboard/ThroughputChart.tsx`
- Create: `src/renderer/src/components/dashboard/__tests__/ThroughputChart.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThroughputChart } from '../ThroughputChart'
import type { CompletionBucket } from '../../../../../shared/ipc-channels'

describe('ThroughputChart', () => {
  const makeBucket = (hour: string, s: number, f: number): CompletionBucket => ({
    hour,
    successCount: s,
    failedCount: f
  })

  it('renders header numbers: last hour, avg/hr, peak', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [
      makeBucket(isoHour(now, -3), 2, 0),
      makeBucket(isoHour(now, -2), 5, 1),
      makeBucket(isoHour(now, -1), 3, 0),
      makeBucket(isoHour(now, 0), 4, 0)
    ]
    render(<ThroughputChart data={data} />)
    expect(screen.getByText('4')).toBeInTheDocument() // last hour
    expect(screen.getByText(/avg/)).toBeInTheDocument()
    expect(screen.getByText(/peak/)).toBeInTheDocument()
  })

  it('synthesizes a 24-slot scaffold — hours absent from data render as gaps', () => {
    const data: CompletionBucket[] = []
    render(<ThroughputChart data={data} />)
    expect(screen.getByText(/No completions in the last 24h/i)).toBeInTheDocument()
  })

  it('renders 24 bar slots when any data is present (some with bars, some empty)', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [makeBucket(isoHour(now, 0), 3, 1)]
    const { container } = render(<ThroughputChart data={data} />)
    // Scaffold: 24 hour slots rendered as <g data-role="hour-slot">
    expect(container.querySelectorAll('[data-role="hour-slot"]')).toHaveLength(24)
  })

  it('renders stacked success + failed bars', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [makeBucket(isoHour(now, 0), 5, 2)]
    const { container } = render(<ThroughputChart data={data} />)
    expect(container.querySelector('[data-role="bar-success"]')).toBeTruthy()
    expect(container.querySelector('[data-role="bar-failed"]')).toBeTruthy()
  })

  it('Y-axis max rounds to next nice number above peak', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [makeBucket(isoHour(now, 0), 7, 0)]
    const { container } = render(<ThroughputChart data={data} />)
    const yMax = container.querySelector('[data-testid="y-max"]')
    expect(yMax?.textContent).toBe('10') // nice number above 7
  })

  it('Y-axis floor is 5', () => {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    const data = [makeBucket(isoHour(now, 0), 1, 0)]
    const { container } = render(<ThroughputChart data={data} />)
    const yMax = container.querySelector('[data-testid="y-max"]')
    expect(yMax?.textContent).toBe('5')
  })
})

function isoHour(base: Date, offsetHours: number): string {
  const d = new Date(base.getTime() + offsetHours * 3600_000)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:00:00`
}
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/ThroughputChart.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `ThroughputChart`**

Create `src/renderer/src/components/dashboard/ThroughputChart.tsx`:

```typescript
import { useMemo, useState, useId } from 'react'
import type { CompletionBucket } from '../../../../shared/ipc-channels'
import { neonVar } from '../neon/types'

interface ThroughputChartProps {
  data: CompletionBucket[]
  height?: number
}

interface HourSlot {
  hour: string       // ISO local hour
  label: string      // "3pm"
  successCount: number
  failedCount: number
  present: boolean   // was there a data bucket for this hour
}

const NICE = [5, 10, 20, 50, 100, 200, 500, 1000]
const PAD = { top: 14, right: 10, bottom: 18, left: 32 }
const SVG_W = 520

function niceMax(peak: number): number {
  for (const n of NICE) if (peak <= n) return n
  return Math.ceil(peak / 100) * 100
}

function buildScaffold(data: CompletionBucket[]): HourSlot[] {
  const byHour = new Map<string, CompletionBucket>()
  for (const d of data) byHour.set(d.hour, d)

  const now = new Date()
  now.setMinutes(0, 0, 0)
  const slots: HourSlot[] = []
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000)
    const iso = formatLocalHourIso(d)
    const bucket = byHour.get(iso)
    const h = d.getHours()
    const label =
      h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`
    slots.push({
      hour: iso,
      label,
      successCount: bucket?.successCount ?? 0,
      failedCount: bucket?.failedCount ?? 0,
      present: !!bucket
    })
  }
  return slots
}

function formatLocalHourIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00:00`
}

export function ThroughputChart({ data, height = 140 }: ThroughputChartProps): React.JSX.Element {
  const uid = useId()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const slots = useMemo(() => buildScaffold(data), [data])
  const totals = useMemo(
    () => slots.map((s) => s.successCount + s.failedCount),
    [slots]
  )
  const peak = Math.max(...totals, 0)
  const yMax = Math.max(niceMax(peak), 5)
  const lastHour = totals[totals.length - 1] ?? 0
  const sum = totals.reduce((a, b) => a + b, 0)
  const avg = sum / 24
  const peakIdx = totals.indexOf(peak)
  const peakLabel = peakIdx >= 0 ? slots[peakIdx].label : ''

  const allZero = sum === 0

  const plotW = SVG_W - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const barW = plotW / 24 - 2
  const cx = (i: number) => PAD.left + (i * plotW) / 24 + 1
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH

  return (
    <div className="throughput-chart" style={{ position: 'relative' }}>
      <div className="throughput-chart__header">
        <div>
          <strong className="throughput-chart__value">{lastHour}</strong>
          <span className="throughput-chart__caption"> last hour</span>
        </div>
        <div className="throughput-chart__meta">
          {avg.toFixed(1)}/hr avg · peak {peak} @ {peakLabel}
        </div>
      </div>
      {allZero ? (
        <div className="throughput-chart__empty" style={{ height }}>
          No completions in the last 24h
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${SVG_W} ${height}`}
          width="100%"
          height={height}
          style={{ display: 'block' }}
        >
          {/* Y-axis ticks */}
          <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={height - PAD.bottom} stroke="#1e293b" />
          <line x1={PAD.left} y1={height - PAD.bottom} x2={SVG_W - PAD.right} y2={height - PAD.bottom} stroke="#1e293b" />
          {/* gridlines */}
          <line x1={PAD.left} y1={y(yMax)} x2={SVG_W - PAD.right} y2={y(yMax)} stroke="#1e293b" strokeDasharray="2 3" />
          <line x1={PAD.left} y1={y(yMax / 2)} x2={SVG_W - PAD.right} y2={y(yMax / 2)} stroke="#1e293b" strokeDasharray="2 3" />
          {/* Y labels */}
          <text x={PAD.left - 6} y={y(yMax) + 3} textAnchor="end" fontSize="9" fill="#64748b" data-testid="y-max">{yMax}</text>
          <text x={PAD.left - 6} y={y(yMax / 2) + 3} textAnchor="end" fontSize="9" fill="#64748b">{yMax / 2}</text>
          <text x={PAD.left - 6} y={height - PAD.bottom + 3} textAnchor="end" fontSize="9" fill="#64748b">0</text>
          {/* Bars */}
          {slots.map((s, i) => {
            const total = s.successCount + s.failedCount
            const successH = plotH * (s.successCount / yMax)
            const failedH = plotH * (s.failedCount / yMax)
            return (
              <g key={i} data-role="hour-slot"
                 onMouseEnter={() => setHoverIdx(i)}
                 onMouseLeave={() => setHoverIdx(null)}>
                {total > 0 && (
                  <>
                    <rect
                      data-role="bar-success"
                      x={cx(i)} y={y(s.successCount)} width={barW} height={successH}
                      fill={neonVar('cyan', 'color')}
                    />
                    {s.failedCount > 0 && (
                      <rect
                        data-role="bar-failed"
                        x={cx(i)} y={y(s.successCount + s.failedCount)}
                        width={barW} height={failedH}
                        fill={neonVar('red', 'color')}
                      />
                    )}
                  </>
                )}
                {/* invisible hit area */}
                <rect x={cx(i)} y={PAD.top} width={barW} height={plotH} fill="transparent" />
              </g>
            )
          })}
          {/* X-axis labels at 12am/6am/noon/6pm/now */}
          {[0, 6, 12, 18, 23].map((i) => (
            <text
              key={i}
              x={cx(i) + barW / 2}
              y={height - 4}
              textAnchor="middle"
              fontSize="9"
              fill="#64748b"
            >
              {i === 23 ? 'now' : slots[i]?.label}
            </text>
          ))}
        </svg>
      )}
      {hoverIdx !== null && slots[hoverIdx] && (
        <div className="throughput-chart__tooltip">
          {slots[hoverIdx].label}: {slots[hoverIdx].successCount} done, {slots[hoverIdx].failedCount} failed
        </div>
      )}
      <div className="throughput-chart__legend">
        <span style={{ color: neonVar('cyan', 'color') }}>▪ success</span>
        {' '}
        <span style={{ color: neonVar('red', 'color') }}>▪ failed</span>
      </div>
    </div>
  )
}
```

Add minimal styles in `src/renderer/src/assets/dashboard-neon.css` for `.throughput-chart`, `.throughput-chart__header`, `.throughput-chart__value`, `.throughput-chart__caption`, `.throughput-chart__meta`, `.throughput-chart__empty`, `.throughput-chart__tooltip`, `.throughput-chart__legend`. Match the existing dashboard typography — uppercase small labels, mono font, cyan accent color. Keep it terse (~30 lines of CSS).

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/ThroughputChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/dashboard/ThroughputChart.tsx src/renderer/src/components/dashboard/__tests__/ThroughputChart.test.tsx src/renderer/src/assets/dashboard-neon.css
git commit -m "feat(dashboard): add ThroughputChart with real hour axis and stacked bars"
```

---

### Task 8: `SuccessRateChart` component

**Files:**

- Create: `src/renderer/src/components/dashboard/SuccessRateChart.tsx`
- Create: `src/renderer/src/components/dashboard/__tests__/SuccessRateChart.test.tsx`

- [ ] **Step 1: Write failing tests**

Critical test: **100% always maps to the same Y pixel regardless of dataset.**

```typescript
it('100% maps to a fixed Y pixel regardless of dataset max', () => {
  const dataA = [
    { date: '2026-04-01', successRate: 100, doneCount: 10, failedCount: 0 },
    { date: '2026-04-02', successRate: 100, doneCount: 10, failedCount: 0 }
  ]
  const dataB = [
    { date: '2026-04-01', successRate: 100, doneCount: 10, failedCount: 0 },
    { date: '2026-04-02', successRate: 50, doneCount: 5, failedCount: 5 }
  ]
  const { container: a } = render(<SuccessRateChart data={dataA} />)
  const { container: b } = render(<SuccessRateChart data={dataB} />)
  const yA = a.querySelector('[data-testid="point-0"]')?.getAttribute('cy')
  const yB = b.querySelector('[data-testid="point-0"]')?.getAttribute('cy')
  expect(yA).toBe(yB)
})

it('renders a gap for null days (no phantom zeros)', () => {
  const data = [
    { date: '2026-04-01', successRate: 100, doneCount: 1, failedCount: 0 },
    { date: '2026-04-02', successRate: null, doneCount: 0, failedCount: 0 },
    { date: '2026-04-03', successRate: 100, doneCount: 1, failedCount: 0 }
  ]
  const { container } = render(<SuccessRateChart data={data} />)
  // path should contain a move-to between the two segments, not a continuous line through null
  const path = container.querySelector('path[data-role="trend-line"]')?.getAttribute('d')
  expect(path).toMatch(/M .+ L .+ M .+ L .+/) // two separate segments
})

it('shows 7d average + week-over-week delta header', () => {
  const data = /* 14 days, last 7 avg 98, prior 7 avg 94 */
  render(<SuccessRateChart data={data} />)
  expect(screen.getByText(/98\.0%/)).toBeInTheDocument()
  expect(screen.getByText(/\+4\.0%/)).toBeInTheDocument()
})

it('empty state when all days null', () => {
  const data = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    successRate: null,
    doneCount: 0,
    failedCount: 0
  }))
  render(<SuccessRateChart data={data} />)
  expect(screen.getByText(/No completed tasks in the last 14 days/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/SuccessRateChart.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/renderer/src/components/dashboard/SuccessRateChart.tsx`. Key requirements:

- Y-axis **fixed** `[0, 100]`. Do not read `Math.max(data)` anywhere.
- Tick labels at `0%`, `75%`, `90%`, `100%` on the left. `data-testid="y-tick-100"`, etc.
- Gridlines at 75 and 100.
- Path built segment-by-segment: when a `null` day is encountered, emit a separate `M x,y` to start a new segment. Add `data-role="trend-line"` to the path.
- Point dots with `data-testid={`point-${idx}`}` for deterministic assertions.
- Header: `{avg7d.toFixed(1)}%` big (green), caption `7d avg`, right-aligned delta formatted like `▲ +{delta.toFixed(1)}% vs prior wk` (green if positive, red if negative, dim `— steady` if `|delta| < 0.5`).
- Empty state div when every day's `successRate === null`.
- X-axis labels: first day, midpoint, last day formatted `Mon D`.

Implementation should mirror the shape of `ThroughputChart.tsx` for SVG padding and `useMemo` for derivations. Use `neonVar('green', 'color')` for the line (verify the neon theme has a green variant; fall back to `#4ade80` inline if needed).

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/SuccessRateChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/dashboard/SuccessRateChart.tsx src/renderer/src/components/dashboard/__tests__/SuccessRateChart.test.tsx src/renderer/src/assets/dashboard-neon.css
git commit -m "feat(dashboard): add SuccessRateChart with fixed 0-100% axis and gap-on-null"
```

---

### Task 9: `LoadAverageChart` component

**Files:**

- Create: `src/renderer/src/components/dashboard/LoadAverageChart.tsx`
- Create: `src/renderer/src/components/dashboard/__tests__/LoadAverageChart.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
describe('LoadAverageChart', () => {
  const makeSamples = (n: number, vals: [number, number, number][]): LoadSample[] =>
    vals.slice(0, n).map(([a, b, c], i) => ({
      t: 1000 + i * 5000, load1: a, load5: b, load15: c
    }))

  it('shows empty state with < 2 samples', () => {
    render(<LoadAverageChart samples={makeSamples(1, [[1, 1, 1]])} cpuCount={8} />)
    expect(screen.getByText(/Collecting samples/i)).toBeInTheDocument()
  })

  it('big number is green when load1 < cpuCount', () => {
    const { container } = render(<LoadAverageChart samples={makeSamples(2, [[1, 1, 1], [3, 2, 1]])} cpuCount={8} />)
    expect(container.querySelector('[data-testid="load-value"]')).toHaveClass(/green|healthy/)
  })

  it('big number is amber when cpuCount <= load1 < 2×cpuCount', () => {
    const { container } = render(<LoadAverageChart samples={makeSamples(2, [[1, 1, 1], [10, 2, 1]])} cpuCount={8} />)
    expect(container.querySelector('[data-testid="load-value"]')).toHaveClass(/amber|warn/)
  })

  it('big number is red when load1 >= 2×cpuCount', () => {
    const { container } = render(<LoadAverageChart samples={makeSamples(2, [[1, 1, 1], [20, 2, 1]])} cpuCount={8} />)
    expect(container.querySelector('[data-testid="load-value"]')).toHaveClass(/red|critical/)
  })

  it('trend shows cooling when load1 < load5', () => {
    render(<LoadAverageChart samples={makeSamples(2, [[1, 1, 1], [5, 10, 15]])} cpuCount={8} />)
    expect(screen.getByText(/cooling/i)).toBeInTheDocument()
  })

  it('trend shows climbing when load1 > load5 × 1.05', () => {
    render(<LoadAverageChart samples={makeSamples(2, [[1, 1, 1], [15, 10, 5]])} cpuCount={8} />)
    expect(screen.getByText(/climbing/i)).toBeInTheDocument()
  })

  it('trend shows steady otherwise', () => {
    render(<LoadAverageChart samples={makeSamples(2, [[1, 1, 1], [10.2, 10, 10]])} cpuCount={8} />)
    expect(screen.getByText(/steady/i)).toBeInTheDocument()
  })

  it('renders three line paths + saturation reference line', () => {
    const { container } = render(<LoadAverageChart samples={makeSamples(3, [[1, 2, 3], [4, 5, 6], [7, 8, 9]])} cpuCount={8} />)
    expect(container.querySelector('[data-role="line-1min"]')).toBeTruthy()
    expect(container.querySelector('[data-role="line-5min"]')).toBeTruthy()
    expect(container.querySelector('[data-role="line-15min"]')).toBeTruthy()
    expect(container.querySelector('[data-role="saturation-line"]')).toBeTruthy()
  })

  it('Y-axis floor respects max(cpuCount × 1.5, 4)', () => {
    // small samples with cpuCount=8 → floor = 12, ceiling must be ≥ 12
    const { container } = render(<LoadAverageChart samples={makeSamples(2, [[1, 1, 1], [2, 2, 2]])} cpuCount={8} />)
    const yMax = container.querySelector('[data-testid="y-max-value"]')
    expect(Number(yMax?.textContent)).toBeGreaterThanOrEqual(12)
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/LoadAverageChart.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/renderer/src/components/dashboard/LoadAverageChart.tsx`:

- Props: `{ samples: LoadSample[]; cpuCount: number; height?: number }`. Default height 140.
- Header:
  - Big number: `samples.at(-1).load1.toFixed(2)`. Class `load-value--green`/`amber`/`red` based on the bucket.
  - Right-aligned trend indicator: `▼ cooling` / `— steady` / `▲ climbing` per the rules in the spec.
  - Caption below trend: `{load5.toFixed(2)} · {load15.toFixed(2)} (5m · 15m)`.
- Y-axis range:
  - `floor = Math.max(cpuCount * 1.5, 4)`
  - `peak = Math.max(...samples.flatMap(s => [s.load1, s.load5, s.load15]))`
  - `yMax = Math.max(floor, niceMax(peak))` where `niceMax` follows a similar pattern to Throughput but for load values (use the set `[4, 8, 16, 32, 64, 128, 256, 512]` or scale by `cpuCount`).
- X-axis: tick labels at `-10m`, `-5m`, `now` based on the oldest sample's timestamp.
- 3 line paths. Build each as `M x0,y0 L x1,y1 L …`. Don't use smoothing — this is a live signal, smoothing lies.
- `<line>` element for the `cpuCount` saturation reference, `data-role="saturation-line"`, dashed amber stroke (`#fbbf24`).
- Empty state: when `samples.length < 2`, render `<div className="load-chart__empty">Collecting samples...</div>` at the given height.
- Legend row under the chart.
- Add `data-testid="load-value"` and `data-testid="y-max-value"` as needed.

Use CSS classes like `load-chart__value load-chart__value--green` so the `toHaveClass(/green/)` assertions work.

Add matching CSS in `dashboard-neon.css` (match Throughput styling; three color variants for the value).

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/LoadAverageChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/dashboard/LoadAverageChart.tsx src/renderer/src/components/dashboard/__tests__/LoadAverageChart.test.tsx src/renderer/src/assets/dashboard-neon.css
git commit -m "feat(dashboard): add LoadAverageChart for CPU load visualization"
```

---

### Task 10: `FiresStrip` component

**Files:**

- Create: `src/renderer/src/components/dashboard/FiresStrip.tsx`
- Create: `src/renderer/src/components/dashboard/__tests__/FiresStrip.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
describe('FiresStrip', () => {
  const noop = () => {}

  it('renders nothing when all counts zero and no load saturation', () => {
    const { container } = render(
      <FiresStrip failed={0} blocked={0} stuck={0} loadSaturated={null} onClick={noop} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders failed segment when failed > 0', () => {
    render(<FiresStrip failed={2} blocked={0} stuck={0} loadSaturated={null} onClick={noop} />)
    expect(screen.getByRole('button', { name: /2 failed/i })).toBeInTheDocument()
  })

  it('renders all four segments when all active', () => {
    render(
      <FiresStrip
        failed={2}
        blocked={3}
        stuck={1}
        loadSaturated={{ load1: 137, cpuCount: 12 }}
        onClick={noop}
      />
    )
    expect(screen.getByRole('button', { name: /2 failed/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /3 blocked/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 stuck/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /load 137/i })).toBeInTheDocument()
  })

  it('routes each segment via onClick', () => {
    const onClick = vi.fn()
    render(
      <FiresStrip
        failed={1}
        blocked={1}
        stuck={1}
        loadSaturated={{ load1: 30, cpuCount: 12 }}
        onClick={onClick}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /failed/i }))
    expect(onClick).toHaveBeenLastCalledWith('failed')
    fireEvent.click(screen.getByRole('button', { name: /blocked/i }))
    expect(onClick).toHaveBeenLastCalledWith('blocked')
    fireEvent.click(screen.getByRole('button', { name: /stuck/i }))
    expect(onClick).toHaveBeenLastCalledWith('stuck')
    fireEvent.click(screen.getByRole('button', { name: /load/i }))
    expect(onClick).toHaveBeenLastCalledWith('load')
  })

  it('load segment displays "load N / M cores"', () => {
    render(
      <FiresStrip
        failed={0}
        blocked={0}
        stuck={0}
        loadSaturated={{ load1: 137.4, cpuCount: 12 }}
        onClick={noop}
      />
    )
    expect(screen.getByRole('button', { name: /load 137 \/ 12 cores/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/FiresStrip.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/renderer/src/components/dashboard/FiresStrip.tsx`. Render a horizontal `NeonCard accent="red"` (matching existing attention card pattern). Inside, render one `<button>` per active segment. Separator `·` between segments. Pluralize correctly. Return `null` early if no active segments.

- [ ] **Step 4: Run — expect pass**

Run: `npx vitest run src/renderer/src/components/dashboard/__tests__/FiresStrip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/dashboard/FiresStrip.tsx src/renderer/src/components/dashboard/__tests__/FiresStrip.test.tsx
git commit -m "feat(dashboard): add FiresStrip consolidating failed/blocked/stuck/load alerts"
```

---

### Task 11: `StatusRail` component

**Files:**

- Create: `src/renderer/src/components/dashboard/StatusRail.tsx`
- Create: `src/renderer/src/components/dashboard/__tests__/StatusRail.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
describe('StatusRail', () => {
  const baseStats = { active: 6, queued: 0, blocked: 3, review: 0, done: 115, doneToday: 4, failed: 2, actualFailed: 2 }
  const noop = () => {}

  it('renders Active, Queued, Done, Tokens tiles + New Task button', () => {
    render(<StatusRail stats={baseStats} tokens24h={628_000} onFilterClick={noop} onNewTaskClick={noop} />)
    expect(screen.getByText('Active').closest('[data-role="rail-tile"]')).toBeInTheDocument()
    expect(screen.getByText('Queued').closest('[data-role="rail-tile"]')).toBeInTheDocument()
    expect(screen.getByText(/Done/).closest('[data-role="rail-tile"]')).toBeInTheDocument()
    expect(screen.getByText(/Tokens/i).closest('[data-role="rail-tile"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument()
  })

  it('Done tile shows "X today" subtext', () => {
    render(<StatusRail stats={baseStats} tokens24h={0} onFilterClick={noop} onNewTaskClick={noop} />)
    expect(screen.getByText(/4 today/)).toBeInTheDocument()
  })

  it('tokens24h renders in compact form (628K)', () => {
    render(<StatusRail stats={baseStats} tokens24h={628_000} onFilterClick={noop} onNewTaskClick={noop} />)
    expect(screen.getByText('628.0K')).toBeInTheDocument()
  })

  it('click-to-filter calls onFilterClick with correct status', () => {
    const onFilterClick = vi.fn()
    render(<StatusRail stats={baseStats} tokens24h={0} onFilterClick={onFilterClick} onNewTaskClick={noop} />)
    fireEvent.click(screen.getByText('Active').closest('[data-role="rail-tile"]')!)
    expect(onFilterClick).toHaveBeenCalledWith('active')
  })

  it('does NOT render Blocked, Failed, Review, or PRs tiles', () => {
    render(<StatusRail stats={baseStats} tokens24h={0} onFilterClick={noop} onNewTaskClick={noop} />)
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
    expect(screen.queryByText('PRs')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Implement**

Create `src/renderer/src/components/dashboard/StatusRail.tsx`. Structure: a vertical flex column of 4 compact tiles (Active, Queued, Done, Tokens 24h) + a "New Task" button at the bottom. Each tile is a `<button>` wrapper with `data-role="rail-tile"` and a meaningful `aria-label`. Use a `formatTokensCompact` helper — copy from `useDashboardMetrics.ts` or extract into a shared util if you prefer (don't cross that boundary unless the function grows).

Signature:

```typescript
interface StatusRailProps {
  stats: DashboardStats
  tokens24h: number
  onFilterClick: (filter: StatusFilter) => void
  onNewTaskClick: () => void
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Typecheck + lint**

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/dashboard/StatusRail.tsx src/renderer/src/components/dashboard/__tests__/StatusRail.test.tsx
git commit -m "feat(dashboard): add StatusRail replacing 8-card StatusCounters"
```

---

### Task 12: Integration — rewire `DashboardView` + `CenterColumn` + `ActivitySection` + 5s load polling

**Files:**

- Modify: `src/renderer/src/views/DashboardView.tsx`
- Modify: `src/renderer/src/components/dashboard/CenterColumn.tsx`
- Modify: `src/renderer/src/components/dashboard/ActivitySection.tsx` — **remove the two `<FailureBreakdown />` and `<SpecTypeSuccessRate />` renders along with their imports**. The "Recent Completions" card, "Tokens / Run" card, and "Tokens 24h" card stay. These two children are subsumed by the FiresStrip and removed from the dashboard per spec. (Task 1 preflight confirmed these are the only consumers of those components.)
- Modify: `src/renderer/src/components/dashboard/index.ts` (exports)

- [ ] **Step 1: Update `components/dashboard/index.ts` to export the new components**

Add:

```typescript
export { ThroughputChart } from './ThroughputChart'
export { SuccessRateChart } from './SuccessRateChart'
export { LoadAverageChart } from './LoadAverageChart'
export { FiresStrip } from './FiresStrip'
export { StatusRail } from './StatusRail'
```

(Leave old exports in place for now — Task 13 removes them.)

- [ ] **Step 2: Rewrite `CenterColumn.tsx`**

The new center column structure is:

```jsx
<div className="dashboard-col dashboard-col--center">
  <NeonCard accent="cyan" title="Pipeline" icon={<Activity size={12} />}>
    <SankeyPipeline stages={...} onStageClick={onFilterClick} />
  </NeonCard>

  <NeonCard accent="cyan" title="Throughput · last 24h" icon={<Zap size={12} />}>
    {cardErrors.throughput ? <ErrorCard/> : <ThroughputChart data={throughputData} />}
  </NeonCard>

  <NeonCard accent="cyan" title="Success rate · last 14d" icon={<TrendingUp size={12} />}>
    {cardErrors.successRate ? <ErrorCard/> : <SuccessRateChart data={successTrendData} />}
  </NeonCard>

  <NeonCard accent="cyan" title="System load · last 10m" icon={<Cpu size={12} />}>
    {cardErrors.loadAverage ? <ErrorCard/> :
      loadData ? <LoadAverageChart samples={loadData.samples} cpuCount={loadData.cpuCount} /> :
      <div>Loading...</div>}
  </NeonCard>

  <NeonCard accent="cyan" title="Tokens / run" icon={<Coins size={12} />}>
    {/* small inline sparkline using existing MiniChart + tokenTrendData */}
    <div className="tokens-per-run-row">
      <div className="tokens-per-run-row__number">
        <strong>{tokenAvg ?? '—'}</strong>
        <span>last 20 runs</span>
      </div>
      <MiniChart data={tokenTrendData} height={28} />
    </div>
  </NeonCard>
</div>
```

Drop the old Attention card (moved to Fires strip, rendered at the grid level in DashboardView).
Drop the `ChartsSection` import entirely.

New prop shape for `CenterColumn`:

```typescript
interface CenterColumnProps {
  stats: DashboardStats
  partitions: SprintPartitions
  throughputData: CompletionBucket[]
  successTrendData: DailySuccessRate[]
  loadData: LoadSnapshot | null
  tokenTrendData: ChartBar[]
  tokenAvg: string | null
  cardErrors: Record<string, string | undefined>
  onFilterClick: (filter: StatusFilter) => void
}
```

- [ ] **Step 3: Rewrite `DashboardView.tsx` integration**

Changes inside `DashboardView.tsx`:

1. Destructure the new fields from `useDashboardDataStore`:

   ```typescript
   const {
     throughputData,
     loadData,
     successTrendData,
     feedEvents,
     cardErrors,
     loading,
     lastFetchedAt
   } = useDashboardDataStore(
     useShallow((s) => ({
       throughputData: s.throughputData,
       loadData: s.loadData,
       successTrendData: s.successTrendData,
       feedEvents: s.feedEvents,
       cardErrors: s.cardErrors,
       loading: s.loading,
       lastFetchedAt: s.lastFetchedAt
     }))
   )
   ```

2. Get `fetchLoad` and set up 5s polling with `useBackoffInterval` (BDE convention — reviewer note):

   ```typescript
   import { useBackoffInterval } from '../hooks/useBackoffInterval'
   import { POLL_LOAD_AVERAGE } from '../lib/constants' // new constant
   // ...
   const fetchLoad = useDashboardDataStore((s) => s.fetchLoad)
   useEffect(() => {
     fetchLoad()
   }, [fetchLoad])
   useBackoffInterval(fetchLoad, POLL_LOAD_AVERAGE)
   ```

3. Add the new constant in `src/renderer/src/lib/constants.ts`:

   ```typescript
   export const POLL_LOAD_AVERAGE = 5_000 // 5s
   ```

4. Use `useDashboardMetrics` destructured with the new fields (`stuckCount`, `loadSaturated`, `successRate7dAvg`, `successRateWeekDelta`).

5. Insert `<FiresStrip>` at the top of the dashboard grid (inside the `tasks.length > 0` branch, above the 3-column grid):

   ```typescript
   <FiresStrip
     failed={stats.failed}
     blocked={stats.blocked}
     stuck={stuckCount}
     loadSaturated={loadSaturated}
     onClick={(kind) => {
       if (kind === 'failed') navigateToSprintWithFilter('failed')
       else if (kind === 'blocked') navigateToSprintWithFilter('blocked')
       else if (kind === 'stuck') navigateToSprintWithFilter('active')
       else if (kind === 'load') {
         // scroll load chart into view and pulse it briefly
         document.querySelector('[data-chart="load-average"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
       }
     }}
   />
   ```

6. Replace `<StatusCounters>` with `<StatusRail>`:

   ```typescript
   <StatusRail
     stats={stats}
     tokens24h={tokens24h}
     onFilterClick={navigateToSprintWithFilter}
     onNewTaskClick={() => setView('task-workbench')}
   />
   ```

7. Update the `<CenterColumn>` call to the new prop shape — drop `avgDuration`, `avgTaskDuration`, `taskDurationCount`, `localAgents`, `chartData`, `burndownData`, and add `throughputData`, `loadData`, `tokenTrendData`, `tokenAvg`.

8. Add `data-chart="load-average"` attribute to the `<NeonCard>` in `CenterColumn.tsx` that wraps the `LoadAverageChart` so the Fires-strip click target works.

- [ ] **Step 4: Update `DashboardView.test.tsx` as needed**

The existing dashboard view test uses a lot of mock setup. Update mocks for:

- `useDashboardDataStore` — new fields (`throughputData`, `loadData`, drop `chartData`/`burndownData`)
- `useDashboardMetrics` — new return fields
- Replace `StatusCounters` / `ChartsSection` mocks with `StatusRail` / new chart component mocks

Keep the test focused on _integration shape_ (renders, fires strip visibility, rail tiles present), not each chart's internals.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/renderer/src/views/__tests__/DashboardView.test.tsx src/renderer/src/components/dashboard/__tests__/CenterColumn.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full typecheck + tests + lint**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass. (Old component tests for `ChartsSection`, `SuccessRing`, `SuccessTrendChart`, `SpecTypeSuccessRate`, `FailureBreakdown`, `StatusCounters` may still exist — they'll be deleted in Task 13. If any are failing now because their component's props changed, delete the test file along with the component in Task 13, or skip the test with `describe.skip` and a TODO pointing to Task 13.)

- [ ] **Step 7: Manual smoke test with `npm run dev`**

Run: `npm run dev`
Verify:

- Dashboard renders without runtime errors.
- Throughput chart shows real bars with hour labels.
- Success rate chart has 0-100% scale.
- Load chart populates within ~5 seconds.
- Fires strip collapses when nothing is wrong.
- Status rail shows 4 tiles + New Task.
- Clicking rail tiles filters Sprint Pipeline correctly.

Close the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/views/DashboardView.tsx src/renderer/src/components/dashboard/CenterColumn.tsx src/renderer/src/components/dashboard/index.ts src/renderer/src/lib/constants.ts src/renderer/src/views/__tests__/DashboardView.test.tsx src/renderer/src/components/dashboard/__tests__/CenterColumn.test.tsx
git commit -m "feat(dashboard): integrate new charts, Fires strip, and StatusRail into DashboardView"
```

---

### Task 13: Delete obsolete code

**Scope note:** The backend data pipelines for `getSuccessRateBySpecType` (sprint-queries → sprint-service → sprint-task-repository → sprint-local IPC handler → preload bridge) and `getFailureBreakdown` (sprint-local IPC handler → preload bridge) are **intentionally left in place** as dead code for this PR. Removing them is a separate scope that touches repository/service layers and their tests. This PR is purely a dashboard redesign; backend cleanup can be a follow-up. Only the renderer-side components and their direct dependencies (burndown handler, burndown IPC type, burndown preload method) are removed here.

**Files:**

- Delete: `src/renderer/src/components/dashboard/SuccessRing.tsx`
- Delete: `src/renderer/src/components/dashboard/SuccessTrendChart.tsx`
- Delete: `src/renderer/src/components/dashboard/SpecTypeSuccessRate.tsx`
- Delete: `src/renderer/src/components/dashboard/FailureBreakdown.tsx`
- Delete: `src/renderer/src/components/dashboard/StatusCounters.tsx`
- Delete: `src/renderer/src/components/dashboard/ChartsSection.tsx`
- Delete corresponding `__tests__/*.test.tsx` files
- Modify: `src/renderer/src/components/dashboard/index.ts` (remove old exports)
- Modify: `src/renderer/src/stores/dashboardData.ts` (remove `burndownData` field and any leftover references)
- Modify: `src/main/handlers/dashboard-handlers.ts` (remove `getTaskBurndown` + `sprint:burndown` registration)
- Modify: `src/main/handlers/__tests__/dashboard-handlers.test.ts` (remove burndown tests)
- Modify: `src/shared/ipc-channels.ts` (remove `BurndownBucket`, `sprint:burndown` channel)
- Modify: `src/preload/index.ts` (remove `dashboard.burndown` method)

- [ ] **Step 1: Delete obsolete component files + their test files**

```bash
git rm src/renderer/src/components/dashboard/SuccessRing.tsx
git rm src/renderer/src/components/dashboard/SuccessTrendChart.tsx
git rm src/renderer/src/components/dashboard/SpecTypeSuccessRate.tsx
git rm src/renderer/src/components/dashboard/FailureBreakdown.tsx
git rm src/renderer/src/components/dashboard/StatusCounters.tsx
git rm src/renderer/src/components/dashboard/ChartsSection.tsx
git rm src/renderer/src/components/dashboard/__tests__/SuccessTrendChart.test.tsx
git rm src/renderer/src/components/dashboard/__tests__/SpecTypeSuccessRate.test.tsx
git rm src/renderer/src/components/dashboard/__tests__/FailureBreakdown.test.tsx
git rm src/renderer/src/components/dashboard/__tests__/StatusCounters.test.tsx
git rm src/renderer/src/components/dashboard/__tests__/ChartsSection.test.tsx
```

(There's no test file for `SuccessRing.tsx` in the current tree — verify with `ls src/renderer/src/components/dashboard/__tests__/`. If one exists, add it to the list.)

- [ ] **Step 2: Remove obsolete exports from `index.ts`**

Edit `src/renderer/src/components/dashboard/index.ts` and remove export lines for `SuccessRing`, `SuccessTrendChart`, `SpecTypeSuccessRate`, `FailureBreakdown`, `StatusCounters`, `ChartsSection`.

- [ ] **Step 3: Remove burndown from backend**

In `src/main/handlers/dashboard-handlers.ts`:

- Delete the `getTaskBurndown` function.
- Remove the `safeHandle('sprint:burndown', ...)` registration.

In `src/shared/ipc-channels.ts`:

- Delete the `BurndownBucket` interface.
- Remove `'sprint:burndown'` from `DashboardChannels`.

In `src/preload/index.ts`:

- Remove `burndown: () => typedInvoke('sprint:burndown')` from the `dashboard` section.

In `src/main/handlers/__tests__/dashboard-handlers.test.ts`:

- Remove any remaining `getTaskBurndown` tests.

- [ ] **Step 4: Remove any leftover `burndownData` references**

Run:

```bash
rg -n "burndown|Burndown" src/ --type ts --type tsx
```

Expected: **zero matches** (or only in changelog/docs). Fix any stragglers.

- [ ] **Step 5: Remove any leftover `avgDuration`/`avgTaskDuration` references**

In `useDashboardMetrics.ts`, now that no consumer uses these, remove the computation and the return fields entirely (along with the `localAgents` import _if_ nothing else uses it — check `tokenTrendData` which does still use `localAgents`, so the import likely stays).

- [ ] **Step 6: Typecheck + tests + lint**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -u src/renderer/src/components/dashboard/ src/renderer/src/stores/dashboardData.ts src/main/handlers/dashboard-handlers.ts src/main/handlers/__tests__/dashboard-handlers.test.ts src/shared/ipc-channels.ts src/preload/index.ts src/renderer/src/hooks/useDashboardMetrics.ts
git commit -m "chore(dashboard): remove obsolete charts, burndown, and status counters"
```

---

### Task 14: Final verification + screenshots + PR

- [ ] **Step 1: Full verification**

Run:

```bash
npm run typecheck && npm test && npm run lint
```

Expected: all green, no warnings introduced. If coverage enforcement flags a file, investigate whether new tests are needed — don't silence thresholds.

- [ ] **Step 2: E2E check (if applicable)**

Run: `npm run test:e2e`
Expected: pass. If the e2e suite touches the dashboard, verify it doesn't assert on removed elements.

- [ ] **Step 3: `npm run build`**

Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 4: Manual screenshot capture**

Run: `npm run dev`
Capture screenshots of:

1. Dashboard in healthy state (Fires strip hidden)
2. Dashboard with Fires strip visible (either induce failures locally or use mocked data)
3. Throughput chart with real data
4. Success rate chart with real data
5. Load chart with at least 10 minutes of samples (leave app running a while)

Save screenshots to `/tmp/dashboard-screenshots/` for inclusion in the PR body.

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/dashboard-charts-redesign
```

- [ ] **Step 6: Open PR**

Use `gh pr create` with the screenshots embedded in the body (per CLAUDE.md's "UX PRs must include screenshots" rule).

PR title: `feat(dashboard): redesign charts with real axes, load tracking, and Fires strip`

PR body must include:

- Summary of the redesign
- Before/after screenshots (ASCII art fallback if the app won't render)
- Test plan checklist
- Link to the spec and plan documents

- [ ] **Step 7: Clean up worktree**

After the PR is merged:

```bash
git worktree remove ~/worktrees/BDE/dashboard-charts-redesign
```

---

## Notes for the implementer

- **Commits are frequent by design.** If a task balloons, split it further rather than batching.
- **Tests are the spec.** If a test and the spec disagree, re-read the spec — don't "fix" the test until you're sure.
- **Do not improve unrelated code.** No drive-by refactors. If you find a bug outside the dashboard, note it and move on.
- **Neon theme:** the existing `neonVar()` helper is how you reference colors. Don't hard-code hex values in new components — reach for the helper first. Hard-coded values should only exist in the CSS file as semantic tokens.
- **`useBackoffInterval` vs `useVisibilityAwareInterval`:** the load polling uses `useBackoffInterval` per BDE convention. If a future iteration wants to save cycles while the dashboard is hidden, switch then — not now.
- **Test file proximity:** tests live in `__tests__/` next to the source. Main-process service tests live in `src/main/services/__tests__/` (see `css-dedup.test.ts` for reference).
- **Use fake timers in the sampler test** — the real `setInterval` at 5s will hang tests.
