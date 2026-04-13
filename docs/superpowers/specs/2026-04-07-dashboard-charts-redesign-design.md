# Dashboard Charts Redesign

**Status:** Draft
**Date:** 2026-04-07
**Scope:** `src/renderer/src/views/DashboardView.tsx` and `src/renderer/src/components/dashboard/*`, plus a small SQL change in `src/main/handlers/dashboard-handlers.ts`, plus a new main-process service for system load sampling.

## Problem

The dashboard is trying to show useful information but the presentation makes it impossible to read. Every chart uses the same primitive (`MiniChart`) — a decorative sparkline with no axes, no gridlines, no tick labels — stretched to 120px tall as if it were a hero chart. Specific failures:

- **Success Trend** auto-scales its Y-axis from 0 to `max(data)`, so when every day is 95–100% a single 80% day produces wild visual swings. No "100%" reference line. No tick labels. The chart encodes no actionable information.
- **Sprint Burn-Down** is mislabeled — it shows tasks-completed-per-day (a run-up), not remaining work sloping toward zero. Users interpret the curve as a burndown because of the title, and get misled.
- **Completions by Hour** has no hour axis. When most hours have zero completions (the common case), the chart shows one lonely dot and looks broken.
- **Success Rate donut** is decoration. At 100% it's a full circle; at 98% it's still visually "full"; at any value below that it still tells you nothing about _when_ or _why_.
- **Avg Task Duration** card shows `—` and "0 runs tracked" despite 115 done tasks — the data pipeline is wrong and a blank hero card trains users to ignore the dashboard.
- **Left column status rail** stacks 8 separate cards vertically, most showing 0 in steady state. Huge real estate to communicate "4 things are happening."

## Goals

The dashboard must answer six questions within ~2 seconds of opening, ordered by priority:

1. **Is anything on fire right now?** — failed / blocked / stuck tasks, and CPU load saturation
2. **Is the machine keeping up?** — system load average vs core count (live ops health)
3. **How fast is the system going?** — completions per hour, current rate vs normal
4. **Is the success rate healthy?** — % and trend
5. **How much is this costing?** — token burn and trend
6. **What just happened?** — recent activity

Non-goals (explicitly dropped from scope):

- "What's waiting on me" (Code Review has its own view)
- "Am I getting faster over time" (avg duration card)
- "Which spec types succeed" (moved out of dashboard; can live in Settings/Analytics later)

## Design Overview

Preserves the current three-column structure (left rail / center charts / right activity) so the mental model stays intact. Surgical fixes to each chart; two primitives removed; one new primitive added.

```
+-----------------------------------------------------------------------+
| STATUS BAR (unchanged)                                                |
+-----------------------------------------------------------------------+
| [!] ATTENTION  2 failed · 3 blocked · 1 stuck >1h · load 137/12 cores |  <-- collapses when empty
+--------+----------------------------------------+---------------------+
| ACTIVE |  THROUGHPUT · last 24h                 | RECENT COMPLETIONS  |
|   6    |  [bar chart, hour axis, y-axis]        |  task... 57m        |
+--------+                                        |  task... 1h         |
| QUEUED |                                        |  task... 1h         |
|   0    |                                        |                     |
+--------+----------------------------------------+---------------------+
| DONE   |  SUCCESS RATE · last 14d               | LIVE ACTIVITY       |
| 115    |  [line chart, fixed 0-100% y-axis]     |  → task started 2m  |
| 4 today|                                        |  ✓ task done 5m     |
+--------+----------------------------------------+  ✗ task failed 8m   |
| TOKENS |  SYSTEM LOAD · last 10m                |  ✓ task done 12m    |
|  628K  |  [line chart, 1/5/15-min, core line]   |                     |
+--------+----------------------------------------+                     |
| + NEW  |  TOKENS / RUN  ~32K  [sparkline]       |                     |
+--------+----------------------------------------+---------------------+
```

### 1. Fires strip (new)

Renders at the top of the grid when any of the following are non-zero: `stats.failed`, `stats.blocked`, `stuckCount`, or `loadSaturated` (see below). Collapses entirely (no DOM, no space) when everything is clear.

- **Shape:** single horizontal card with red accent, up to four text segments separated by dots, e.g. `⚠ ATTENTION — 2 failed · 3 blocked · 1 stuck >1h · load 137 / 12 cores`.
- **Interactions:** each segment is an individual button. `failed` / `blocked` / `stuck` route to Sprint Pipeline with the corresponding filter. The `load` segment routes by scrolling the System Load chart into view and briefly pulsing it (does not navigate away from the dashboard — the chart is already on the same view).
- **"Stuck" definition:** a task in `active` status whose `(now - started_at)` exceeds `max_runtime_ms` (falling back to the global watchdog default, currently 1h). Matches how the agent manager already thinks about stuck tasks — no new concept.
- **"Load saturated" definition:** the most recent 1-minute load average is at least `2 × cpuCount`. Below that (but above `cpuCount`) the load is "over subscribed but not on fire" and shows in the chart but not the Fires strip.
- **Data source:** `stats`, `stuckCount`, and `loadSaturated` are all derived in `useDashboardMetrics`. The first two from the existing `tasks` array (`started_at` and `max_runtime_ms` are existing columns); `loadSaturated` reads the most recent sample from the new load store (see section 5).
- **Replaces:** the current `NeonCard accent="red" title="Attention"` block in `CenterColumn.tsx` which was a mix of three separate buttons. Consolidated into the strip. Also replaces the `FailureBreakdown` card in the right column (now redundant).

### 2. Compressed status rail

Reduces the left column from 8 stacked cards to 5 compact tiles, plus the existing "+ New Task" button.

| Tile       | Value                            | Subtext             | Click action           |
| ---------- | -------------------------------- | ------------------- | ---------------------- |
| Active     | `stats.active`                   | —                   | filter → active        |
| Queued     | `stats.queued`                   | —                   | filter → queued        |
| Done       | `stats.done`                     | `{doneToday} today` | filter → done          |
| Tokens 24h | `formatTokensCompact(tokens24h)` | —                   | (no-op, informational) |
| + New Task | —                                | —                   | open Task Workbench    |

The tiles are ~90px wide, 2/3 the height of the current cards. The four statuses **not** in the rail (Blocked, Failed, Review, PRs) are handled by:

- **Blocked / Failed** → Fires strip (only shown when > 0)
- **Review / PRs** → already accessible via the Sprint Pipeline and Code Review views; not top-5 per the goals

No new "Failed: 0" or "PRs: 0" cards cluttering the rail in steady state.

### 3. Throughput chart (hero, replaces "Completions by Hour")

A proper bar chart with axes, replacing the sparkline.

- **X-axis:** 24 hour buckets from `(now - 24h)` to `now`. Tick labels at 12am / 6am / noon / 6pm / now. The hour labels derive from local time using the existing `hour` ISO string from `getCompletionsPerHour`.
- **Y-axis:** auto-scaled with 0 and a max rounded up to a "nice" number (5, 10, 20, 50, 100). Three gridlines (0, mid, max) with tick labels at the left edge.
- **Bars:** one bar per hour, 24 total. Stacked **success** (cyan) on bottom, **failed** (red) on top. Missing hours render as an empty slot (gap), not a zero bar — empty and "genuinely zero at noon" look different.
- **Header numbers:** `{lastHourCount}` (big), caption `last hour`, plus `{avgPerHour}/hr avg · peak {peak} @ {peakHour}` aligned right.
- **Empty state:** when all 24 hours are zero, show `"No completions in the last 24h"` centered in the chart body instead of an empty axis.
- **Hover:** existing tooltip behavior from `MiniChart` hover, but showing `"{hour}: {success} done, {failed} failed"`.

**Data change required:** `getCompletionsPerHour` in `src/main/handlers/dashboard-handlers.ts` currently returns `{hour, count}`. Must be changed to return `{hour, successCount, failedCount}` by splitting on `agent_runs.status`:

```sql
SELECT
  strftime('%Y-%m-%dT%H:00:00', finished_at / 1000, 'unixepoch', 'localtime') AS hour,
  SUM(CASE WHEN status = 'done'   THEN 1 ELSE 0 END) AS successCount,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
FROM agent_runs
WHERE finished_at IS NOT NULL
  AND finished_at > (strftime('%s', 'now', '-24 hours') * 1000)
GROUP BY hour
ORDER BY hour ASC
```

IPC channel type in `src/shared/ipc-channels.ts` must be updated. Existing tests for `getCompletionsPerHour` must be updated to the new shape.

### 4. Success Rate Trend (hero, replaces "Success Trend" + removes the donut)

A line chart with a **fixed** Y-axis.

- **Y-axis:** hard-coded `[0, 100]`. Tick labels at 0%, 75%, 90%, 100%. Gridlines at 75% and 100%. This is the single most important fix in the design — no auto-scaling allowed on a percentage chart.
- **X-axis:** 14 day buckets with real date labels at the endpoints and midpoint (e.g. `Mar 25` / `Mar 30` / `Apr 4` / `today`).
- **Line:** green line with dots per data point, gradient fill below. Days with `successRate == null` (no data) render as a **gap** in the line — the line picks back up on the next data point. The current implementation coerces null → 0 which creates misleading plunges.
- **Header numbers:** `{7dAverage}%` (big, green), caption `7d avg`, plus `▲ +{delta}% vs prior wk` right-aligned, colored green for positive / red for negative / dim for flat. The 7d average and prior-week delta are computed from `successTrendData` in `useDashboardMetrics`.
- **Empty state:** when all 14 days are null, show `"No completed tasks in the last 14 days"`.

**No data change required** — `getDailySuccessRate(14)` already returns the right shape.

**Removes:** the `SuccessRing` donut entirely. The new trend card encodes current value (the big number) and the trend, making the donut redundant.

### 5. System Load chart (new, replaces nothing — pure addition)

A line chart showing CPU load average over the last 10 minutes. Lives in the center column between the Success Rate chart and the Tokens/Run row. This is the one chart on the dashboard that shows **machine health** rather than work metrics — it exists because BDE spawns parallel agents and each agent's toolchain (vitest + tsc + eslint) is itself parallel, so the machine can saturate long before the UI admits it.

- **Data model:** a ring buffer of `LoadSample` objects sampled every 5 seconds:
  ```ts
  interface LoadSample {
    t: number // epoch ms
    load1: number // 1-minute load average
    load5: number // 5-minute load average
    load15: number // 15-minute load average
  }
  ```
  Buffer size: 120 samples = 10 minutes of history.
- **Y-axis:** auto-scaled with a floor of `max(cpuCount × 1.5, 4)` so a quiet machine still shows visible context, and a ceiling rounded to a nice number above the window's max. Tick labels at 0, midpoint, max. The `cpuCount` saturation line is rendered in dashed amber — it doesn't participate in Y scaling beyond the floor.
- **X-axis:** elapsed time labels at `-10m`, `-5m`, `now`.
- **Lines:**
  - `load1` — bright red/orange (`neonVar('red', 'color')`), stroke width 2, the primary focus
  - `load5` — dim cyan (`neonVar('cyan', 'color')` at 0.5 opacity), stroke width 1.5
  - `load15` — neutral gray (`#64748b`), stroke width 1.5
  - `cpuCount` reference line — dashed amber at the Y coordinate of `cpuCount`
- **Header numbers:**
  - Big number: most recent `load1` value, 2 decimals.
  - Color of the big number: **green** when `load1 < cpuCount`, **amber** when `cpuCount ≤ load1 < 2 × cpuCount`, **red** when `load1 ≥ 2 × cpuCount`.
  - Trend indicator (right-aligned):
    - `▼ cooling` (green) when `load1 < load5`
    - `— steady` (dim) when `|load1 − load5| / load5 < 0.05`
    - `▲ climbing` (red) when `load1 > load5 × 1.05`
  - Caption: `{load5.toFixed(2)} · {load15.toFixed(2)} (5m · 15m)`
- **Empty state:** `"Collecting samples..."` rendered in the chart body until the ring buffer has at least 2 samples.
- **Legend:** single bottom row: `▪ 1-min   ▪ 5-min   ▪ 15-min   ·   ▪ cores (saturation)`

**Data source (main process):**

A new module `src/main/services/load-sampler.ts` owns the ring buffer. It starts on app ready and runs for the lifetime of the main process:

```ts
// src/main/services/load-sampler.ts
import os from 'node:os'

const SAMPLE_INTERVAL_MS = 5000
const BUFFER_SIZE = 120 // 10 minutes at 5s

const ring: LoadSample[] = []
const cpuCount = os.cpus().length
let timer: NodeJS.Timeout | null = null

function sample(): void {
  const [load1, load5, load15] = os.loadavg()
  ring.push({ t: Date.now(), load1, load5, load15 })
  if (ring.length > BUFFER_SIZE) ring.shift()
}

export function startLoadSampler(): void {
  if (timer) return
  sample() // seed immediately
  timer = setInterval(sample, SAMPLE_INTERVAL_MS)
  timer.unref() // don't hold the process open
}

export function stopLoadSampler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getLoadSnapshot(): { samples: LoadSample[]; cpuCount: number } {
  return { samples: [...ring], cpuCount }
}
```

`startLoadSampler()` is called once from `src/main/index.ts` during app initialization (alongside other service starts). Cost is negligible — `os.loadavg()` is a single syscall and a 120-element array of small objects is insignificant memory.

**IPC:** new channel `system:loadAverage` in `src/shared/ipc-channels.ts`:

```ts
'system:loadAverage': {
  request: void
  response: { samples: LoadSample[]; cpuCount: number }
}
```

Handler registered in a new file `src/main/handlers/system-handlers.ts` (or folded into `dashboard-handlers.ts` — recommend the latter since it's the only caller and keeps the handler file count down):

```ts
safeHandle('system:loadAverage', async () => getLoadSnapshot())
```

Preload bridge in `src/preload/index.ts` exposes `window.api.system.loadAverage()`.

**Polling (renderer):**

A new field on `useDashboardDataStore`:

```ts
loadData: { samples: LoadSample[]; cpuCount: number } | null
```

`fetchAll()` already runs on a 60s interval — too slow for load. Add a **separate** visibility-aware interval in `DashboardView`:

```ts
useVisibilityAwareInterval(() => {
  useDashboardDataStore.getState().fetchLoad()
}, 5_000)
```

`fetchLoad()` is a new action on the store that calls the IPC and updates `loadData` (independent of the full `fetchAll()`). This gives the load chart a fast refresh without re-polling the heavy dashboard queries. Initial fetch happens in the existing `useEffect` that seeds dashboard data.

**No error handling retries beyond the standard pattern** — if the IPC call fails, `cardErrors.loadAverage` is set and the card shows the standard retry button. The ring buffer keeps filling in the main process regardless, so a retry recovers instantly.

### 6. Tokens / Run (secondary)

Kept as a small row beneath the System Load chart. This is the **only** place a raw sparkline without axes is appropriate, because it sits inline next to a number.

- One row card, ~50px tall.
- Left: `💰 Tokens / run` title, `{tokenAvg}` as the value, caption `last 20 runs`.
- Right: 80×24px inline sparkline using the existing `tokenTrendData`.
- No axes, no tick labels. It's a sparkline doing a sparkline's actual job.

### 7. Right column (activity)

Largely unchanged in function, mildly restyled for consistency.

- **Recent Completions** card — same as today, no changes.
- **Live Activity** card — same as today, no changes.
- The existing `FailureBreakdown` card is removed; its role is taken over by the Fires strip.

## Components Removed

- `ChartsSection` is significantly simplified; may be replaced entirely by inlining the two new chart components.
- `SuccessRing` — deleted (donut gone).
- `SpecTypeSuccessRate` — moved out of the dashboard view. File can remain in `components/dashboard/` if a future analytics view wants to reuse it, or be deleted now. **Recommendation:** delete, reintroduce if/when an analytics view is built.
- `FailureBreakdown` — deleted (replaced by Fires strip).
- "Sprint Burn-Down" card — deleted. `burndownData`, `getTaskBurndown`, and the `sprint:burndown` IPC channel can be removed from `dashboardData.ts`, `dashboard-handlers.ts`, and `ipc-channels.ts` respectively. This removes dead code, not just UI.
- "Avg Task Duration" card — deleted. The `avgDuration` / `avgTaskDuration` calculations in `useDashboardMetrics` can stay (they're cheap) in case a future view wants them, but the card and its props are removed from `CenterColumn`/`ChartsSection`.

## Components Added

### `FiresStrip`

```tsx
interface FiresStripProps {
  failed: number
  blocked: number
  stuck: number
  loadSaturated: { load1: number; cpuCount: number } | null
  onClick: (kind: 'failed' | 'blocked' | 'stuck' | 'load') => void
}
```

Renders nothing when `failed + blocked + stuck === 0 && loadSaturated === null`. Otherwise a single horizontal NeonCard with red accent. Each segment is an individual click target. The `load` segment displays `load {load1.toFixed(0)} / {cpuCount} cores` and its click handler is expected to scroll the System Load chart into view rather than navigate.

### `ThroughputChart`

```tsx
interface ThroughputDatum {
  hour: string // ISO local hour, e.g. "2026-04-07T14:00:00"
  successCount: number
  failedCount: number
}
interface ThroughputChartProps {
  data: ThroughputDatum[]
  height?: number // default 140
}
```

A new SVG chart component. Not an extension of `MiniChart` — it's architecturally a different thing (bars, stacked, real axes, real labels). Lives in `components/dashboard/ThroughputChart.tsx`.

### `SuccessRateChart`

```tsx
interface SuccessRateChartProps {
  data: DailySuccessRate[] // existing type
  height?: number // default 140
}
```

Replaces `SuccessTrendChart`. Renders a line chart with fixed `[0,100]` Y-axis, tick labels, gridlines at 75/100, gaps for null days, and computes + renders the 7d avg + week-over-week delta header internally. Lives in `components/dashboard/SuccessRateChart.tsx`.

### `LoadAverageChart`

```tsx
interface LoadSample {
  t: number
  load1: number
  load5: number
  load15: number
}
interface LoadAverageChartProps {
  samples: LoadSample[]
  cpuCount: number
  height?: number // default 140
}
```

New SVG chart in `components/dashboard/LoadAverageChart.tsx`. Renders three lines (1/5/15-min), a dashed `cpuCount` reference line, computed header (current value, color-coded; trend indicator; 5m/15m caption), and empty state. Pure component — all derivation from props.

### `StatusRail`

```tsx
interface StatusRailProps {
  stats: DashboardStats
  tokens24h: number
  onFilterClick: (filter: StatusFilter) => void
  onNewTaskClick: () => void
}
```

Replaces `StatusCounters`. Renders 5 compact tiles + New Task button. Lives in `components/dashboard/StatusRail.tsx`. `StatusCounters.tsx` can be deleted.

## Data Flow

```
[main process]                         [renderer]
  load-sampler ring buffer  ─── IPC ──► useDashboardDataStore.loadData
  (5s interval)                          │ (fetchLoad() on 5s visibility-aware)
                                         ▼
[DashboardView]
  │
  ├── useSprintTasks ───┐
  ├── useCostData ──────┤
  ├── useDashboardData ─┴─► useDashboardMetrics (extended)
  │                          │
  │                          ├── stats + stuck + loadSaturated → FiresStrip
  │                          ├── stats + tokens24h              → StatusRail
  │                          ├── throughputData (new)           → ThroughputChart
  │                          ├── successTrendData                → SuccessRateChart
  │                          ├── loadData (new)                  → LoadAverageChart
  │                          ├── tokenTrendData                  → TokensPerRun
  │                          └── recentCompletions, feed         → ActivitySection
```

### Extensions to `useDashboardMetrics`

- Add `stuckCount`: `tasks.filter(t => t.status === 'active' && t.started_at && (now - Date.parse(t.started_at)) > (t.max_runtime_ms ?? DEFAULT_STUCK_MS)).length`
- Add `throughputData: ThroughputDatum[]` derived from the new `chartData` shape returned by the updated IPC handler.
- Add `successRate7dAvg` and `successRateWeekDelta` computed from `successTrendData`.
- Add `loadSaturated`: reads the most recent sample from `useDashboardDataStore.loadData`. Returns `{ load1, cpuCount }` when `load1 >= 2 * cpuCount`, otherwise `null`.
- Drop `avgDuration`, `avgTaskDuration`, `taskDurationCount` from the return type (or leave in place unused — recommend dropping for clarity).

### Extensions to `useDashboardDataStore`

- Update `chartData` type from `ChartBar[]` to `ThroughputDatum[]`.
- Remove `burndownData` and its fetch logic entirely.
- Remove the `burndown` error key.
- Add `loadData: { samples: LoadSample[]; cpuCount: number } | null` field, initialized to `null`.
- Add `fetchLoad()` action: calls `window.api.system.loadAverage()` and updates `loadData`. On failure, sets `cardErrors.loadAverage` (other load polls will recover automatically).
- Add `loadAverage` error key.
- `fetchLoad` is **not** called from `fetchAll` — it has its own faster polling loop in `DashboardView`.

## Error Handling

Per-card error pattern stays the same (`cardErrors[key]` + retry button). New keys:

- `throughput` (replaces `chart`)
- `successRate` (replaces `successTrend`)
- `loadAverage` (new)
- `burndown` key removed

## Testing Strategy

Existing tests to update:

- `CenterColumn.test.tsx`, `ChartsSection.test.tsx`, `StatusCounters.test.tsx` — rewrite against the new component tree.
- `SuccessTrendChart.test.tsx` — rename and rewrite for `SuccessRateChart`, add explicit test for fixed `[0,100]` Y-axis (snapshot an 80%–100% dataset and assert the rendered SVG coordinates are not clamped to full-height).
- `MorningBriefing.test.tsx`, `ActivitySection.test.tsx` — likely unchanged.
- `dashboard-handlers.test.ts` — update for new `getCompletionsPerHour` shape; remove `getTaskBurndown` test.

New tests:

- `ThroughputChart.test.tsx` — renders 24 bars, stacks success+failed, shows empty state when all zero, hour labels visible.
- `FiresStrip.test.tsx` — renders nothing when all zero and no load saturation, renders each non-zero category, segment-level click routing, load segment appears only when `load1 >= 2 × cpuCount`.
- `StatusRail.test.tsx` — 5 tiles, tokens24h formatting, click-to-filter.
- `LoadAverageChart.test.tsx` — renders 3 lines + saturation line, header color-codes correctly at each threshold (green/amber/red), trend indicator picks cooling/steady/climbing correctly, empty state when <2 samples.
- `load-sampler.test.ts` (main-process test, in `src/main/services/__tests__/`) — ring buffer eviction at capacity, `getLoadSnapshot()` returns a copy (not a reference), `startLoadSampler` is idempotent, `stopLoadSampler` halts sampling.
- `useDashboardMetrics.test.ts` — stuck detection respects `max_runtime_ms` when set, falls back to default when unset; week-over-week delta math; `loadSaturated` returns null below 2× cores and populated above.

Coverage targets: match or exceed existing `components/dashboard/` coverage. No new coverage thresholds.

## Migration / Rollout

Single PR. No feature flag. The dashboard is the default view, so breakage is immediately visible in dev. Screenshots of the new dashboard go in the PR body per the UX PR rule.

No database migration. No settings changes. Existing in-flight tasks unaffected. The load sampler starts on app ready; if the main-process module is absent on first run (unlikely — it's imported normally), the renderer gracefully shows the empty state. No persistence across app restarts — the ring buffer is in-memory by design.

## Resolved Decisions (previously open)

- **"Stuck" default threshold:** **1 hour** when `max_runtime_ms` is not set, matching the agent-manager watchdog default. Defined as exported constant `DEFAULT_STUCK_MS = 60 * 60 * 1000` in `useDashboardMetrics`.
- **Throughput Y-axis max:** round to next "nice" number above the peak from the set `{5, 10, 20, 50, 100, 200}`; floor max = 5 so single-digit peaks still look like bars rather than full-height rectangles.
- **`SpecTypeSuccessRate` component:** delete as part of this PR. Can be reintroduced from git history if a future analytics view wants it.
- **Load saturation threshold for Fires strip:** `load1 ≥ 2 × cpuCount`. Below that, the chart shows the over-subscription but the Fires strip stays calm.
- **Success Rate test criterion:** assert that the pixel Y-coordinate of a 100% data point is deterministic (equal to the chart top padding) regardless of the dataset's maximum — this directly verifies the fixed-axis behavior.

## Open Questions

- **"Genuinely zero" hours vs "missing" hours in Throughput:** the SQL `GROUP BY hour` only emits rows for hours that had at least one run. The renderer must synthesize a 24-slot scaffold and treat hours absent from the response as empty slots (gaps). Hours with a row whose counts are all zero shouldn't occur with the current query, but if they do (e.g. a future row with all `cancelled` tasks), they should render identically to missing hours. Planner should confirm this is the intended behavior and codify it in a test.
- **`started_at` reliability on active tasks:** the Fires strip "stuck" detection assumes every `active` task has a populated `started_at`. Planner should verify this holds for tasks claimed outside the normal Agent Manager path (e.g. manual status transitions via the UI). If not, the stuck check must guard with `t.started_at != null` before the subtraction.
- **Load chart polling during tear-off windows:** the 5s load polling runs in the main Dashboard window. If a user tears off the Dashboard into a separate Electron window, the polling should follow the torn-off instance. Planner should confirm `useVisibilityAwareInterval` handles this correctly or add a guard.

## Non-Goals (explicit)

- No real-time websocket updates for the main dashboard polling. The load chart polls separately at 5s, but everything else stays on the existing 60s interval.
- No drill-down into individual hour/day (future feature).
- No per-repo or per-branch filtering (future feature).
- No export / copy-to-clipboard of chart data.
- No revival of the duration card until its data pipeline is fixed.
- No process-level CPU/memory tracking — just system load average. Per-process metrics are a bigger feature.
- No load history persistence across app restarts. The ring buffer is in-memory.
- No configurable sample rate or window — 5s / 10 min is hardcoded.
